import { getPayToManager } from '@dabsproof/fixkit/next';
import { routeOptions } from '../../../../lib/payto.js';
import { paid, refusal } from '../../../../lib/respond.js';

export const dynamic = 'force-dynamic';

// The id is passed as Next.js gives it (text). The manager alone decides: it accepts only one to
// ten digits, and refuses anything outside the mapping's range.
export async function GET(_request, { params }) {
  try {
    const { id } = await params;
    return paid(getPayToManager(routeOptions()).payToFor({ route: '/api/item/[id]', id }));
  } catch (error) {
    return refusal(error);
  }
}
