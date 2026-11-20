// Unit tests for lib/x402.js. No server is started. @x402/core is imported here only, never by app
// code. Expected payTo values come from evm's source, and prices from the app's own mapping.
import { readFileSync } from 'node:fs';
import { decodePaymentRequiredHeader, encodePaymentRequiredHeader } from '@x402/core/http';
import { parsePaymentRequired, validatePaymentRequired } from '@x402/core/schemas';
import { describe, expect, it } from 'vitest';
import { ALLOWED_NETWORKS, BASE_SEPOLIA } from '../../../packages/evm/src/index.ts';
import { expectedAt, shows, TEST_XPRV, TEST_XPUB } from '../e2e/helpers.mjs';
import { MAX_TIMEOUT_SECONDS, paymentRequired, toBase64Ascii } from '../lib/x402.js';

const MAPPING = JSON.parse(readFileSync(new URL('../payto-map.json', import.meta.url), 'utf8'));
const entryFor = (route, tier) => MAPPING.routes.find((r) => r.route === route && r.tier === tier);
const USDC = ALLOWED_NETWORKS[BASE_SEPOLIA].assets[0].address;
const URL_ALPHA = 'http://127.0.0.1:4319/api/alpha?ignored=1';
const make = (over = {}) =>
  paymentRequired({ entry: entryFor('/api/alpha'), payTo: expectedAt(0), url: URL_ALPHA, ...over });
const CODE = /^[a-z][a-z-]{2,40}$/;

/** Every key at any depth of a decoded value. */
const keysOf = (v, out = []) => {
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) out.push(k, ...keysOf(x));
  return out;
};

describe('U1 the package decodes and validates our header', () => {
  it('decodes with @x402/core/http and passes @x402/core/schemas', () => {
    const r = make();
    expect(r.ok).toBe(true);
    const decoded = decodePaymentRequiredHeader(r.headers['PAYMENT-REQUIRED']);
    expect(parsePaymentRequired(decoded).success).toBe(true);
    expect(() => validatePaymentRequired(decoded)).not.toThrow();
  });
  it("our header decodes to the same object as the package's own encoder gives for the same input", () => {
    const r = make();
    const ours = decodePaymentRequiredHeader(r.headers['PAYMENT-REQUIRED']);
    const theirs = decodePaymentRequiredHeader(encodePaymentRequiredHeader(JSON.parse(r.body)));
    expect(ours).toEqual(theirs);
  });
});

describe('U2 the fields', () => {
  it('alpha: version, resource, one exact Base Sepolia USDC entry with the mapping price and given payTo', () => {
    const r = make();
    const d = decodePaymentRequiredHeader(r.headers['PAYMENT-REQUIRED']);
    expect(r.status).toBe(402);
    expect(r.headers['content-type']).toBe('application/json');
    expect(JSON.parse(r.body)).toEqual(d);
    expect(d.x402Version).toBe(2);
    expect(d.resource).toEqual({ url: 'http://127.0.0.1:4319/api/alpha' });
    expect(d.accepts.length).toBe(1);
    const a = d.accepts[0];
    expect(a.scheme).toBe('exact');
    expect(a.network).toBe(BASE_SEPOLIA);
    expect(a.asset).toBe(USDC);
    expect(typeof a.amount).toBe('string');
    expect(a.amount).toBe(entryFor('/api/alpha').price);
    expect(a.payTo).toBe(expectedAt(0));
    expect(a.maxTimeoutSeconds).toBe(MAX_TIMEOUT_SECONDS);
    // What @x402/evm 2.31.0 declares for Base Sepolia USDC; what the token contract returns is not verified.
    expect(a.extra).toEqual({ name: 'USDC', version: '2' });
  });
  it('tiered pro and item 5 take their own price and payTo', () => {
    const pro = paymentRequired({
      entry: entryFor('/api/tiered', 'pro'),
      payTo: expectedAt(4),
      url: 'http://127.0.0.1:4319/api/tiered',
    });
    expect(decodePaymentRequiredHeader(pro.headers['PAYMENT-REQUIRED']).accepts[0].amount).toBe('2000');
    const item = paymentRequired({
      entry: entryFor('/api/item/[id]'),
      payTo: expectedAt(1005),
      url: 'http://127.0.0.1:4319/api/item/5',
    });
    const a = decodePaymentRequiredHeader(item.headers['PAYMENT-REQUIRED']).accepts[0];
    expect(a.payTo).toBe(expectedAt(1005));
    expect(a.amount).toBe(entryFor('/api/item/[id]').price);
  });
});

describe('U3 what must never appear', () => {
  it('no xpub, xprv, key, signature, nonce, authorization or payload in the header, its decoding or the body', () => {
    const r = make();
    const decoded = decodePaymentRequiredHeader(r.headers['PAYMENT-REQUIRED']);
    const all = [r.headers['PAYMENT-REQUIRED'], r.body, JSON.stringify(decoded)].join('\n');
    expect(shows(all, TEST_XPUB)).toBe(false);
    expect(shows(all, TEST_XPRV)).toBe(false);
    expect(/(?<![0-9a-fA-F])[0-9a-fA-F]{64}(?![0-9a-fA-F])/.test(all)).toBe(false);
    const keys = keysOf(decoded).map((k) => k.toLowerCase());
    for (const k of ['signature', 'nonce', 'authorization', 'payload', 'xpub', 'xprv', 'key']) {
      expect(keys.includes(k)).toBe(false);
    }
  });
});

describe('U4 the same input gives the same header', () => {
  it('twice', () => {
    expect(make().headers['PAYMENT-REQUIRED']).toBe(make().headers['PAYMENT-REQUIRED']);
  });
});

describe('U5 refusals carry codes only', () => {
  const alpha = entryFor('/api/alpha');
  const cases = [
    [{ entry: { ...alpha, network: 'eip155:8453' } }, 'unsupported-network'],
    [{ entry: { ...alpha, asset: `0x${'1'.repeat(40)}` } }, 'unsupported-asset'],
    [{ entry: { ...alpha, scheme: 'upto' } }, 'unsupported-scheme'],
    [{ entry: { ...alpha, price: '1.5' } }, 'bad-amount'],
    [{ payTo: 'not-an-address' }, 'bad-pay-to'],
    [{ url: 'not a url' }, 'bad-url'],
    [{ url: 'ftp://127.0.0.1/api/alpha' }, 'bad-url'],
  ];
  for (const [over, code] of cases) {
    it(`${code} (${Object.keys(over)[0]})`, () => {
      const r = make(over);
      expect(r).toEqual({ ok: false, code });
      expect(CODE.test(r.code)).toBe(true);
    });
  }
  it('non-ASCII text is refused by the encoder (by reasoning, not tested, unreachable through the checks above)', () => {
    expect(toBase64Ascii('café')).toBe(null);
    expect(toBase64Ascii('plain')).toBe(btoa('plain'));
  });
  it("lib/x402.js's table address equals evm's allow-listed Base Sepolia USDC", () => {
    expect(
      paymentRequired({ entry: { ...alpha, asset: USDC.toLowerCase() }, payTo: expectedAt(0), url: URL_ALPHA }).ok,
    ).toBe(true);
  });
});
