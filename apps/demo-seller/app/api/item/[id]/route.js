import { getPayToManager } from '@dabsproof/fixkit/next';
import { entryFor, idText } from '../../../../lib/entry.js';
import { configuredOrigin } from '../../../../lib/origin.js';
import { routeOptions } from '../../../../lib/payto.js';
import { refusal, refusedWith } from '../../../../lib/respond.js';
import { paymentRequired } from '../../../../lib/x402.js';

export const dynamic = 'force-dynamic';

const ROUTE = '/api/item/[id]';

// Every request currently gets the 402 reply. A request carrying a payment header is not looked at;
// what to do with one is undecided (S6). Whether a buyer reads the body, or accepts this reply at
// all, is not verified. The id is passed as Next.js gives it (text) and the fix kit's manager decides
// first: it accepts only one to ten digits within the mapping's range, and its refusals stay 503.
// resource.url is the configured origin (DEMO_ORIGIN) plus /api/item/ and the id text exactly as
// accepted, so "05" gives /api/item/05. The id check below repeats the manager's and is a backstop,
// as is price-not-found; no test reaches either.
export async function GET(_request, { params }) {
  try {
    const { id } = await params;
    const manager = getPayToManager(routeOptions());
    const payTo = manager.payToFor({ route: ROUTE, id });
    const item = idText(id);
    if (!item.ok) return refusedWith(item.code);
    const entry = entryFor(manager.validation?.manifest, ROUTE);
    if (entry === null) return refusedWith('price-not-found');
    const origin = configuredOrigin(process.env.DEMO_ORIGIN);
    if (!origin.ok) return refusedWith(origin.code);
    const r = paymentRequired({ entry, payTo, url: `${origin.origin}/api/item/${item.id}` });
    if (!r.ok) return refusedWith(r.code);
    return new Response(r.body, { status: r.status, headers: r.headers });
  } catch (error) {
    return refusal(error);
  }
}
