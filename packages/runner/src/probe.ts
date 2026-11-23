// The unpaid probe: one GET per route, one at a time, within X402-03's live budget, each reply
// recorded by core's recordRequest. Only unpaid requests: a route that names a payment header is
// refused. The result holds facts about each reply and nothing else: no outcome, no check result.
// A network code is a fact about what the reply named; a refused route is a fact about what was not
// sent. Body bytes, the raw PAYMENT-REQUIRED value and header values off the allow-lists are never
// kept, and nothing is printed.
import { createRunContext, type RequestRecord, recordRequest } from '@dabsproof/core';
import { budgetFor, RequestBudget } from './budget.js';
import { checkRequiredNetworks, type NetworkCode } from './network.js';
import { type SendCode, sendLocal } from './send.js';
import { checkTarget, type TargetCode } from './target.js';

export interface ProbeRoute {
  /** The manifest route, used as the budget key, for example /api/item/[id]. */
  route: string;
  /** The path actually requested, for example /api/item/5. */
  path: string;
  /** Plain request headers, for example x-demo-tier. Never a payment header. */
  headers?: Readonly<Record<string, string>>;
}

/** What happened on one route. */
export type ProbeEntry =
  | { route: string; sent: false; code: SendCode | 'payment-header-not-allowed' }
  | {
      route: string;
      sent: true;
      record: RequestRecord;
      /** For a 402 reply: whether every accepts entry named Base Sepolia. Otherwise null. */
      network: { ok: true } | { ok: false; code: NetworkCode } | null;
    };

export type ProbeCode = TargetCode | 'no-routes' | 'too-many-routes' | 'budget-unavailable';

/** The check whose live budget the probe uses: X402-03 compares what each route asks for. */
const BUDGET_CHECK = 'X402-03';
const MAX_ROUTES = 50;
const PAYMENT_HEADERS = ['payment-signature', 'x-payment', 'payment-required'];

/** Sends one unpaid GET per route, one at a time, and records each reply. */
export async function probeUnpaid(
  target: unknown,
  options: { local: boolean },
  routes: readonly ProbeRoute[],
): Promise<{ ok: true; runId: string; entries: ProbeEntry[] } | { ok: false; code: ProbeCode }> {
  const checked = checkTarget(target, options);
  if (!checked.ok) return checked;
  if (!Array.isArray(routes) || routes.length === 0) return { ok: false, code: 'no-routes' };
  if (routes.length > MAX_ROUTES) return { ok: false, code: 'too-many-routes' };
  const limits = budgetFor(BUDGET_CHECK);
  if (!limits.ok) return { ok: false, code: 'budget-unavailable' };
  const budget = new RequestBudget(limits.limits);
  const ctx = createRunContext();
  const entries: ProbeEntry[] = [];
  for (const r of routes) {
    const headers = r.headers ?? {};
    if (Object.keys(headers).some((name) => PAYMENT_HEADERS.includes(name.toLowerCase()))) {
      entries.push({ route: r.route, sent: false, code: 'payment-header-not-allowed' });
      continue;
    }
    const reply = await sendLocal(checked.target, budget, r.route, r.path, headers);
    if (!reply.ok) {
      entries.push({ route: r.route, sent: false, code: reply.code });
      continue;
    }
    const record = recordRequest(ctx, {
      method: 'GET',
      url: `${checked.target.origin}${r.path}`,
      requestHeaders: headers,
      status: reply.status,
      responseHeaders: reply.headers,
      body: reply.body,
    });
    const network = reply.status === 402 ? checkRequiredNetworks(reply.headers['payment-required']) : null;
    entries.push({ route: r.route, sent: true, record, network });
  }
  return { ok: true, runId: ctx.runId, entries };
}
