// core/static/analyse(manifest): the one static-analysis function (plan §1.2).
import { BASE_SEPOLIA, type Outcome } from '@dabsproof/registry';
import type { Manifest, ManifestRoute } from '../manifest/schema.js';
import type { CheckResult } from '../results/types.js';
import { STATIC_IMPLEMENTATIONS } from './implementations.js';

export interface StaticReport {
  routesRead: number;
  checkedRoutes: ManifestRoute[];
  skippedRoutes: ManifestRoute[];
  results: CheckResult[];
  overall: Outcome;
  exitCode: 0 | 1 | 2;
}

/** 1 if a problem was found; else 2 if anything could not be verified; else 0. */
export function exitCodeFor(results: Pick<CheckResult, 'outcome'>[]): 0 | 1 | 2 {
  if (results.some((r) => r.outcome === 'found-a-problem')) return 1;
  if (results.some((r) => r.outcome === 'could-not-verify')) return 2;
  return 0;
}

function overallOf(results: CheckResult[]): Outcome {
  if (results.some((r) => r.outcome === 'found-a-problem')) return 'found-a-problem';
  if (results.some((r) => r.outcome === 'could-not-verify')) return 'could-not-verify';
  if (results.some((r) => r.outcome === 'found-no-problem')) return 'found-no-problem';
  return 'not-applicable';
}

export function analyse(manifest: Manifest): StaticReport {
  const checkedRoutes = manifest.routes.filter((r) => r.network === BASE_SEPOLIA);
  const skippedRoutes = manifest.routes.filter((r) => r.network !== BASE_SEPOLIA);
  const results: CheckResult[] = checkedRoutes.length
    ? STATIC_IMPLEMENTATIONS.map((impl) => impl.run(checkedRoutes))
    : STATIC_IMPLEMENTATIONS.map((impl) => ({
        ...impl.run([]),
        outcome: 'could-not-verify' as const,
        groups: [],
        note: 'nothing-checked',
      }));
  return {
    routesRead: manifest.routes.length,
    checkedRoutes,
    skippedRoutes,
    results,
    overall: overallOf(results),
    exitCode: exitCodeFor(results),
  };
}
