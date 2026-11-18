import { describe, expect, it } from 'vitest';
import { exportManifest, type RoutesConfigLike } from '../src/index.js';
import { fake } from './fixtures.js';

const opt = (extra: object = {}) => ({
  scheme: 'exact',
  payTo: fake(10),
  price: '$0.001',
  network: 'eip155:84532',
  ...extra,
});
const o = { asset: fake(1), decimals: 6 };
const reasons = (routes: RoutesConfigLike, options: object = o) =>
  exportManifest(routes, { ...o, ...options }).notExported?.map((n) => `${n.route} ${n.reason}`) ?? [];

describe('exportManifest: shapes', () => {
  it('reads a map of paths, ignoring descriptive fields', () => {
    const m = exportManifest(
      { '/b': { accepts: opt(), description: 'x', mimeType: 'y' }, '/a': { accepts: opt() } },
      o,
    );
    expect(m.routes.map((r) => [r.route, r.price, r.address, r.asset])).toEqual([
      ['/a', '1000', fake(10), fake(1)],
      ['/b', '1000', fake(10), fake(1)],
    ]);
    expect(m.notExported).toBeUndefined();
  });
  it('needs a path for a single route configuration', () => {
    expect(() => exportManifest({ accepts: opt() }, o)).toThrow(/^path: /);
    expect(exportManifest({ accepts: opt() }, { ...o, path: '/api/x' }).routes[0]?.route).toBe('/api/x');
  });
  it('makes one entry per payment option, keeping the scheme', () => {
    const m = exportManifest({ '/a': { accepts: [opt(), opt({ scheme: 'upto' })] } }, o);
    expect(m.routes.map((r) => r.scheme ?? 'exact')).toEqual(['exact', 'upto']);
  });
  it('refuses a bad asset, bad decimals or a route that is not a path, without showing the value', () => {
    expect(() => exportManifest({ '/a': { accepts: opt() } }, { asset: 'zq-asset', decimals: 6 })).toThrow(/^asset: /);
    expect(() => exportManifest({ '/a': { accepts: opt() } }, { ...o, decimals: 6.5 })).toThrow(/^decimals: /);
    expect(() => exportManifest({ 'zq route': { accepts: opt() } }, o)).toThrow(/^route: /);
    expect(() => exportManifest({ 'zq route': { accepts: opt() } }, o)).not.toThrow(/zq/);
  });
});

describe('exportManifest: what goes to notExported (codes only, never a value)', () => {
  const cases: [string, object, string][] = [
    ['payTo function', { payTo: () => fake(10) }, 'payto-function'],
    ['price function', { price: () => '$1' }, 'price-function'],
    ['number price', { price: 0.001 }, 'price-number'],
    ['asset and amount price', { price: { asset: fake(2), amount: '1000' } }, 'price-asset-amount'],
    ['plain decimal price', { price: '0.001' }, 'price-format'],
    ['too precise', { price: '$0.0000001' }, 'price-too-precise'],
    ['payTo not an address', { payTo: 'zq-not-an-address' }, 'payto-not-address'],
    ['network not EVM', { network: 'solana:mainnet' }, 'network-not-evm'],
    ['unknown scheme', { scheme: 'deferred' }, 'scheme-unknown'],
  ];
  for (const [what, extra, reason] of cases) {
    it(what, () => {
      const m = exportManifest({ '/ok': { accepts: opt() }, '/x': { accepts: opt(extra) } }, o);
      expect(m.notExported).toEqual([{ route: '/x', reason }]);
      expect(JSON.stringify(m)).not.toContain('zq-');
    });
  }
  it('a second option with the same scheme, network and asset', () => {
    expect(reasons({ '/a': { accepts: [opt(), opt({ payTo: fake(11) })] } })).toEqual(['/a duplicate-option']);
  });
  it('a manifest where every route went to notExported is still valid', () => {
    const m = exportManifest({ '/a': { accepts: opt({ price: () => '$1' }) } }, o);
    expect(m.routes).toEqual([]);
    expect(m.notExported).toEqual([{ route: '/a', reason: 'price-function' }]);
  });
});
