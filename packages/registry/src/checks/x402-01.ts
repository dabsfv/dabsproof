import type { CheckInput } from '../schema.js';
import { BASE_SEPOLIA, COULD_NOT_VERIFY, COVERS_ONLY, FIRST_DATE, FIRST_VERSION, GENERAL_GUIDANCE } from '../shared.js';

export const x402_01 = {
  id: 'X402-01',
  version: 1,
  status: 'experimental',
  title: 'One payment, one delivery, even under a burst',
  severity: 'high',
  kind: 'both',
  whatItTests:
    'Whether one signed payment can unlock your paid content more than once, when copies arrive together or later.',
  whatSomeoneCouldDo:
    'Pay once and receive the paid content several times, by sending copies of the same signed payment at the same moment or again later.',
  preconditions: ['ownership-verified'],
  appliesTo: { x402Versions: [2], schemes: ['exact'], networks: [BASE_SEPOLIA] },
  budget: { draft: true, requestsPerRoute: 20, burst: 10, routes: 1, payments: 2 },
  evidence: ['request-record', 'payment-terms', 'settlement-receipt'],
  outcomes: {
    'found-a-problem': 'One payment unlocked the paid content more than once.',
    'found-no-problem': `Each payment unlocked the paid content once, including when copies arrived together or later. ${COVERS_ONLY}`,
    'could-not-verify': COULD_NOT_VERIFY,
    'not-applicable': 'This route does not take payments.',
  },
  remediation: {
    summary:
      'Record each payment as used before you send the content, in one step that cannot run twice for the same payment.',
    steps: [
      'Keep a unique record for each payment, and create it in the same database operation that checks it is new.',
      'Send the content only after that operation succeeds.',
      'Answer any later copy of the same payment with a 402 reply.',
    ],
    generalGuidance: GENERAL_GUIDANCE,
    notAFix: [
      'Checking for repeats in memory on one server. Copies can reach other servers, or arrive at the same moment.',
    ],
  },
  subChecks: [
    { id: 'X402-01.burst', title: 'Ten copies of one fresh payment sent at the same moment', kind: 'live' },
    { id: 'X402-01.late-replay', title: 'The same payment sent again after it has settled', kind: 'live' },
  ],
  references: [],
  changelog: [{ version: 1, date: FIRST_DATE, change: FIRST_VERSION }],
} satisfies CheckInput;
