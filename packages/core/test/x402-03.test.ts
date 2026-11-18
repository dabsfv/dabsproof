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

describe('networks (static analysis reads any EVM network; live stays Base Sepolia)', () => {
  it('checks mainnet.json from the manifest and lists its routes as on another network', () => {
    const a = analyse(load('mainnet'));
    expect(a.checkedRoutes).toHaveLength(7);
    expect(a.skippedRoutes).toHaveLength(0);
    expect(a.otherNetworkRoutes).toHaveLength(7);
    expect(result(load('mainnet'), 'cross-route').outcome).toBe('found-a-problem');
    expect(a.exitCode).toBe(1);
  });
  it('compares routes only within one network', () => {
    const x = m(
      r('/a', { address: fake(10) }),
      r('/b', { address: fake(10) }),
      r('/c', { address: fake(10), network: 'eip155:8453' }),
    );
    expect(analyse(x).otherNetworkRoutes.map((s) => s.route)).toEqual(['/c']);
    expect(result(x, 'cross-route').groups.map((g) => g.routes.map((s) => s.route))).toEqual([['/a', '/b']]);
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
  it('shared.json exits 1; hd-per-resource.json exits 0 (the step 0.7 "exits 0" check, moved in step 1.3); hd.json exits 1', () => {
    expect(analyse(load('shared')).exitCode).toBe(1);
    expect(analyse(load('hd-per-resource')).exitCode).toBe(0);
    expect(analyse(load('hd')).exitCode).toBe(1);
    expect(analyse(load('hd-dup-index')).exitCode).toBe(1);
  });
});

describe('step 1.1: schemes, tiers and per-item routes', () => {
  it('compares schemes separately: an exact and an upto route on one address and price are not a clash', () => {
    const x = result(load('schemes'), 'cross-route');
    expect(x.outcome).toBe('found-no-problem');
    expect(analyse(load('schemes')).mixedSchemes).toBe(true);
  });
  it('still finds a clash inside one scheme', () => {
    const x = result(
      m(r('/a', { scheme: 'upto', address: fake(10) }), r('/b', { scheme: 'upto', address: fake(10) })),
      'cross-route',
    );
    expect(x.outcome).toBe('found-a-problem');
    expect(x.groups[0]?.scheme).toBe('upto');
  });
  it('groups repeated indexes by scheme', () => {
    const x = m(r('/a', { index: 7 }), r('/b', { index: 7, scheme: 'upto' }));
    expect(result(x, 'dup-index').outcome).toBe('found-no-problem');
  });
  it('finds a tier that shares price and address with another route, and labels the tier', () => {
    const x = result(load('tiers'), 'cross-route');
    expect(x.outcome).toBe('found-a-problem');
    expect(x.groups[0]?.routes.map((g) => [g.route, g.tier])).toEqual([
      ['/api/alpha', undefined],
      ['/api/tiered', 'basic'],
    ]);
  });
  it('never reports two tiers of one route against each other', () => {
    const x = m(r('/t', { tier: 'a', index: 4 }), r('/t', { tier: 'b', index: 4 }));
    expect(result(x, 'cross-route').outcome).toBe('not-applicable');
    expect(result(x, 'dup-index').outcome).toBe('found-no-problem');
  });
  it('leaves per-item routes out of both sub-checks, and lists them', () => {
    const a = analyse(load('hd-per-resource'));
    expect(a.perResourceRoutes.map((x) => x.route)).toEqual(['/api/item/[id]']);
    for (const res of a.results) {
      expect(res.groups.flatMap((g) => g.routes.map((x) => x.route))).not.toContain('/api/item/[id]');
    }
    expect(a.exitCode).toBe(0);
  });
});

describe('step 1.1: notExported', () => {
  it('makes the overall result could not verify, with exit 2', () => {
    const a = analyse(load('not-exported'));
    expect(a.notExported).toHaveLength(2);
    expect(a.overall).toBe('could-not-verify');
    expect(a.exitCode).toBe(2);
  });
  it('still exits 1 when a problem was found as well', () => {
    const x = {
      ...m(r('/a', { address: fake(10) }), r('/b', { address: fake(10) })),
      notExported: [{ route: '/c', reason: 'price-function' as const }],
    };
    expect(analyse(x).exitCode).toBe(1);
  });
  it('when no route had fixed terms, nothing was checked: could not verify, exit 2', () => {
    const a = analyse({ manifestVersion: 1, routes: [], notExported: [{ route: '/c', reason: 'payto-function' }] });
    expect(a.results.every((x) => x.outcome === 'could-not-verify' && x.note === 'nothing-fixed')).toBe(true);
    expect(a.exitCode).toBe(2);
  });
  it('exitCodeFor counts unverified routes', () => {
    expect(exitCodeFor([{ outcome: 'found-no-problem' }], 1)).toBe(2);
    expect(exitCodeFor([{ outcome: 'found-no-problem' }], 0)).toBe(0);
  });
});
