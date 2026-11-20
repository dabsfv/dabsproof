import { getPayToManager } from '@dabsproof/fixkit/next';
import { routeOptions } from '../../../lib/payto.js';
import { paid, refusal } from '../../../lib/respond.js';

export const dynamic = 'force-dynamic';

export function GET(request) {
  try {
    const tier = request.headers.get('x-demo-tier');
    return paid(getPayToManager(routeOptions()).payToFor({ route: '/api/tiered', ...(tier ? { tier } : {}) }));
  } catch (error) {
    return refusal(error);
  }
}
