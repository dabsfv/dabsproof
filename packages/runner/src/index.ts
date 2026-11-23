// The live runner so far: the local target check (literal 127.0.0.1 or ::1 with a local flag), the
// request budget, the local send (one GET, no redirect followed, body capped), the Base Sepolia check
// on a PAYMENT-REQUIRED value, the unpaid probe that records each route's reply, and the comparison
// of what those replies ask for across routes (facts only, no outcome). No signing, no chain call, no
// facilitator and no payment. Nothing here is used by the CLI.
export { type BudgetCode, type BudgetLimits, budgetFor, clampLimits, HARD_LIMITS, RequestBudget } from './budget.js';
export {
  type ComparedOption,
  type Comparison,
  compareRoutes,
  type NotCompared,
  type NotComparedCode,
  type PairFacts,
  type Sameness,
} from './compare.js';
export { checkRequiredNetworks, type NetworkCode } from './network.js';
export { type ProbeCode, type ProbeEntry, type ProbeRoute, probeUnpaid } from './probe.js';
export { buildRequest, MAX_BODY_BYTES, type SendCode, sendLocal } from './send.js';
export { checkTarget, type LocalTarget, type TargetCode } from './target.js';
