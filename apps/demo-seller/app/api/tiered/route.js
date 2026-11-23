import { getPayToManager } from '@dabsproof/fixkit/next';
import { entryFor } from '../../../lib/entry.js';
import { configuredOrigin } from '../../../lib/origin.js';
import { routeOptions } from '../../../lib/payto.js';
import { refusal, refusedWith } from '../../../lib/respond.js';
import { paymentRequired } from '../../../lib/x402.js';

export const dynamic = 'force-dynamic';

const ROUTE = '/api/tiered';

// Every request currently gets the 402 reply. A request carrying a payment header is not looked at:
// nothing here verifies or settles a payment, and T14 checks the reply is unchanged when two such
// header names are sent. Whether a buyer reads the body, or accepts this reply at all, is not
// verified. The tier comes from the x-demo-tier header; the fix kit's manager decides first, so a
// missing or unknown tier stays 503 tier-not-given. The price is the one for that tier.
// resource.url is the configured origin (DEMO_ORIGIN) plus this route's path; the tier is not in it.
// price-not-found is a backstop: the manager refuses an unmapped tier first, and no test reaches it.
export function GET(request) {
  try {
    const tier = request.headers.get('x-demo-tier');
    const manager = getPayToManager(routeOptions());
    const payTo = manager.payToFor({ route: ROUTE, ...(tier ? { tier } : {}) });
    const entry = entryFor(manager.validation?.manifest, ROUTE, tier);
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
