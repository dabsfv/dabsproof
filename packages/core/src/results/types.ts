// One result per sub-check. Sellers never see pass or fail: outcomes come from the registry.
import type { Outcome, Severity } from '@dabsproof/registry';
import type { Manifest } from '../manifest/schema.js';

export interface RouteRef {
  route: string;
  tier?: string;
  scheme: string;
  /** The payment address as written in the manifest, or undefined when the route uses an index. */
  address?: string;
  index?: number;
  /** For a per-item route: the address indexes its items use, when its item ids are given. */
  range?: { first: number; last: number };
  /** For .stale-mapping: the route an earlier manifest gave this payee to. */
  earlierRoute?: string;
}

export interface ResultGroup {
  routes: RouteRef[];
  scheme: string;
  network: string;
  asset: string;
  price?: string;
  /** Set when this group is the same mistake as a result reported by another sub-check. */
  sameMistakeAs?: string;
}

export interface CheckResult {
  checkId: string;
  checkVersion: number;
  subCheckId: string;
  outcome: Outcome;
  severity?: Severity;
  verifiedBy: 'run' | 'code-reading' | 'config';
  groups: ResultGroup[];
  /** Why the result is not applicable or could not be verified, when the registry text is not enough. */
  note?: string;
}

/** What static checks may use besides the routes: earlier manifests, for .stale-mapping. */
export interface StaticContext {
  previous: Manifest[];
  /** Earlier manifests that were given but could not be read. */
  previousUnreadable: number;
}
