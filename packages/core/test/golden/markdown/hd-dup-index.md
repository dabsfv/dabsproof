# <productName> check report

Manifest: `hd-dup-index.json` · Routes read: 7 · Network checked: eip155:84532

Found from your route manifest, not from a live run.

| Outcome | Count |
|---|---|
| found a problem | 3 |
| found no problem | 0 |
| could not verify | 0 |
| not applicable | 3 |

## X402-03: A payment is tied to the route it was made for (version 4, experimental)

### X402-03.dup-index: found a problem (severity: medium)

Two routes are given the same address index

These routes are given the same address index in your route manifest, so they would be paid to the same address. On our test shop, routes that shared a network, asset, price and payment address accepted each other's payments. This report sent no payment, so it has not confirmed this for your service.

These routes, as written in your manifest:
- `/api/alpha` (address index 0)
- `/api/beta` (address index 0)

### X402-03.index-range-overlap: not applicable

Two ranges of address indexes overlap

No route in your route manifest gives each item its own address, so there were no ranges to compare.

### X402-03.cross-route: found a problem (severity: medium)

A payment made for one route is accepted by another

Same mistake as above: fixing the repeated index fixes both.
- `/api/alpha` (address index 0)
- `/api/beta` (address index 0)

### X402-03.dynamic-per-pattern: found a problem (severity: medium)

Every page of a dynamic route shares one payment address

These routes have a part that changes per request, such as [id], but one payment address and price for every value of it. A payment made for one value carries the same terms as a payment for any other value. This matters when the items behind those values are not worth the same. On our test shop, a payment made for one value was accepted for another. This report sent no payment, so it has not confirmed this for your service.

These routes, as written in your manifest:
- `/api/item/[id]` (address index 3)

### X402-03.tiers: not applicable

Different price tiers share a payment address

No route in your route manifest has tiers.

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
