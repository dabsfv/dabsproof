import type { CheckInput } from '../schema.js';
import { BASE_SEPOLIA, COULD_NOT_VERIFY, COVERS_ONLY, FIRST_DATE, FIRST_VERSION, GENERAL_GUIDANCE } from '../shared.js';

export const x402_03 = {
  id: 'X402-03',
  version: 4,
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
  appliesTo: { x402Versions: [2], schemes: ['exact'], networks: [BASE_SEPOLIA], staticNetworks: 'any-evm' },
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
    {
      id: 'X402-03.cross-route',
      title: 'A payment made for one route is accepted by another',
      kind: 'both',
      static: {
        'found-a-problem':
          'These routes share the same network, asset, price and payment address in your route manifest. On our test shop, that was enough for a payment made for one route to work on another. This report sent no payment, so it has not confirmed this for your service.',
        'found-no-problem': `No two routes in your route manifest share the same network, asset, price and payment address. ${COVERS_ONLY}`,
        'found-no-problem-within-scheme': `No two routes in your route manifest that use the same payment scheme share the same network, asset, price and payment address. ${COVERS_ONLY}`,
        'not-applicable':
          'Fewer than two of the routes checked share the same payment scheme, network, asset and price, so there was nothing to compare.',
      },
    },
    {
      id: 'X402-03.dup-index',
      title: 'Two routes are given the same address index',
      kind: 'static',
      static: {
        'found-a-problem':
          "These routes are given the same address index in your route manifest, so they would be paid to the same address. On our test shop, routes that shared a network, asset, price and payment address accepted each other's payments. This report sent no payment, so it has not confirmed this for your service.",
        'found-no-problem': `No two routes in your route manifest are given the same address index. ${COVERS_ONLY}`,
        'found-no-problem-within-scheme': `No two routes in your route manifest that use the same payment scheme are given the same address index. ${COVERS_ONLY}`,
      },
    },
    {
      id: 'X402-03.dynamic-per-pattern',
      title: 'Every page of a dynamic route shares one payment address',
      kind: 'static',
      static: {
        'found-a-problem':
          'These routes have a part that changes per request, such as [id], but one payment address and price for every value of it. A payment made for one value carries the same terms as a payment for any other value. This matters when the items behind those values are not worth the same. On our test shop, a payment made for one value was accepted for another. This report sent no payment, so it has not confirmed this for your service.',
        'found-no-problem': `Every route in your route manifest with a part that changes per request gives each item its own address. ${COVERS_ONLY}`,
        'not-applicable': 'No route in your route manifest has a part that changes per request.',
      },
    },
    { id: 'X402-03.query-variants', title: 'A payment for one query string is accepted for another', kind: 'live' },
    {
      id: 'X402-03.tiers',
      title: 'Different price tiers share a payment address',
      kind: 'static',
      static: {
        'found-a-problem':
          "These tiers of one route share the same payment scheme, network, asset, price and payment address in your route manifest. On our test shop, routes that shared these terms accepted each other's payments. Two tiers at the same price were not tested. This report sent no payment, so it has not confirmed this for your tiers.",
        'found-no-problem': `No two tiers of one route in your route manifest share the same payment scheme, network, asset, price and payment address. ${COVERS_ONLY}`,
        'not-applicable': 'No route in your route manifest has tiers.',
      },
    },
    {
      id: 'X402-03.stale-mapping',
      title: 'The route-to-address list is out of date with the routes',
      kind: 'static',
      static: {
        'found-a-problem':
          'An address index or payment address that your earlier manifest gave to one route is now given to a different route with the same payment scheme, network, asset and price. A payment made earlier for the old route carries the same recipient and amount as a payment for the new one. This report sent no payment, so it has not confirmed what your service does with it.',
        'found-no-problem': `No address index or payment address that your earlier manifest gave to one route is now given to a different route with the same payment scheme, network, asset and price. ${COVERS_ONLY}`,
        'not-applicable': 'No earlier manifest was given, so there was no history to compare with.',
        'could-not-verify': 'An earlier manifest could not be read, so the mapping history could not be compared.',
      },
    },
    { id: 'X402-03.unassigned-address', title: 'A paid route has no payment address of its own', kind: 'static' },
    {
      id: 'X402-03.index-range-overlap',
      title: 'Two ranges of address indexes overlap',
      kind: 'static',
      static: {
        'found-a-problem':
          "These routes are given address ranges in your route manifest that overlap, or a range that includes an index given to another route, so at least one address index is used twice. On our test shop, routes that shared a network, asset, price and payment address accepted each other's payments. This report sent no payment, so it has not confirmed this for your service.",
        'found-no-problem': `No two address ranges in your route manifest overlap, and no range includes an index given to another route. ${COVERS_ONLY}`,
        'found-no-problem-within-scheme': `No two address ranges in your route manifest that use the same payment scheme overlap, and no range includes an index given to another route that uses the same payment scheme. ${COVERS_ONLY}`,
        'could-not-verify':
          'At least one route gives each item its own address but does not say which item ids it uses, so its address range could not be compared.',
        'not-applicable':
          'No route in your route manifest gives each item its own address, so there were no ranges to compare.',
      },
    },
    { id: 'X402-03.shared-payout', title: 'Several routes pay to one address', kind: 'static' },
  ],
  references: [],
  changelog: [
    { version: 1, date: FIRST_DATE, change: FIRST_VERSION },
    {
      version: 2,
      date: FIRST_DATE,
      change:
        'Added the text shown for .cross-route and .dup-index when a result comes from a route manifest rather than a live run.',
    },
    {
      version: 3,
      date: FIRST_DATE,
      change:
        'Static texts now say that routes are compared within one payment scheme, and the static not-applicable text no longer claims a payment cannot be moved.',
    },
    {
      version: 4,
      date: FIRST_DATE,
      change:
        'Added static texts for .index-range-overlap, .dynamic-per-pattern, .tiers and .stale-mapping, and appliesTo.staticNetworks so that static checks read any EVM network while live runs stay on Base Sepolia. .dup-index now compares indexes within one payment scheme, network and asset.',
    },
  ],
} satisfies CheckInput;
