# <productName> check report

Manifest: `hd-per-resource.json` · Routes read: 8 · Network checked: eip155:84532

Found from your route manifest, not from a live run.

These routes give each item its own address. X402-03.cross-route and X402-03.dup-index did not compare them with any other route; X402-03.index-range-overlap below says whether their address ranges could be compared:
- `/api/item/[id]` (address indexes 1001 to 10999)

Tiers chosen by details of the request, such as a query string, were not tried; that is part of the live checks.

| Outcome | Count |
|---|---|
| found a problem | 0 |
| found no problem | 5 |
| could not verify | 0 |
| not applicable | 1 |

## X402-03: A payment is tied to the route it was made for (version 4, experimental)

### X402-03.dup-index: found no problem

Two routes are given the same address index

No two routes in your route manifest that use the same payment scheme are given the same address index. This covers only what this check tried.

### X402-03.index-range-overlap: found no problem

Two ranges of address indexes overlap

No two address ranges in your route manifest that use the same payment scheme overlap, and no range includes an index given to another route that uses the same payment scheme. This covers only what this check tried.

### X402-03.cross-route: found no problem

A payment made for one route is accepted by another

No two routes in your route manifest that use the same payment scheme share the same network, asset, price and payment address. This covers only what this check tried.

### X402-03.dynamic-per-pattern: found no problem

Every page of a dynamic route shares one payment address

Every route in your route manifest with a part that changes per request gives each item its own address. This covers only what this check tried.

### X402-03.tiers: found no problem

Different price tiers share a payment address

No two tiers of one route in your route manifest share the same payment scheme, network, asset, price and payment address. This covers only what this check tried.

### X402-03.stale-mapping: not applicable

The route-to-address list is out of date with the routes

No earlier manifest was given, so there was no history to compare with.

---

This report covers only the manifest given. Nothing was sent to any server, and routes or settings that the manifest does not hold were not looked at.
