// The static sub-checks that have an implementation. The coverage test compares this list
// with the registry. Order is the order results are reported in: a cause before its effects.
import type { ManifestRoute } from '../manifest/schema.js';
import type { CheckResult } from '../results/types.js';
import { crossRoute, dupIndex } from './checks/x402-03.js';

export const STATIC_IMPLEMENTATIONS: ReadonlyArray<{
  subCheckId: string;
  run: (routes: ManifestRoute[]) => CheckResult;
}> = Object.freeze([
  { subCheckId: 'X402-03.dup-index', run: dupIndex },
  { subCheckId: 'X402-03.cross-route', run: crossRoute },
]);
