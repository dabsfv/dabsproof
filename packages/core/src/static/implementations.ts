// The static sub-checks that have an implementation. The coverage test compares this list
// with the registry. Order is the order results are reported in: a cause before its effects.
import type { ManifestRoute } from '../manifest/schema.js';
import type { CheckResult, StaticContext } from '../results/types.js';
import { crossRoute, dupIndex, dynamicPerPattern, indexRangeOverlap, staleMapping, tiers } from './checks/x402-03.js';

export const STATIC_IMPLEMENTATIONS: ReadonlyArray<{
  subCheckId: string;
  run: (routes: ManifestRoute[], ctx: StaticContext) => CheckResult;
}> = Object.freeze([
  { subCheckId: 'X402-03.dup-index', run: dupIndex },
  { subCheckId: 'X402-03.index-range-overlap', run: indexRangeOverlap },
  { subCheckId: 'X402-03.cross-route', run: crossRoute },
  { subCheckId: 'X402-03.dynamic-per-pattern', run: dynamicPerPattern },
  { subCheckId: 'X402-03.tiers', run: tiers },
  { subCheckId: 'X402-03.stale-mapping', run: staleMapping },
]);
