// The request budget: requests per route and requests in flight per route, from the registry's
// per-check budgets, never above the hard ceilings of 20 and 10. Counters only, no clocks or timers.
import { getCheck } from '@dabsproof/registry';

export const HARD_LIMITS = Object.freeze({ requestsPerRoute: 20, burst: 10 });

export interface BudgetLimits {
  requestsPerRoute: number;
  burst: number;
}

export type BudgetCode = 'unknown-check' | 'no-budget' | 'route-request-limit' | 'burst-limit';

const within = (n: number, max: number): number => (Number.isInteger(n) && n > 0 ? Math.min(n, max) : 0);

/** Each value at most its hard ceiling, and never below 0. */
export function clampLimits(limits: BudgetLimits): BudgetLimits {
  return {
    requestsPerRoute: within(limits.requestsPerRoute, HARD_LIMITS.requestsPerRoute),
    burst: within(limits.burst, HARD_LIMITS.burst),
  };
}

/** A check's live budget from the registry (getCheck and its budget field), never above HARD_LIMITS. */
export function budgetFor(
  checkId: string,
): { ok: true; limits: BudgetLimits } | { ok: false; code: 'unknown-check' | 'no-budget' } {
  const entry = getCheck(checkId);
  if (!entry) return { ok: false, code: 'unknown-check' };
  if (!('budget' in entry) || !entry.budget) return { ok: false, code: 'no-budget' };
  return {
    ok: true,
    limits: clampLimits({ requestsPerRoute: entry.budget.requestsPerRoute, burst: entry.budget.burst }),
  };
}

/**
 * Counts requests per route for one run. "Burst" here means requests in flight at the same time for
 * one route: begun and not yet released. A burst of 0 in the registry means no burst, so one request
 * at a time is still allowed.
 */
export class RequestBudget {
  readonly #limits: BudgetLimits;
  readonly #sent = new Map<string, number>();
  readonly #inFlight = new Map<string, number>();

  constructor(limits: BudgetLimits) {
    this.#limits = clampLimits(limits);
  }

  /** Takes one request slot for this route, or refuses. release() frees the in-flight slot; a second call does nothing. */
  begin(route: string): { ok: true; release: () => void } | { ok: false; code: 'route-request-limit' | 'burst-limit' } {
    const sent = this.#sent.get(route) ?? 0;
    if (sent >= this.#limits.requestsPerRoute) return { ok: false, code: 'route-request-limit' };
    const flying = this.#inFlight.get(route) ?? 0;
    if (flying >= Math.max(this.#limits.burst, 1)) return { ok: false, code: 'burst-limit' };
    this.#sent.set(route, sent + 1);
    this.#inFlight.set(route, flying + 1);
    let released = false;
    return {
      ok: true,
      release: () => {
        if (released) return;
        released = true;
        this.#inFlight.set(route, Math.max((this.#inFlight.get(route) ?? 1) - 1, 0));
      },
    };
  }
}
