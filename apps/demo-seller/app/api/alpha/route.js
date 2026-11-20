import { getPayToManager } from '@dabsproof/fixkit/next';
import { routeOptions } from '../../../lib/payto.js';
import { paid, refusal } from '../../../lib/respond.js';

export const dynamic = 'force-dynamic';

export function GET() {
  try {
    return paid(getPayToManager(routeOptions()).payToFor({ route: '/api/alpha' }));
  } catch (error) {
    return refusal(error);
  }
}
