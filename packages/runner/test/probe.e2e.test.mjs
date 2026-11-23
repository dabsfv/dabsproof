// End-to-end: the unpaid probe against the demo seller, started by the demo app's own harness
// (next start on 127.0.0.1:4319 from its existing production build; never next dev, never a build
// here). The harness and helpers are imported read-only; nothing under apps/demo-seller changes.
// Turbo runs this after @dabsproof/demo-seller#test, so the port is free and the build is complete.
// Expected payTo values come from evm's source (helpers.mjs) and prices from the app's mapping.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  APP_DIR,
  captured,
  HOST,
  MAX_REQUESTS_PER_ROUTE,
  PORT,
  portOpen,
  requestCounts,
  startServer,
} from '../../../apps/demo-seller/e2e/harness.mjs';
import { expectedAt, shows, TEST_XPRV, TEST_XPUB, XPUB_VARIABLE } from '../../../apps/demo-seller/e2e/helpers.mjs';
import { ALLOWED_NETWORKS, BASE_SEPOLIA } from '../../evm/src/index.ts';
import { probeUnpaid } from '../src/index.ts';

const ROUTES = [
  { route: '/api/alpha', path: '/api/alpha' },
  { route: '/api/item/[id]', path: '/api/item/5' },
  { route: '/api/tiered', path: '/api/tiered', headers: { 'x-demo-tier': 'pro' } },
];
const MAPPED = JSON.parse(readFileSync(join(APP_DIR, 'payto-map.json'), 'utf8')).routes;
const priceOf = (route, tier) => MAPPED.find((r) => r.route === route && r.tier === tier).price;
const EXPECTED = {
  '/api/alpha': { payTo: expectedAt(0), amount: priceOf('/api/alpha') },
  '/api/item/[id]': { payTo: expectedAt(1005), amount: priceOf('/api/item/[id]') },
  '/api/tiered': { payTo: expectedAt(4), amount: priceOf('/api/tiered', 'pro') },
};
const USDC = ALLOWED_NETWORKS[BASE_SEPOLIA].assets[0].address;
/** The files a complete production build has, as the demo app's T2 checks them. */
const BUILT = [
  join(APP_DIR, '.next', 'BUILD_ID'),
  ...['api/alpha', 'api/item/[id]', 'api/tiered'].map((r) => join(APP_DIR, '.next', 'server', 'app', r, 'route.js')),
];
const HEX64 = /(?<![0-9a-fA-F])[0-9a-fA-F]{64}(?![0-9a-fA-F])/g;

let server;
let result;
/** The raw PAYMENT-REQUIRED value per route, fetched once through the harness for the digest check. Never printed. */
const raw = {};

beforeAll(async () => {
  const missing = BUILT.filter((f) => !existsSync(f)).length;
  if (missing > 0) {
    throw new Error(
      `demo-build-missing: ${missing} of ${BUILT.length} build files; build @dabsproof/demo-seller first`,
    );
  }
  if (await portOpen()) throw new Error('port-in-use');
  server = await startServer({ [XPUB_VARIABLE]: TEST_XPUB });
  result = await probeUnpaid(`http://${HOST}:${PORT}`, { local: true }, ROUTES);
  for (const r of ROUTES)
    raw[r.route] = (await server.get(r.route, r.path, r.headers ?? {})).headers['payment-required'];
}, 120_000);

afterAll(async () => {
  if (server) await server.stop();
}, 60_000);

const entryFor = (route) => result.entries.find((e) => e.route === route);

describe('the unpaid probe against the demo seller', () => {
  it('probes alpha, item 5 and tiered pro with one unpaid GET each', () => {
    expect(result.ok).toBe(true);
    expect(result.entries.length).toBe(3);
    for (const r of ROUTES) {
      const e = entryFor(r.route);
      expect(e.sent).toBe(true);
      expect(e.record.method).toBe('GET');
      expect(e.record.status).toBe(402);
      expect(e.record.url.path).toBe(r.path);
      expect(e.record.payment).toBe(null);
    }
  });
  it('each 402 names Base Sepolia and the allow-listed USDC', () => {
    for (const r of ROUTES) {
      const e = entryFor(r.route);
      expect(e.network).toEqual({ ok: true });
      for (const a of e.record.paymentRequired.accepts) {
        expect(a.network).toBe(BASE_SEPOLIA);
        expect(a.asset).toBe(USDC);
      }
    }
  });
  it("amounts and payTo match the mapping and evm's source", () => {
    for (const r of ROUTES) {
      const accepts = entryFor(r.route).record.paymentRequired.accepts;
      expect(accepts.length).toBe(1);
      expect(accepts[0].amount).toBe(EXPECTED[r.route].amount);
      expect(accepts[0].payTo).toBe(EXPECTED[r.route].payTo);
    }
  });
  it('each body digest matches the decoded PAYMENT-REQUIRED text', () => {
    for (const r of ROUTES) {
      expect(typeof raw[r.route]).toBe('string');
      const text = Buffer.from(raw[r.route], 'base64');
      const body = entryFor(r.route).record.body;
      expect(body.sha256 === createHash('sha256').update(text).digest('hex')).toBe(true);
      expect(body.length).toBe(text.length);
    }
  });
  it('the probe result holds no payment header and no key-shaped text', () => {
    const s = JSON.stringify(result);
    for (const r of ROUTES) expect(s.includes(raw[r.route])).toBe(false);
    expect(shows(s, TEST_XPUB)).toBe(false);
    expect(shows(s, TEST_XPRV)).toBe(false);
    // The only 64-hex strings allowed are the three body SHA-256 digests; the run id is 16 hex characters.
    const digests = result.entries.map((e) => e.record.body.sha256).sort();
    expect((s.match(HEX64) ?? []).sort()).toEqual(digests);
    expect(result.runId.length).toBe(16);
  });
  it('server output holds no xpub or xprv, and port 4319 is closed afterwards', async () => {
    const stopped = await server.stop();
    expect(stopped.processesLeft).toBe(false);
    expect(stopped.portOpen).toBe(false);
    expect(await portOpen()).toBe(false);
    expect(requestCounts.every((c) => Object.values(c).every((n) => n <= MAX_REQUESTS_PER_ROUTE))).toBe(true);
    const all = captured.join('\n');
    expect(shows(all, TEST_XPUB)).toBe(false);
    expect(shows(all, TEST_XPRV)).toBe(false);
  });
});
