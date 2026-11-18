// X402-03 static sub-checks, read from a route manifest. Nothing is sent anywhere.
import { getCheck } from '@dabsproof/registry';
import type { ManifestRoute } from '../../manifest/schema.js';
import type { CheckResult, ResultGroup, RouteRef } from '../../results/types.js';

const CHECK_ID = 'X402-03';

function check() {
  const c = getCheck(CHECK_ID);
  if (!c || (c.status !== 'active' && c.status !== 'experimental'))
    throw new Error(`${CHECK_ID} is missing from the registry`);
  return c;
}

const ref = (r: ManifestRoute): RouteRef =>
  r.address !== undefined ? { route: r.route, address: r.address } : { route: r.route, index: r.index ?? 0 };

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

const byRoute = (a: RouteRef, b: RouteRef) => a.route.localeCompare(b.route);

/** X402-03.dup-index: two or more routes given the same address index. */
export function dupIndex(routes: ManifestRoute[]): CheckResult {
  const c = check();
  const base = {
    checkId: c.id,
    checkVersion: c.version,
    subCheckId: `${CHECK_ID}.dup-index`,
    verifiedBy: 'config' as const,
  };
  const indexed = routes.filter((r) => r.index !== undefined);
  if (!indexed.length) return { ...base, outcome: 'not-applicable', groups: [], note: 'no-index' };
  const groups: ResultGroup[] = groupBy(indexed, (r) => `${r.network}|${r.index}`)
    .filter((g) => g.length > 1)
    .map((g) => ({ routes: g.map(ref).sort(byRoute), network: g[0]?.network ?? '', asset: g[0]?.asset ?? '' }));
  return groups.length
    ? { ...base, outcome: 'found-a-problem', severity: c.severity, groups }
    : { ...base, outcome: 'found-no-problem', groups: [] };
}

/** X402-03.cross-route: routes that share network, asset, price and who gets paid. */
export function crossRoute(routes: ManifestRoute[]): CheckResult {
  const c = check();
  const base = {
    checkId: c.id,
    checkVersion: c.version,
    subCheckId: `${CHECK_ID}.cross-route`,
    verifiedBy: 'config' as const,
  };
  const terms = (r: ManifestRoute) => `${r.network}|${r.asset.toLowerCase()}|${r.price}`;
  const sameTerms = groupBy(routes, terms).filter((g) => g.length > 1);
  if (!sameTerms.length) return { ...base, outcome: 'not-applicable', groups: [] };
  const groups: ResultGroup[] = groupBy(routes, (r) => `${terms(r)}|${payee(r)}`)
    .filter((g) => g.length > 1)
    .map((g) => {
      const first = g[0] as ManifestRoute;
      const group: ResultGroup = {
        routes: g.map(ref).sort(byRoute),
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
