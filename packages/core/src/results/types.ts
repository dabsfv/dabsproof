// One result per sub-check. Sellers never see pass or fail: outcomes come from the registry.
import type { Outcome, Severity } from '@dabsproof/registry';

export interface RouteRef {
  route: string;
  /** The payment address as written in the manifest, or undefined when the route uses an index. */
  address?: string;
  index?: number;
}

export interface ResultGroup {
  routes: RouteRef[];
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
