import { getPayToManager } from '@dabsproof/fixkit/next';
import { entryFor } from '../../../lib/entry.js';
import { configuredOrigin } from '../../../lib/origin.js';
import { decidePaid } from '../../../lib/paid.js';
import { routeOptions } from '../../../lib/payto.js';
import { refusal, refusedWith } from '../../../lib/respond.js';
import { paymentRequired } from '../../../lib/x402.js';

export const dynamic = 'force-dynamic';

const ROUTE = '/api/paid';

// A test-only fake paid path. It has no check of its own and trusts whatever the configured
// facilitator approves: that is a fact about this demo, not a model for a real seller, and it says
// nothing about real facilitators, buyers or settlement. It never logs or stores the payment header
// or its payload. Without a payment-signature header it gives the same 402 as the other routes; it
// reads that one header only (an X-PAYMENT header is never read). With one, the facilitator must be
// set in DEMO_FACILITATOR_URL as a literal 127.0.0.1 origin, else 503 facilitator-not-given. The
// facilitator call uses decidePaid's default deadline of 1000 ms. Paid gives 200 with a fixed test
// body; every unpaid outcome, including a facilitator error or timeout, gives the same 402. Fix kit
// refusals stay 503 and come first.
export async function GET(request) {
  try {
    const manager = getPayToManager(routeOptions());
    const payTo = manager.payToFor({ route: ROUTE });
    const entry = entryFor(manager.validation?.manifest, ROUTE);
    if (entry === null) return refusedWith('price-not-found');
    const origin = configuredOrigin(process.env.DEMO_ORIGIN);
    if (!origin.ok) return refusedWith(origin.code);
    const r = paymentRequired({ entry, payTo, url: `${origin.origin}${ROUTE}` });
    if (!r.ok) return refusedWith(r.code);
    const unpaid = () => new Response(r.body, { status: r.status, headers: r.headers });
    const headerValue = request.headers.get('payment-signature');
    if (headerValue === null) return unpaid();
    const facilitator = configuredOrigin(process.env.DEMO_FACILITATOR_URL);
    if (!facilitator.ok) return refusedWith('facilitator-not-given');
    const requirement = JSON.parse(r.body).accepts[0];
    const decision = await decidePaid({
      headerValue,
      requirement,
      facilitatorOrigin: facilitator.origin,
      fetch: globalThis.fetch,
    });
    if (!decision.paid) return unpaid();
    return Response.json({ content: 'demo-paid-content' });
  } catch (error) {
    return refusal(error);
  }
}
