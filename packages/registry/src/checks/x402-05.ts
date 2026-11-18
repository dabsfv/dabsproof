import type { CheckInput } from '../schema.js';
import { BASE_SEPOLIA, COULD_NOT_VERIFY, COVERS_ONLY, FIRST_DATE, FIRST_VERSION, GENERAL_GUIDANCE } from '../shared.js';

export const x402_05 = {
  id: 'X402-05',
  version: 1,
  status: 'experimental',
  title: 'The payment header is read once and kept out of logs',
  severity: 'medium',
  kind: 'both',
  whatItTests:
    'Whether your service reads exactly one payment header, in one place, and keeps signed payments out of logs.',
  whatSomeoneCouldDo:
    'Send two different payments in one request, so that one part of your service checks one payment and another part settles the other. Or take a signed payment from a log and use it before it is settled.',
  preconditions: ['ownership-verified', 'code-access'],
  appliesTo: { x402Versions: [2], schemes: ['exact'], networks: [BASE_SEPOLIA] },
  budget: { draft: true, requestsPerRoute: 6, burst: 0, routes: 1, payments: 3 },
  evidence: ['request-record', 'code-citation', 'config-finding'],
  outcomes: {
    'found-a-problem':
      'Your service accepted more than one payment header, read different headers in different places, or wrote a signed payment to a log.',
    'found-no-problem': `Your service read one payment header, and the logs checked held no signed payments. ${COVERS_ONLY}`,
    'could-not-verify': COULD_NOT_VERIFY,
    'not-applicable': 'This route does not take payments.',
  },
  remediation: {
    summary: 'Read the payment from one header, in one place, and refuse requests that carry more than one.',
    steps: [
      'Refuse a request that has the payment header twice, or both `PAYMENT-SIGNATURE` and `X-PAYMENT`.',
      'Pass the decoded payment from that one place to every later step.',
      'Never log the payment header, its signature or its nonce. Log only that a payment was present.',
    ],
    generalGuidance: GENERAL_GUIDANCE,
  },
  subChecks: [
    { id: 'X402-05.duplicate-header', title: 'A request carrying the payment header twice', kind: 'live' },
    {
      id: 'X402-05.legacy-header',
      title: 'A request carrying both the current header (`PAYMENT-SIGNATURE`) and the older header (`X-PAYMENT`)',
      kind: 'live',
    },
    { id: 'X402-05.logging', title: 'The payment header is written to logs', kind: 'static' },
  ],
  references: [],
  changelog: [{ version: 1, date: FIRST_DATE, change: FIRST_VERSION }],
} satisfies CheckInput;
