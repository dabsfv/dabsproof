// X402-03 static sub-checks, read from a route manifest. Nothing is sent anywhere.
// Entries are compared only within one payment scheme. Per-item routes (perResource) are left
// out of .cross-route and .dup-index; their ranges are .index-range-overlap's job. Entries of one
// route (its tiers) are never reported against each other by .cross-route; that is .tiers.
import { getCheck } from '@dabsproof/registry';
import { isDynamic, type Manifest, type ManifestRoute, schemeOf } from '../../manifest/schema.js';
import type { CheckResult, ResultGroup, RouteRef, StaticContext } from '../../results/types.js';

const CHECK_ID = 'X402-03';

function check() {
  const c = getCheck(CHECK_ID);
  if (!c || (c.status !== 'active' && c.status !== 'experimental'))
    throw new Error(`${CHECK_ID} is missing from the registry`);
  return c;
}

function base(sub: string) {
  const c = check();
  return { checkId: c.id, checkVersion: c.version, subCheckId: `${CHECK_ID}.${sub}`, verifiedBy: 'config' as const };
}

const problem = (sub: string, groups: ResultGroup[]): CheckResult => ({
  ...base(sub),
  outcome: 'found-a-problem',
  severity: check().severity,
  groups,
});
const noProblem = (sub: string): CheckResult => ({ ...base(sub), outcome: 'found-no-problem', groups: [] });
const notApplicable = (sub: string, note?: string): CheckResult => ({
  ...base(sub),
  outcome: 'not-applicable',
  groups: [],
  ...(note ? { note } : {}),
});
const couldNotVerify = (sub: string, note?: string): CheckResult => ({
  ...base(sub),
  outcome: 'could-not-verify',
  groups: [],
  ...(note ? { note } : {}),
});

export const ref = (r: ManifestRoute): RouteRef => {
  const out: RouteRef = { route: r.route, scheme: schemeOf(r) };
  if (r.tier !== undefined) out.tier = r.tier;
  if (r.address !== undefined) out.address = r.address;
  else if (r.index !== undefined) out.index = r.index;
  const range = rangeOf(r);
  if (range) out.range = range;
  return out;
};

/** Who gets paid: the address, or the index when the address is derived later. */
const payee = (r: ManifestRoute): string =>
  r.address !== undefined ? `address:${r.address.toLowerCase()}` : `index:${r.index}`;
/** Scheme, network and asset: the scope .dup-index and .index-range-overlap compare within. */
const scope = (r: ManifestRoute): string => `${schemeOf(r)}|${r.network}|${r.asset.toLowerCase()}`;
const terms = (r: ManifestRoute): string => `${scope(r)}|${r.price}`;

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
const groupOf = (g: ManifestRoute[], withPrice: boolean): ResultGroup => {
  const first = g[0] as ManifestRoute;
  return {
    routes: g.map(ref).sort(byRoute),
    scheme: schemeOf(first),
    network: first.network,
    asset: first.asset,
    ...(withPrice ? { price: first.price } : {}),
  };
};

/** The address indexes a per-item route's items use, when its item ids are given. */
export function rangeOf(r: ManifestRoute): { first: number; last: number } | undefined {
  const p = r.perResource;
  if (!p || p.firstId === undefined || p.lastId === undefined) return undefined;
  return { first: p.baseIndex + p.firstId, last: p.baseIndex + p.lastId };
}

/** X402-03.dup-index: two or more routes given the same address index (one scheme, network and asset). */
export function dupIndex(routes: ManifestRoute[]): CheckResult {
  const indexed = withFixedPayee(routes).filter((r) => r.index !== undefined);
  if (!indexed.length) return notApplicable('dup-index', 'no-index');
  const groups = groupBy(indexed, (r) => `${scope(r)}|${r.index}`)
    .filter(spansRoutes)
    .map((g) => groupOf(g, false));
  return groups.length ? problem('dup-index', groups) : noProblem('dup-index');
}

/** X402-03.index-range-overlap: a per-item range overlaps another range or a fixed index. */
export function indexRangeOverlap(routes: ManifestRoute[]): CheckResult {
  const perItem = routes.filter((r) => r.perResource !== undefined);
  if (!perItem.length) return notApplicable('index-range-overlap');
  type Span = { r: ManifestRoute; first: number; last: number };
  const spans: Span[] = [];
  for (const r of routes) {
    const range = rangeOf(r);
    if (range) spans.push({ r, ...range });
    else if (r.perResource === undefined && r.index !== undefined) spans.push({ r, first: r.index, last: r.index });
  }
  const groups: ResultGroup[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < spans.length; i++) {
    for (let j = i + 1; j < spans.length; j++) {
      const a = spans[i] as Span;
      const b = spans[j] as Span;
      // Fixed index against fixed index is .dup-index; entries of one route are never compared.
      if (a.r.perResource === undefined && b.r.perResource === undefined) continue;
      if (a.r.route === b.r.route || scope(a.r) !== scope(b.r)) continue;
      if (a.first > b.last || b.first > a.last) continue;
      const key = [a.r.route, a.r.tier ?? '', b.r.route, b.r.tier ?? ''].join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      groups.push(groupOf([a.r, b.r], false));
    }
  }
  if (groups.length) return problem('index-range-overlap', groups);
  if (perItem.some((r) => !rangeOf(r))) return couldNotVerify('index-range-overlap', 'unknown-ids');
  return noProblem('index-range-overlap');
}

/** X402-03.cross-route: routes that share scheme, network, asset, price and who gets paid. */
export function crossRoute(routes: ManifestRoute[]): CheckResult {
  const fixed = withFixedPayee(routes);
  if (!groupBy(fixed, terms).some(spansRoutes)) return notApplicable('cross-route');
  const groups = groupBy(fixed, (r) => `${terms(r)}|${payee(r)}`)
    .filter(spansRoutes)
    .map((g) => {
      const group = groupOf(g, true);
      if ((g[0] as ManifestRoute).index !== undefined) group.sameMistakeAs = `${CHECK_ID}.dup-index`;
      return group;
    });
  return groups.length ? problem('cross-route', groups) : noProblem('cross-route');
}

/** X402-03.dynamic-per-pattern: a route with a [param] part that has one fixed payee for every value. */
export function dynamicPerPattern(routes: ManifestRoute[]): CheckResult {
  const dynamic = routes.filter((r) => isDynamic(r.route));
  if (!dynamic.length) return notApplicable('dynamic-per-pattern');
  const shared = dynamic.filter((r) => r.perResource === undefined);
  return shared.length ? problem('dynamic-per-pattern', [groupOf(shared, false)]) : noProblem('dynamic-per-pattern');
}

/** X402-03.tiers: two tiers of one route with the same scheme, network, asset, price and payee. */
export function tiers(routes: ManifestRoute[]): CheckResult {
  const tiered = withFixedPayee(routes).filter((r) => r.tier !== undefined);
  if (!routes.some((r) => r.tier !== undefined)) return notApplicable('tiers');
  const groups = groupBy(tiered, (r) => `${r.route}|${terms(r)}|${payee(r)}`)
    .filter((g) => g.length > 1)
    .map((g) => groupOf(g, true));
  return groups.length ? problem('tiers', groups) : noProblem('tiers');
}

export interface HistoryChanges {
  /** A payee an earlier manifest gave to another route, now on a route with the same terms. */
  reusedSameTerms: { now: ManifestRoute; earlier: ManifestRoute }[];
  /** The same, but with a different price or other terms: information only. */
  reusedOtherTerms: { now: ManifestRoute; earlier: ManifestRoute }[];
  /** Entries whose payee changed since an earlier manifest: information only. */
  moved: { now: ManifestRoute; earlier: ManifestRoute }[];
}

const samePayee = (a: ManifestRoute, b: ManifestRoute): boolean =>
  a.address !== undefined && b.address !== undefined
    ? a.address.toLowerCase() === b.address.toLowerCase()
    : a.index !== undefined &&
      b.index !== undefined &&
      a.index === b.index &&
      schemeOf(a) === schemeOf(b) &&
      a.network === b.network;
const entryKey = (r: ManifestRoute) => `${r.route}|${r.tier ?? ''}|${scope(r)}`;
const payeeText = (r: ManifestRoute) =>
  r.address !== undefined
    ? `a:${r.address.toLowerCase()}`
    : r.index !== undefined
      ? `i:${r.index}`
      : `p:${r.perResource?.baseIndex}`;

/** Compares this manifest's fixed payees with every earlier manifest's. */
export function historyChanges(routes: ManifestRoute[], previous: Manifest[]): HistoryChanges {
  const out: HistoryChanges = { reusedSameTerms: [], reusedOtherTerms: [], moved: [] };
  const seen = new Set<string>();
  const add = (list: keyof HistoryChanges, now: ManifestRoute, earlier: ManifestRoute) => {
    const key = `${list}|${entryKey(now)}|${entryKey(earlier)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out[list].push({ now, earlier });
  };
  for (const p of previous) {
    for (const earlier of p.routes) {
      for (const now of routes) {
        if (entryKey(now) === entryKey(earlier) && payeeText(now) !== payeeText(earlier)) add('moved', now, earlier);
        if (now.route === earlier.route || now.perResource || earlier.perResource) continue;
        if (!samePayee(now, earlier)) continue;
        add(terms(now) === terms(earlier) ? 'reusedSameTerms' : 'reusedOtherTerms', now, earlier);
      }
    }
  }
  return out;
}

/** X402-03.stale-mapping: an earlier route's payee is now on a different route with the same terms. */
export function staleMapping(routes: ManifestRoute[], ctx: StaticContext): CheckResult {
  if (ctx.previousUnreadable > 0) return couldNotVerify('stale-mapping', 'previous-unreadable');
  if (!ctx.previous.length) return notApplicable('stale-mapping');
  const { reusedSameTerms } = historyChanges(routes, ctx.previous);
  if (!reusedSameTerms.length) return noProblem('stale-mapping');
  const groups = reusedSameTerms.map(({ now, earlier }) => ({
    ...groupOf([now], true),
    routes: [{ ...ref(now), earlierRoute: earlier.route }],
  }));
  return problem('stale-mapping', groups);
}
