import { getPayToManager } from '@dabsproof/fixkit/next';
import { entryFor } from '../../../lib/entry.js';
import { configuredOrigin } from '../../../lib/origin.js';
import { routeOptions } from '../../../lib/payto.js';
import { refusal, refusedWith } from '../../../lib/respond.js';
import { paymentRequired } from '../../../lib/x402.js';

export const dynamic = 'force-dynamic';

const ROUTE = '/api/alpha';

// Every request currently gets the 402 reply. A request carrying a payment header is not looked at:
// nothing here verifies or settles a payment, and T14 checks the reply is unchanged when two such
// header names are sent. resource.url is the configured origin (DEMO_ORIGIN) plus this
// route's path; it is not taken from the request. Observed once, not a claim: under Next.js 16.4.6,
// next start -H 127.0.0.1, on one Mac, request.url named localhost:4319 although every request went
// to 127.0.0.1:4319; why could not be verified, and other setups were not tested. Whether a buyer
// reads the body, or accepts this reply at all, is not verified. Fix kit refusals stay 503 and come
// first. price-not-found is a backstop: payToFor refuses an unmapped route first, and no test reaches it.
export function GET() {
  try {
    const manager = getPayToManager(routeOptions());
    const payTo = manager.payToFor({ route: ROUTE });
    const entry = entryFor(manager.validation?.manifest, ROUTE);
    if (entry === null) return refusedWith('price-not-found');
    const origin = configuredOrigin(process.env.DEMO_ORIGIN);
    if (!origin.ok) return refusedWith(origin.code);
    const r = paymentRequired({ entry, payTo, url: `${origin.origin}${ROUTE}` });
    if (!r.ok) return refusedWith(r.code);
    return new Response(r.body, { status: r.status, headers: r.headers });
  } catch (error) {
    return refusal(error);
  }
}
