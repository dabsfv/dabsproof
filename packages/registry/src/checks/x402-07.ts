import type { CheckInput } from '../schema.js';
import { BASE_SEPOLIA, COULD_NOT_VERIFY, COVERS_ONLY, FIRST_DATE, FIRST_VERSION, GENERAL_GUIDANCE } from '../shared.js';

export const x402_07 = {
  id: 'X402-07',
  version: 1,
  status: 'experimental',
  title: 'Pay-by-use caps cannot be overspent',
  severity: 'high',
  kind: 'live',
  whatItTests:
    'For routes that charge by use up to a cap, whether someone can be served more than the cap they agreed to pay.',
  whatSomeoneCouldDo:
    'Use more than they paid for, by sending several requests at once, or one request larger than what is left.',
  preconditions: ['ownership-verified', 'upto-route'],
  appliesTo: { x402Versions: [2], schemes: ['upto'], networks: [BASE_SEPOLIA] },
  budget: { draft: true, requestsPerRoute: 12, burst: 10, routes: 1, payments: 2 },
  evidence: ['request-record', 'payment-terms', 'settlement-receipt'],
  outcomes: {
    'found-a-problem': 'Usage went over the agreed cap.',
    'found-no-problem': `Usage stayed within the agreed cap, including during a burst. ${COVERS_ONLY}`,
    'could-not-verify': COULD_NOT_VERIFY,
    'not-applicable': 'This route does not use pay-by-use caps.',
  },
  remediation: {
    summary: 'Reserve usage against the cap in one step before doing the work, and refuse anything over what is left.',
    steps: [
      'Before serving, reserve the amount in one indivisible step that also checks what is left.',
      'Refuse a request that would go over the cap.',
      'Release any unused reservation only after the work is finished.',
    ],
    generalGuidance: GENERAL_GUIDANCE,
  },
  subChecks: [
    {
      id: 'X402-07.burst-over-cap',
      title: 'Several requests at the same moment that together go over the cap',
      kind: 'live',
    },
    {
      id: 'X402-07.single-over-remaining',
      title: 'One request that asks for more than is left under the cap',
      kind: 'live',
    },
  ],
  references: [],
  changelog: [{ version: 1, date: FIRST_DATE, change: FIRST_VERSION }],
} satisfies CheckInput;
