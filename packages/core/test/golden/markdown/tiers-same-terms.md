# <productName> check report

Manifest: `tiers-same-terms.json` · Routes read: 4 · Network checked: eip155:84532

Found from your route manifest, not from a live run.

Tiers chosen by details of the request, such as a query string, were not tried; that is part of the live checks.

| Outcome | Count |
|---|---|
| found a problem | 1 |
| found no problem | 1 |
| could not verify | 0 |
| not applicable | 4 |

## X402-03: A payment is tied to the route it was made for (version 4, experimental)

### X402-03.dup-index: not applicable

Two routes are given the same address index

No route in this manifest uses an address index.

### X402-03.index-range-overlap: not applicable

Two ranges of address indexes overlap

No route in your route manifest gives each item its own address, so there were no ranges to compare.

### X402-03.cross-route: found no problem

A payment made for one route is accepted by another

No two routes in your route manifest that use the same payment scheme share the same network, asset, price and payment address. This covers only what this check tried.

### X402-03.dynamic-per-pattern: not applicable

Every page of a dynamic route shares one payment address

No route in your route manifest has a part that changes per request.

### X402-03.tiers: found a problem (severity: medium)

Different price tiers share a payment address

These tiers of one route share the same payment scheme, network, asset, price and payment address in your route manifest. On our test shop, routes that shared these terms accepted each other's payments. Two tiers at the same price were not tested. This report sent no payment, so it has not confirmed this for your tiers.

These routes, as written in your manifest:
- `/api/tiered` (tier basic, `0x0000…0010`)
- `/api/tiered` (tier gold, `0x0000…0010`)

### X402-03.stale-mapping: not applicable

The route-to-address list is out of date with the routes

No earlier manifest was given, so there was no history to compare with.

What someone could do: Pay for one route and use that payment to get a different route with the same price, or use one payment across many routes.

The severity could rise to high if routes with the same price give access to content of different value.

Found from your route manifest, not from a live run.

### How to fix

Make each payment usable only on the route it was made for.

1. Give each paid route its own payment address, so a payment's recipient shows which route it was for. It is not part of the x402 specification, and whether official guidance recommends it has not been checked.
2. Before sending content, check that the payment's recipient is the address of the route being requested.
3. Keep the route-to-address list in one place, and check it when your service starts.

General guidance. It has not been tested on your service.

Not a fix: Different prices alone. Two routes with the same price still accept each other's payments.

---

This report covers only the manifest given. Nothing was sent to any server, and routes or settings that the manifest does not hold were not looked at.
