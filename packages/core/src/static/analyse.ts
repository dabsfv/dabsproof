// core/static/analyse(manifest): the one static-analysis function (plan §1.2).
// Static analysis reads the manifest only and sends nothing, so it may read any network the
// registry lists in appliesTo.staticNetworks (X402-03: any EVM network). Live runs use
// appliesTo.networks, which stays Base Sepolia only; nothing here reads it.
import { BASE_SEPOLIA, getCheck, type Outcome } from '@dabsproof/registry';
import { EVM_NETWORK, type Manifest, type ManifestRoute, type NotExported, schemeOf } from '../manifest/schema.js';
import type { CheckResult, StaticContext } from '../results/types.js';
import { type HistoryChanges, historyChanges } from './checks/x402-03.js';
import { STATIC_IMPLEMENTATIONS } from './implementations.js';

export interface AnalyseOptions {
  /** Earlier manifests, oldest first, for .stale-mapping. */
  previous?: Manifest[];
  /** How many earlier manifests were given but could not be read. */
  previousUnreadable?: number;
}

export interface StaticReport {
  routesRead: number;
  checkedRoutes: ManifestRoute[];
  /** Routes on networks static analysis does not read. */
  skippedRoutes: ManifestRoute[];
  /** Checked routes on networks other than Base Sepolia: information only. */
  otherNetworkRoutes: ManifestRoute[];
  /** Routes the configuration did not fix (from exportManifest()); they could not be checked. */
  notExported: NotExported[];
  /** Checked routes that give each item its own address; left out of .cross-route and .dup-index. */
  perResourceRoutes: ManifestRoute[];
  /** True when the checked routes use more than one payment scheme. */
  mixedSchemes: boolean;
  /** True when any checked route has tiers. */
  hasTiers: boolean;
  /** Changes since the earlier manifests: information lines (the finding itself is .stale-mapping). */
  history: HistoryChanges;
  previousCompared: number;
  results: CheckResult[];
  overall: Outcome;
  exitCode: 0 | 1 | 2;
}

/** 1 if a problem was found; else 2 if anything could not be verified; else 0. */
export function exitCodeFor(results: Pick<CheckResult, 'outcome'>[], unverifiedRoutes = 0): 0 | 1 | 2 {
  if (results.some((r) => r.outcome === 'found-a-problem')) return 1;
  if (unverifiedRoutes > 0 || results.some((r) => r.outcome === 'could-not-verify')) return 2;
  return 0;
}

function overallOf(results: CheckResult[], unverifiedRoutes: number): Outcome {
  if (results.some((r) => r.outcome === 'found-a-problem')) return 'found-a-problem';
  if (unverifiedRoutes > 0 || results.some((r) => r.outcome === 'could-not-verify')) return 'could-not-verify';
  if (results.some((r) => r.outcome === 'found-no-problem')) return 'found-no-problem';
  return 'not-applicable';
}

/** The networks X402-03's static checks read: appliesTo.staticNetworks, else appliesTo.networks. */
export function staticNetworkFilter(): (network: string) => boolean {
  const c = getCheck('X402-03');
  if (!c || (c.status !== 'active' && c.status !== 'experimental'))
    throw new Error('X402-03 is missing from the registry');
  const rule = c.appliesTo.staticNetworks ?? c.appliesTo.networks;
  return rule === 'any-evm' ? (n) => EVM_NETWORK.test(n) : (n) => (rule as readonly string[]).includes(n);
}

export function analyse(manifest: Manifest, options: AnalyseOptions = {}): StaticReport {
  const reads = staticNetworkFilter();
  const checkedRoutes = manifest.routes.filter((r) => reads(r.network));
  const skippedRoutes = manifest.routes.filter((r) => !reads(r.network));
  const notExported = manifest.notExported ?? [];
  const ctx: StaticContext = { previous: options.previous ?? [], previousUnreadable: options.previousUnreadable ?? 0 };
  const note = manifest.routes.length ? 'nothing-checked' : 'nothing-fixed';
  const results: CheckResult[] = checkedRoutes.length
    ? STATIC_IMPLEMENTATIONS.map((impl) => impl.run(checkedRoutes, ctx))
    : STATIC_IMPLEMENTATIONS.map((impl) => ({
        ...impl.run([], ctx),
        outcome: 'could-not-verify' as const,
        groups: [],
        note,
      }));
  return {
    routesRead: manifest.routes.length,
    checkedRoutes,
    skippedRoutes,
    otherNetworkRoutes: checkedRoutes.filter((r) => r.network !== BASE_SEPOLIA),
    notExported,
    perResourceRoutes: checkedRoutes.filter((r) => r.perResource !== undefined),
    mixedSchemes: new Set(checkedRoutes.map(schemeOf)).size > 1,
    hasTiers: checkedRoutes.some((r) => r.tier !== undefined),
    history: historyChanges(checkedRoutes, ctx.previous),
    previousCompared: ctx.previous.length,
    results,
    overall: overallOf(results, notExported.length),
    exitCode: exitCodeFor(results, notExported.length),
  };
}
