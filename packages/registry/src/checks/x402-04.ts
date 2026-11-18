import type { CheckInput } from '../schema.js';
import { BASE_SEPOLIA, COULD_NOT_VERIFY, COVERS_ONLY, FIRST_DATE, FIRST_VERSION, GENERAL_GUIDANCE } from '../shared.js';

export const x402_04 = {
  id: 'X402-04',
  version: 1,
  status: 'experimental',
  title: 'Paid responses cannot be cached and re-served',
  severity: 'medium',
  escalation: [{ to: 'high', when: 'the paid content is specific to the payer' }],
  kind: 'live',
  whatItTests:
    'Whether a shared cache, such as a CDN, could store a paid response and give it to people who have not paid.',
  whatSomeoneCouldDo: 'Get paid content free from a cache, after someone else has paid for it.',
  preconditions: ['ownership-verified'],
  appliesTo: { x402Versions: [2], schemes: ['exact'], networks: [BASE_SEPOLIA] },
  budget: { draft: true, requestsPerRoute: 6, burst: 0, routes: 1, payments: 1 },
  evidence: ['request-record'],
  outcomes: {
    'found-a-problem':
      'A paid response could be stored by a shared cache, or was served without payment after a paid request.',
    'found-no-problem': `Paid responses were marked as not to be stored, and were not served again without payment. ${COVERS_ONLY}`,
    'could-not-verify': COULD_NOT_VERIFY,
    'not-applicable': 'This route does not take payments.',
  },
  remediation: {
    summary:
      'Mark every paid response as private and not to be stored, and make sure no cache in front of paid routes ignores that.',
    steps: [
      'Send `Cache-Control: private, no-store` on every paid response, and `Cache-Control: no-store` on every 402 reply.',
      'Check that your hosting or CDN settings do not cache paid routes whatever the headers say.',
    ],
    generalGuidance: GENERAL_GUIDANCE,
  },
  subChecks: [
    { id: 'X402-04.paid-headers', title: 'Paid responses tell caches not to store them', kind: 'live' },
    {
      id: 'X402-04.unpaid-after-paid',
      title: 'A request without payment, sent after a paid one, gets the paid content',
      kind: 'live',
    },
  ],
  references: [],
  changelog: [{ version: 1, date: FIRST_DATE, change: FIRST_VERSION }],
} satisfies CheckInput;
