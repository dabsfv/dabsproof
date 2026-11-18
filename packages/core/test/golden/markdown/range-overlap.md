# <productName> check report

Manifest: `range-overlap.json` · Routes read: 4 · Network checked: eip155:84532

Found from your route manifest, not from a live run.

These routes give each item its own address. X402-03.cross-route and X402-03.dup-index did not compare them with any other route; X402-03.index-range-overlap below says whether their address ranges could be compared:
- `/api/item/[id]` (address indexes 1001 to 10999)
- `/api/other/[id]` (address indexes 5001 to 5010)

| Outcome | Count |
|---|---|
| found a problem | 1 |
| found no problem | 3 |
| could not verify | 0 |
| not applicable | 2 |

## X402-03: A payment is tied to the route it was made for (version 4, experimental)

### X402-03.dup-index: found no problem

Two routes are given the same address index

No two routes in your route manifest that use the same payment scheme are given the same address index. This covers only what this check tried.

### X402-03.index-range-overlap: found a problem (severity: medium)

Two ranges of address indexes overlap

These routes are given address ranges in your route manifest that overlap, or a range that includes an index given to another route, so at least one address index is used twice. On our test shop, routes that shared a network, asset, price and payment address accepted each other's payments. This report sent no payment, so it has not confirmed this for your service.

These routes, as written in your manifest:
- `/api/alpha` (address index 1005)
- `/api/item/[id]` (address indexes 1001 to 10999)

- `/api/item/[id]` (address indexes 1001 to 10999)
- `/api/other/[id]` (address indexes 5001 to 5010)

### X402-03.cross-route: found no problem

A payment made for one route is accepted by another

No two routes in your route manifest that use the same payment scheme share the same network, asset, price and payment address. This covers only what this check tried.

### X402-03.dynamic-per-pattern: found no problem

Every page of a dynamic route shares one payment address

Every route in your route manifest with a part that changes per request gives each item its own address. This covers only what this check tried.

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
