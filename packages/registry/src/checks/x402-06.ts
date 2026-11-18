import type { CheckInput } from '../schema.js';
import {
  BASE_SEPOLIA,
  COULD_NOT_VERIFY,
  COVERS_ONLY,
  FACILITATOR_GLOSS,
  FIRST_DATE,
  FIRST_VERSION,
  GENERAL_GUIDANCE,
} from '../shared.js';

export const x402_06 = {
  id: 'X402-06',
  version: 1,
  status: 'experimental',
  title: "The seller checks the facilitator's answer",
  severity: 'medium',
  escalation: [{ to: 'high', when: 'a wrong answer from the facilitator leads to content being sent' }],
  kind: 'both',
  whatItTests: `Whether your service checks that the facilitator ${FACILITATOR_GLOSS} really approved and settled the payment, and what it does when the facilitator gives an error or an unexpected answer.`,
  whatSomeoneCouldDo:
    'Get paid content without paying, if your service treats an error, a timeout or a changed answer from the facilitator as success, or if someone else can change which facilitator your service uses.',
  preconditions: ['ownership-verified', 'seller-uses-our-standin-facilitator', 'code-access'],
  appliesTo: { x402Versions: [2], schemes: ['exact'], networks: [BASE_SEPOLIA] },
  budget: { draft: true, requestsPerRoute: 8, burst: 0, routes: 1, payments: 2 },
  evidence: ['request-record', 'settlement-receipt', 'config-finding'],
  outcomes: {
    'found-a-problem':
      'Your service sent paid content after the facilitator gave an error, or accepted an answer that did not show a settled payment.',
    'found-no-problem': `Your service sent content only when the facilitator confirmed settlement. ${COVERS_ONLY}`,
    'could-not-verify': `${COULD_NOT_VERIFY} Part of this check needs a test copy of your service pointed at our test facilitator.`,
    'not-applicable': 'This route does not take payments.',
  },
  remediation: {
    summary: 'Treat anything other than a clear, successful settlement answer from the facilitator as unpaid.',
    steps: [
      'Check that the answer says the payment settled, and that its amount, recipient and network match what the route asks for.',
      'Treat errors, timeouts and unexpected answers as unpaid.',
      "Read the facilitator's address from your own settings only, never from the request.",
    ],
    generalGuidance: GENERAL_GUIDANCE,
  },
  subChecks: [
    {
      id: 'X402-06.standin-always-valid',
      title: 'With a test facilitator that approves everything, your service still checks the payment itself',
      kind: 'live',
    },
    {
      id: 'X402-06.facilitator-error',
      title: 'Your service treats an error from the facilitator as unpaid',
      kind: 'live',
    },
    {
      id: 'X402-06.facilitator-config-source',
      title: "The facilitator's address comes only from your own settings",
      kind: 'static',
    },
  ],
  references: [],
  changelog: [{ version: 1, date: FIRST_DATE, change: FIRST_VERSION }],
} satisfies CheckInput;
