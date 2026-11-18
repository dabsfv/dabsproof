import type { CheckInput } from '../schema.js';
import { BASE_SEPOLIA, COULD_NOT_VERIFY, COVERS_ONLY, FIRST_DATE, FIRST_VERSION, GENERAL_GUIDANCE } from '../shared.js';

export const x402_02 = {
  id: 'X402-02',
  version: 1,
  status: 'experimental',
  title: 'Content only after the payment has settled',
  severity: 'high',
  kind: 'both',
  whatItTests: 'Whether your service waits for the payment to settle before it sends the paid content.',
  whatSomeoneCouldDo:
    'Get paid content without paying, by sending a payment that is valid when checked but never settles, for example because the same funds are spent elsewhere first.',
  preconditions: ['ownership-verified', 'code-access'],
  appliesTo: { x402Versions: [2], schemes: ['exact'], networks: [BASE_SEPOLIA] },
  budget: { draft: true, requestsPerRoute: 4, burst: 2, routes: 1, payments: 2 },
  evidence: ['code-citation', 'request-record', 'settlement-receipt', 'balance-delta'],
  outcomes: {
    'found-a-problem': 'Paid content was sent for a payment that did not settle.',
    'found-no-problem': `Paid content was sent only after the payment settled. ${COVERS_ONLY}`,
    'could-not-verify': COULD_NOT_VERIFY,
    'not-applicable': 'This route does not take payments.',
  },
  remediation: {
    summary: 'Settle the payment first, then send the content. If settlement fails, send a 402 reply and no content.',
    steps: [
      'Wait for the settlement answer before you write any of the response.',
      'Treat a settlement error or timeout as unpaid.',
      'Do not stream or cache any content before settlement succeeds.',
    ],
    generalGuidance: GENERAL_GUIDANCE,
    notAFix: ['Verifying a payment without settling it. A verified payment can still fail to settle.'],
  },
  subChecks: [
    { id: 'X402-02.code-order', title: 'The code sends content only after settlement succeeds', kind: 'static' },
    { id: 'X402-02.balance-race', title: 'Two fresh payments from a wallet that can pay for only one', kind: 'live' },
  ],
  references: [],
  changelog: [{ version: 1, date: FIRST_DATE, change: FIRST_VERSION }],
} satisfies CheckInput;
