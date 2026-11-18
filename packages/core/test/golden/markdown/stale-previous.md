# <productName> check report

Manifest: `stale-previous.json` · Routes read: 2 · Network checked: eip155:84532

Found from your route manifest, not from a live run.

| Outcome | Count |
|---|---|
| found a problem | 0 |
| found no problem | 2 |
| could not verify | 0 |
| not applicable | 4 |

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

### X402-03.stale-mapping: not applicable

The route-to-address list is out of date with the routes

No earlier manifest was given, so there was no history to compare with.

---

This report covers only the manifest given. Nothing was sent to any server, and routes or settings that the manifest does not hold were not looked at.
