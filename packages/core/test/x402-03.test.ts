import { describe, expect, it } from 'vitest';
import { analyse, exitCodeFor, loadManifest, type Manifest, type ManifestRoute } from '../src/index.js';
import { fixturePath } from './fixtures.js';

const load = (name: string): Manifest => {
  const r = loadManifest(fixturePath(name));
  if (!r.ok) throw new Error(`${name} did not load`);
  return r.manifest;
};
const result = (m: Manifest, sub: string) => {
  const r = analyse(m).results.find((x) => x.subCheckId === `X402-03.${sub}`);
  if (!r) throw new Error(`no ${sub} result`);
  return r;
};
const fake = (n: number) => `0x${String(n).padStart(40, '0')}`;
const r = (route: string, extra: Partial<ManifestRoute>): ManifestRoute =>
  ({ route, price: '1000', asset: fake(1), network: 'eip155:84532', ...extra }) as ManifestRoute;
const m = (...routes: ManifestRoute[]): Manifest => ({ manifestVersion: 1, routes });

describe('X402-03.cross-route', () => {
  it('finds the 7-route clash in shared.json', () => {
    const x = result(load('shared'), 'cross-route');
    expect(x.outcome).toBe('found-a-problem');
    expect(x.severity).toBe('medium');
    expect(x.verifiedBy).toBe('config');
    expect(x.groups).toHaveLength(1);
    expect(x.groups[0]?.routes).toHaveLength(7);
  });
  it('finds no problem in hd.json', () => {
    expect(result(load('hd'), 'cross-route').outcome).toBe('found-no-problem');
  });
  it('does not flag routes that share an address at different prices', () => {
    expect(
      result(m(r('/a', { address: fake(10) }), r('/b', { address: fake(10), price: '2000' })), 'cross-route').outcome,
    ).toBe('not-applicable');
  });
  it('does not flag routes on different assets', () => {
    expect(
      result(m(r('/a', { address: fake(10) }), r('/b', { address: fake(10), asset: fake(2) })), 'cross-route').outcome,
    ).toBe('not-applicable');
  });
  it('compares addresses ignoring case', () => {
    const x = result(
      m(r('/a', { address: `0x${'A'.repeat(40)}` }), r('/b', { address: `0x${'a'.repeat(40)}` })),
      'cross-route',
    );
    expect(x.outcome).toBe('found-a-problem');
  });
});

describe('X402-03.dup-index', () => {
  it('finds alpha and beta sharing index 0 in hd-dup-index.json', () => {
    const x = result(load('hd-dup-index'), 'dup-index');
    expect(x.outcome).toBe('found-a-problem');
    expect(x.groups[0]?.routes.map((g) => g.route)).toEqual(['/api/alpha', '/api/beta']);
  });
  it('links the matching cross-route result to it as the same mistake', () => {
    const x = result(load('hd-dup-index'), 'cross-route');
    expect(x.outcome).toBe('found-a-problem');
    expect(x.groups.map((g) => g.sameMistakeAs)).toEqual(['X402-03.dup-index']);
  });
  it('finds no problem in hd.json, and is not applicable when no route uses an index', () => {
    expect(result(load('hd'), 'dup-index').outcome).toBe('found-no-problem');
    expect(result(load('shared'), 'dup-index').outcome).toBe('not-applicable');
  });
  it('flags a repeated index even at different prices', () => {
    const x = m(r('/a', { index: 5 }), r('/b', { index: 5, price: '2000' }));
    expect(result(x, 'dup-index').outcome).toBe('found-a-problem');
    expect(result(x, 'cross-route').outcome).toBe('not-applicable');
  });
});

describe('networks', () => {
  it('checks nothing in mainnet.json: could not verify, exit 2', () => {
    const a = analyse(load('mainnet'));
    expect(a.checkedRoutes).toHaveLength(0);
    expect(a.skippedRoutes).toHaveLength(7);
    expect(a.results.map((x) => x.outcome)).toEqual(['could-not-verify', 'could-not-verify']);
    expect(a.overall).toBe('could-not-verify');
    expect(a.exitCode).toBe(2);
  });
  it('judges a mixed manifest on the Base Sepolia routes only, and lists the others as skipped', () => {
    const x = m(
      r('/a', { address: fake(10) }),
      r('/b', { address: fake(10) }),
      r('/c', { address: fake(10), network: 'eip155:8453' }),
    );
    expect(analyse(x).skippedRoutes.map((s) => s.route)).toEqual(['/c']);
    expect(result(x, 'cross-route').groups[0]?.routes.map((s) => s.route)).toEqual(['/a', '/b']);
  });
});

describe('exit codes', () => {
  const o = (...outcomes: string[]) => outcomes.map((outcome) => ({ outcome })) as Parameters<typeof exitCodeFor>[0];
  it('1 when a problem is found, even next to could not verify', () => {
    expect(exitCodeFor(o('found-a-problem', 'could-not-verify'))).toBe(1);
  });
  it('2 when anything could not be verified and no problem was found', () => {
    expect(exitCodeFor(o('found-no-problem', 'could-not-verify'))).toBe(2);
  });
  it('0 only when no problem was found and nothing is unverified', () => {
    expect(exitCodeFor(o('found-no-problem', 'not-applicable'))).toBe(0);
  });
  it('matches §8: shared.json exits 1, hd.json exits 0', () => {
    expect(analyse(load('shared')).exitCode).toBe(1);
    expect(analyse(load('hd')).exitCode).toBe(0);
    expect(analyse(load('hd-dup-index')).exitCode).toBe(1);
  });
});
