// Unit tests for lib/paid.js, the test-only fake paid path. No server is started and nothing is
// sent: every test injects its own fetch. The fake payment is made at run time from random bytes; it
// is not a payment. These tests say nothing about real facilitators, buyers or settlement.
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decidePaid } from '../lib/paid.js';

const ORIGIN = 'http://127.0.0.1:18402';
const requirement = {
  scheme: 'exact',
  network: 'eip155:84532',
  asset: `0x${'1'.repeat(40)}`,
  amount: '1000',
  payTo: `0x${'2'.repeat(40)}`,
  maxTimeoutSeconds: 300,
  extra: {},
};
const fakePayload = () => ({ x402Version: 2, payload: { signature: randomBytes(48).toString('base64') } });
const headerOf = (value) => Buffer.from(JSON.stringify(value)).toString('base64');
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const HEX64 = /(?<![0-9a-fA-F])[0-9a-fA-F]{64}(?![0-9a-fA-F])/;

/** A fake fetch answering verify and settle in turn, and recording only the URL and options of each call. */
function fakeFetch(verifyReply, settleReply) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return url.endsWith('/verify') ? verifyReply() : settleReply();
  };
  return { fn, calls };
}
const run = (headerValue, fetch, extra = {}) =>
  decidePaid({ headerValue, requirement, facilitatorOrigin: ORIGIN, fetch, ...extra });
const valid = () =>
  fakeFetch(
    () => json({ isValid: true }),
    () => json({ success: true, transaction: 'stand-in-test', network: 'eip155:84532' }),
  );

describe('decidePaid (a test-only fake paid path)', () => {
  it('no header gives no-header and sends nothing', async () => {
    const f = valid();
    for (const h of [undefined, null, '']) expect(await run(h, f.fn)).toEqual({ paid: false, reason: 'no-header' });
    expect(f.calls.length).toBe(0);
  });
  it('a non-text or oversized header is refused and sends nothing', async () => {
    const f = valid();
    expect(await run(42, f.fn)).toEqual({ paid: false, reason: 'header-not-text' });
    expect(await run('A'.repeat(8 * 1024 + 4), f.fn)).toEqual({ paid: false, reason: 'header-too-large' });
    expect(f.calls.length).toBe(0);
  });
  it('an undecodable header or a payload that is not an object is refused', async () => {
    const f = valid();
    expect(await run('not base64!', f.fn)).toEqual({ paid: false, reason: 'header-not-base64-json' });
    expect(await run(Buffer.from('not json').toString('base64'), f.fn)).toEqual({
      paid: false,
      reason: 'header-not-base64-json',
    });
    for (const v of [[1, 2], 'text', 7])
      expect(await run(headerOf(v), f.fn)).toEqual({ paid: false, reason: 'payload-not-object' });
    expect(f.calls.length).toBe(0);
  });
  it('a valid verify and a valid settle mean paid, with the expected requests', async () => {
    const f = valid();
    const payload = fakePayload();
    expect(await run(headerOf(payload), f.fn)).toEqual({ paid: true, reason: 'paid' });
    expect(f.calls.map((c) => c.url)).toEqual([`${ORIGIN}/verify`, `${ORIGIN}/settle`]);
    for (const c of f.calls) {
      expect(c.init.method).toBe('POST');
      expect(c.init.redirect).toBe('manual');
      expect(JSON.parse(c.init.body)).toEqual({
        x402Version: 2,
        paymentPayload: payload,
        paymentRequirements: requirement,
      });
    }
  });
  it('isValid false gives verify-not-valid and settle is never called', async () => {
    const f = fakeFetch(
      () => json({ isValid: false, invalidReason: 'test' }),
      () => json({ success: true, transaction: 'x' }),
    );
    expect(await run(headerOf(fakePayload()), f.fn)).toEqual({ paid: false, reason: 'verify-not-valid' });
    expect(f.calls.length).toBe(1);
  });
  it('a non-200 or redirecting verify gives verify-failed', async () => {
    for (const reply of [
      () => json({ error: 'x' }, 500),
      () => new Response(null, { status: 302, headers: { location: '/x' } }),
    ]) {
      const f = fakeFetch(reply, () => json({ success: true, transaction: 'x' }));
      expect(await run(headerOf(fakePayload()), f.fn)).toEqual({ paid: false, reason: 'verify-failed' });
      expect(f.calls.length).toBe(1);
    }
  });
  it('a non-200 settle, success false, or a bad reply shape are each unpaid', async () => {
    const cases = [
      [() => json({ error: 'x' }, 500), 'settle-failed'],
      [() => json({ success: false, transaction: '' }), 'settle-not-success'],
      [() => json({ success: true }), 'reply-bad-shape'],
      [() => json([1, 2]), 'reply-bad-shape'],
    ];
    for (const [settle, reason] of cases) {
      const f = fakeFetch(() => json({ isValid: true }), settle);
      expect(await run(headerOf(fakePayload()), f.fn)).toEqual({ paid: false, reason });
    }
  });
  it('a thrown error, and a fetch that never answers until aborted, both mean unpaid', async () => {
    const thrown = async () => {
      throw new Error('test');
    };
    expect(await run(headerOf(fakePayload()), thrown)).toEqual({ paid: false, reason: 'verify-failed' });
    const never = (_url, init) =>
      new Promise((_resolve, reject) =>
        init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }),
      );
    const t0 = Date.now();
    expect(await run(headerOf(fakePayload()), never, { timeoutMs: 100 })).toEqual({ paid: false, reason: 'timeout' });
    expect(Date.now() - t0 < 1000).toBe(true);
  });
  it('a facilitator origin other than the literal 127.0.0.1 sends nothing', async () => {
    const f = valid();
    for (const origin of [
      undefined,
      'http://localhost:18402',
      'https://127.0.0.1:18402',
      'http://127.0.0.1:18402/',
      'http://10.0.0.1:18402',
    ]) {
      const r = await decidePaid({
        headerValue: headerOf(fakePayload()),
        requirement,
        facilitatorOrigin: origin,
        fetch: f.fn,
      });
      expect(r).toEqual({ paid: false, reason: 'facilitator-missing' });
    }
    expect(f.calls.length).toBe(0);
    // Without a fetch function nothing can be sent at all.
    expect(await decidePaid({ headerValue: headerOf(fakePayload()), requirement, facilitatorOrigin: ORIGIN })).toEqual({
      paid: false,
      reason: 'facilitator-missing',
    });
  });
  it('no result holds the header value, a 64-hex string or the origin text', async () => {
    const header = headerOf(fakePayload());
    const results = [
      await run(header, valid().fn),
      await run(
        header,
        fakeFetch(
          () => json({ isValid: false }),
          () => json({}),
        ).fn,
      ),
      await decidePaid({
        headerValue: header,
        requirement,
        facilitatorOrigin: 'http://localhost:1',
        fetch: valid().fn,
      }),
    ];
    const text = JSON.stringify(results);
    expect(text.includes(header)).toBe(false);
    expect(HEX64.test(text)).toBe(false);
    expect(text.includes('127.0.0.1') || text.includes('localhost')).toBe(false);
  });
});
