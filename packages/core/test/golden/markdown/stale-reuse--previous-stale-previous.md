# <productName> check report

Manifest: `stale-reuse.json` · Routes read: 2 · Network checked: eip155:84532

Found from your route manifest, not from a live run.

Earlier manifests compared:
- `stale-previous.json`

These routes have a different payment address or index than in your earlier manifest:
- `/api/alpha` (was address index 0, now address index 5)
- `/api/beta` (was address index 1, now address index 0)

| Outcome | Count |
|---|---|
| found a problem | 1 |
| found no problem | 2 |
| could not verify | 0 |
| not applicable | 3 |

## X402-03: A payment is tied to the route it was made for (version 4, experimental)

### X402-03.dup-index: found no problem

Two routes are given the same address index

No two routes in your route manifest that use the same payment scheme are given the same address index. This covers only what this check tried.

### X402-03.index-range-overlap: not applicable

Two ranges of address indexes overlap

No route in your route manifest gives each item its own address, so there were no ranges to compare.

### X402-03.cross-route: found no problem

A payment made for one route is accepted by another

No two routes in your route manifest that use the same payment scheme share the same network, asset, price and payment address. This covers only what this check tried.

### X402-03.dynamic-per-pattern: not applicable

Every page of a dynamic route shares one payment address

No route in your route manifest has a part that changes per request.

### X402-03.tiers: not applicable

Different price tiers share a payment address

No route in your route manifest has tiers.

### X402-03.stale-mapping: found a problem (severity: medium)

The route-to-address list is out of date with the routes

An address index or payment address that your earlier manifest gave to one route is now given to a different route with the same payment scheme, network, asset and price. A payment made earlier for the old route carries the same recipient and amount as a payment for the new one. This report sent no payment, so it has not confirmed what your service does with it.

These routes, as written in your manifest:
- `/api/beta` (address index 0; earlier given to `/api/alpha`)

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
