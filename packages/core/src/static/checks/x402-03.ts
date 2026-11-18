// X402-03 static sub-checks, read from a route manifest. Nothing is sent anywhere.
// Entries are compared only within one payment scheme. Per-item routes (perResource) are left
// out, because overlapping address ranges are a separate sub-check; entries of one route (its
// tiers) are never reported as clashing with each other, because that is the .tiers sub-check.
import { getCheck } from '@dabsproof/registry';
import { type ManifestRoute, schemeOf } from '../../manifest/schema.js';
import type { CheckResult, ResultGroup, RouteRef } from '../../results/types.js';

const CHECK_ID = 'X402-03';

function check() {
  const c = getCheck(CHECK_ID);
  if (!c || (c.status !== 'active' && c.status !== 'experimental'))
    throw new Error(`${CHECK_ID} is missing from the registry`);
  return c;
}

const ref = (r: ManifestRoute): RouteRef => ({
  route: r.route,
  ...(r.tier !== undefined ? { tier: r.tier } : {}),
  scheme: schemeOf(r),
  ...(r.address !== undefined ? { address: r.address } : { index: r.index ?? 0 }),
});

/** Who gets paid: the address, or the index when the address is derived later. */
const payee = (r: ManifestRoute): string =>
  r.address !== undefined ? `address:${r.address.toLowerCase()}` : `index:${r.index}`;

function groupBy<T>(items: T[], key: (t: T) => string): T[][] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return [...map.values()];
}

/** A group is only a clash if it holds at least two different routes. */
const spansRoutes = (g: ManifestRoute[]): boolean => new Set(g.map((r) => r.route)).size > 1;
const byRoute = (a: RouteRef, b: RouteRef) =>
  a.route.localeCompare(b.route) || (a.tier ?? '').localeCompare(b.tier ?? '');
const withFixedPayee = (routes: ManifestRoute[]) => routes.filter((r) => r.perResource === undefined);

/** X402-03.dup-index: two or more routes given the same address index (within one scheme). */
export function dupIndex(routes: ManifestRoute[]): CheckResult {
  const c = check();
  const base = {
    checkId: c.id,
    checkVersion: c.version,
    subCheckId: `${CHECK_ID}.dup-index`,
    verifiedBy: 'config' as const,
  };
  const indexed = withFixedPayee(routes).filter((r) => r.index !== undefined);
  if (!indexed.length) return { ...base, outcome: 'not-applicable', groups: [], note: 'no-index' };
  const groups: ResultGroup[] = groupBy(indexed, (r) => `${schemeOf(r)}|${r.network}|${r.index}`)
    .filter(spansRoutes)
    .map((g) => {
      const first = g[0] as ManifestRoute;
      return { routes: g.map(ref).sort(byRoute), scheme: schemeOf(first), network: first.network, asset: first.asset };
    });
  return groups.length
    ? { ...base, outcome: 'found-a-problem', severity: c.severity, groups }
    : { ...base, outcome: 'found-no-problem', groups: [] };
}

/** X402-03.cross-route: routes that share scheme, network, asset, price and who gets paid. */
export function crossRoute(routes: ManifestRoute[]): CheckResult {
  const c = check();
  const base = {
    checkId: c.id,
    checkVersion: c.version,
    subCheckId: `${CHECK_ID}.cross-route`,
    verifiedBy: 'config' as const,
  };
  const fixed = withFixedPayee(routes);
  const terms = (r: ManifestRoute) => `${schemeOf(r)}|${r.network}|${r.asset.toLowerCase()}|${r.price}`;
  if (!groupBy(fixed, terms).some(spansRoutes)) return { ...base, outcome: 'not-applicable', groups: [] };
  const groups: ResultGroup[] = groupBy(fixed, (r) => `${terms(r)}|${payee(r)}`)
    .filter(spansRoutes)
    .map((g) => {
      const first = g[0] as ManifestRoute;
      const group: ResultGroup = {
        routes: g.map(ref).sort(byRoute),
        scheme: schemeOf(first),
        network: first.network,
        asset: first.asset,
        price: first.price,
      };
      if (first.index !== undefined) group.sameMistakeAs = `${CHECK_ID}.dup-index`;
      return group;
    });
  return groups.length
    ? { ...base, outcome: 'found-a-problem', severity: c.severity, groups }
    : { ...base, outcome: 'found-no-problem', groups: [] };
}
