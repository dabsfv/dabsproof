// Step 1.3 static sub-checks, in both directions, with range edges and the 2^31 limit.
import { describe, expect, it } from 'vitest';
import {
  analyse,
  loadManifest,
  MANIFEST_TEXT,
  MAX_INDEX,
  type Manifest,
  type ManifestRoute,
  ManifestSchema,
} from '../src/index.js';
import { fake, fixturePath } from './fixtures.js';

const load = (name: string): Manifest => {
  const r = loadManifest(fixturePath(name));
  if (!r.ok) throw new Error(`${name} did not load`);
  return r.manifest;
};
const r = (route: string, extra: Partial<ManifestRoute>): ManifestRoute =>
  ({ route, price: '1000', asset: fake(1), network: 'eip155:84532', ...extra }) as ManifestRoute;
const m = (...routes: ManifestRoute[]): Manifest => ({ manifestVersion: 1, routes });
const sub = (x: Manifest, id: string, previous: Manifest[] = [], previousUnreadable = 0) => {
  const res = analyse(x, { previous, previousUnreadable }).results.find((s) => s.subCheckId === `X402-03.${id}`);
  if (!res) throw new Error(`no ${id} result`);
  return res;
};
const per = (route: string, baseIndex: number, firstId?: number, lastId?: number) =>
  r(route, {
    perResource: firstId === undefined ? { baseIndex } : { baseIndex, firstId, lastId: lastId as number },
  });

describe('.dup-index compares within one scheme, network and asset, and ignores price', () => {
  it('finds a repeated index at different prices', () => {
    expect(sub(m(r('/a', { index: 3 }), r('/b', { index: 3, price: '9' })), 'dup-index').outcome).toBe(
      'found-a-problem',
    );
  });
  it('does not compare across assets, networks or schemes', () => {
    expect(sub(m(r('/a', { index: 3 }), r('/b', { index: 3, asset: fake(2) })), 'dup-index').outcome).toBe(
      'found-no-problem',
    );
    expect(sub(m(r('/a', { index: 3 }), r('/b', { index: 3, network: 'eip155:8453' })), 'dup-index').outcome).toBe(
      'found-no-problem',
    );
    expect(sub(m(r('/a', { index: 3 }), r('/b', { index: 3, scheme: 'upto' })), 'dup-index').outcome).toBe(
      'found-no-problem',
    );
  });
});

describe('.index-range-overlap', () => {
  it('finds both kinds of overlap in range-overlap.json', () => {
    const res = sub(load('range-overlap'), 'index-range-overlap');
    expect(res.outcome).toBe('found-a-problem');
    expect(res.groups.map((g) => g.routes.map((x) => x.route).sort())).toEqual([
      ['/api/alpha', '/api/item/[id]'],
      ['/api/item/[id]', '/api/other/[id]'],
    ]);
  });
  it('range edges: the index just past a range does not overlap; the last index in it does', () => {
    // Items 1 to 10 at base 1000 use indexes 1001 to 1010.
    expect(sub(m(per('/i/[id]', 1000, 1, 10), r('/a', { index: 1011 })), 'index-range-overlap').outcome).toBe(
      'found-no-problem',
    );
    expect(sub(m(per('/i/[id]', 1000, 1, 10), r('/a', { index: 1010 })), 'index-range-overlap').outcome).toBe(
      'found-a-problem',
    );
    expect(sub(m(per('/i/[id]', 1000, 1, 10), r('/a', { index: 1000 })), 'index-range-overlap').outcome).toBe(
      'found-no-problem',
    );
    expect(sub(m(per('/i/[id]', 1000, 1, 10), per('/j/[id]', 1010, 0, 5)), 'index-range-overlap').outcome).toBe(
      'found-a-problem',
    );
    expect(sub(m(per('/i/[id]', 1000, 1, 10), per('/j/[id]', 1010, 1, 5)), 'index-range-overlap').outcome).toBe(
      'found-no-problem',
    );
  });
  it('compares within one scheme, network and asset, and ignores price', () => {
    expect(sub(m(per('/i/[id]', 0, 1, 10), r('/a', { index: 5, price: '9' })), 'index-range-overlap').outcome).toBe(
      'found-a-problem',
    );
    expect(sub(m(per('/i/[id]', 0, 1, 10), r('/a', { index: 5, asset: fake(2) })), 'index-range-overlap').outcome).toBe(
      'found-no-problem',
    );
  });
  it('could not verify when a per-item route gives no ids (exit 2); not applicable without per-item routes', () => {
    expect(sub(load('range-unknown'), 'index-range-overlap').outcome).toBe('could-not-verify');
    expect(analyse(load('range-unknown')).exitCode).toBe(2);
    expect(sub(m(r('/a', { index: 1 })), 'index-range-overlap').outcome).toBe('not-applicable');
  });
  it('still reports an overlap it can see even when another range is unknown', () => {
    const x = m(per('/i/[id]', 0, 1, 10), r('/a', { index: 5 }), per('/u/[id]', 500));
    expect(sub(x, 'index-range-overlap').outcome).toBe('found-a-problem');
  });
});

describe('the 2^31 limit', () => {
  const ok = (routes: unknown[]) => ManifestSchema.safeParse({ manifestVersion: 1, routes }).success;
  it('accepts an index of 2^31 - 1 and refuses 2^31', () => {
    expect(ok([r('/a', { index: MAX_INDEX })])).toBe(true);
    expect(ok([r('/a', { index: MAX_INDEX + 1 })])).toBe(false);
  });
  it('accepts a range ending at 2^31 - 1 and refuses one ending past it', () => {
    expect(ok([per('/i/[id]', MAX_INDEX - 10, 0, 10)])).toBe(true);
    expect(ok([per('/i/[id]', MAX_INDEX - 10, 0, 11)])).toBe(false);
    const res = ManifestSchema.safeParse({ manifestVersion: 1, routes: [per('/i/[id]', MAX_INDEX - 10, 0, 11)] });
    expect(res.success ? '' : res.error.issues.map((i) => i.message).join()).toContain(MANIFEST_TEXT.rangeLimit);
  });
  it('needs both firstId and lastId, in order', () => {
    expect(ok([r('/i/[id]', { perResource: { baseIndex: 0, firstId: 1 } })])).toBe(false);
    expect(ok([per('/i/[id]', 0, 5, 4)])).toBe(false);
  });
});

describe('.dynamic-per-pattern', () => {
  it('is a problem when a [param] route has one fixed address or index', () => {
    expect(sub(load('hd'), 'dynamic-per-pattern').outcome).toBe('found-a-problem');
    expect(sub(m(r('/i/[id]', { address: fake(10) })), 'dynamic-per-pattern').outcome).toBe('found-a-problem');
  });
  it('finds no problem when every [param] route is per item, and is not applicable without one', () => {
    expect(sub(load('dynamic-per-item'), 'dynamic-per-pattern').outcome).toBe('found-no-problem');
    expect(sub(m(r('/a', { index: 0 })), 'dynamic-per-pattern').outcome).toBe('not-applicable');
  });
});

describe('.tiers', () => {
  it('finds two tiers of one route with the same terms and payee, not the third at another price', () => {
    const res = sub(load('tiers-same-terms'), 'tiers');
    expect(res.outcome).toBe('found-a-problem');
    expect(res.groups[0]?.routes.map((x) => x.tier)).toEqual(['basic', 'gold']);
  });
  it('finds no problem for tiers at different prices; not applicable without tiers', () => {
    expect(sub(load('tiers'), 'tiers').outcome).toBe('found-no-problem');
    expect(sub(m(r('/a', { index: 0 })), 'tiers').outcome).toBe('not-applicable');
  });
  it('.cross-route still finds a tier of one route against a different route with the same terms', () => {
    const x = m(
      r('/t', { tier: 'basic', address: fake(10) }),
      r('/t', { tier: 'pro', price: '2000', address: fake(10) }),
      r('/other', { address: fake(10) }),
    );
    const res = sub(x, 'cross-route');
    expect(res.outcome).toBe('found-a-problem');
    expect(res.groups[0]?.routes.map((g) => [g.route, g.tier])).toEqual([
      ['/other', undefined],
      ['/t', 'basic'],
    ]);
  });
});

describe('.stale-mapping', () => {
  const prev = load('stale-previous');
  it('finds an earlier route\x27s index now on a different route with the same terms', () => {
    const res = sub(load('stale-reuse'), 'stale-mapping', [prev]);
    expect(res.outcome).toBe('found-a-problem');
    expect(res.groups[0]?.routes[0]).toMatchObject({ route: '/api/beta', index: 0, earlierRoute: '/api/alpha' });
  });
  it('a reuse at a different price is information only, not a problem', () => {
    const now = m(r('/api/alpha', { index: 5 }), r('/api/beta', { index: 0, price: '2000' }));
    expect(sub(now, 'stale-mapping', [prev]).outcome).toBe('found-no-problem');
    expect(analyse(now, { previous: [prev] }).history.reusedOtherTerms).toHaveLength(1);
  });
  it('a moved route with its old index left unused is found no problem, and listed as moved', () => {
    const a = analyse(load('hd-moved'), { previous: [load('hd')] });
    expect(a.results.find((x) => x.subCheckId === 'X402-03.stale-mapping')?.outcome).toBe('found-no-problem');
    expect(a.history.moved.map((x) => [x.now.route, x.earlier.index, x.now.index])).toEqual([['/api/alpha', 0, 5]]);
  });
  it('a reused address is found too, not only a reused index', () => {
    const before = m(r('/a', { address: fake(10) }));
    expect(sub(m(r('/b', { address: fake(10) })), 'stale-mapping', [before]).outcome).toBe('found-a-problem');
  });
  it('not applicable without an earlier manifest; could not verify if one was unreadable (exit 2 unless a problem)', () => {
    expect(sub(load('stale-reuse'), 'stale-mapping').outcome).toBe('not-applicable');
    expect(sub(load('stale-reuse'), 'stale-mapping', [], 1).outcome).toBe('could-not-verify');
    expect(analyse(load('stale-reuse'), { previousUnreadable: 1 }).exitCode).toBe(2);
  });
});
