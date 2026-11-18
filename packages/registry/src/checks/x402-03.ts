import type { CheckInput } from '../schema.js';
import { BASE_SEPOLIA, COULD_NOT_VERIFY, COVERS_ONLY, FIRST_DATE, FIRST_VERSION, GENERAL_GUIDANCE } from '../shared.js';

export const x402_03 = {
  id: 'X402-03',
  version: 1,
  status: 'experimental',
  title: 'A payment is tied to the route it was made for',
  severity: 'medium',
  escalation: [{ to: 'high', when: 'routes with the same price give access to content of different value' }],
  kind: 'both',
  whatItTests:
    'Whether a payment made for one paid route can be used on a different paid route that has the same price and terms.',
  whatSomeoneCouldDo:
    'Pay for one route and use that payment to get a different route with the same price, or use one payment across many routes.',
  preconditions: ['two-paid-routes-same-terms', 'ownership-verified'],
  appliesTo: { x402Versions: [2], schemes: ['exact'], networks: [BASE_SEPOLIA] },
  budget: { draft: true, requestsPerRoute: 20, burst: 0, routes: 'all', payments: 4 },
  evidence: ['config-finding', 'code-citation', 'request-record', 'payment-terms'],
  outcomes: {
    'found-a-problem': 'A payment made for one route was accepted by another route.',
    'found-no-problem': `Payments were accepted only on the route they were made for. ${COVERS_ONLY}`,
    'could-not-verify': COULD_NOT_VERIFY,
    'not-applicable':
      'Fewer than two paid routes share the same price and terms, so a payment cannot be moved between them.',
  },
  remediation: {
    summary: 'Make each payment usable only on the route it was made for.',
    steps: [
      "Give each paid route its own payment address, so a payment's recipient shows which route it was for. It is not part of the x402 specification, and whether official guidance recommends it has not been checked.",
      "Before sending content, check that the payment's recipient is the address of the route being requested.",
      'Keep the route-to-address list in one place, and check it when your service starts.',
    ],
    generalGuidance: GENERAL_GUIDANCE,
    fixKit: 'per-route-address',
    notAFix: ["Different prices alone. Two routes with the same price still accept each other's payments."],
  },
  subChecks: [
    { id: 'X402-03.cross-route', title: 'A payment made for one route is accepted by another', kind: 'both' },
    { id: 'X402-03.dup-index', title: 'Two routes are given the same address index', kind: 'static' },
    {
      id: 'X402-03.dynamic-per-pattern',
      title: 'Every page of a dynamic route shares one payment address',
      kind: 'static',
    },
    { id: 'X402-03.query-variants', title: 'A payment for one query string is accepted for another', kind: 'live' },
    { id: 'X402-03.tiers', title: 'Different price tiers share a payment address', kind: 'static' },
    { id: 'X402-03.stale-mapping', title: 'The route-to-address list is out of date with the routes', kind: 'static' },
    { id: 'X402-03.unassigned-address', title: 'A paid route has no payment address of its own', kind: 'static' },
    { id: 'X402-03.index-range-overlap', title: 'Two ranges of address indexes overlap', kind: 'static' },
    { id: 'X402-03.shared-payout', title: 'Several routes pay to one address', kind: 'static' },
  ],
  references: [],
  changelog: [{ version: 1, date: FIRST_DATE, change: FIRST_VERSION }],
} satisfies CheckInput;
