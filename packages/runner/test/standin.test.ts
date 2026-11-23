// Unit tests for the stand-in facilitator, a fake for tests only. Every request goes to a stand-in
// on 127.0.0.1 with a port the operating system picks; each one is stopped after its test. These
// tests say nothing about how any real facilitator, or the real client's reply schemas, behave.
import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_STANDIN_BODY_BYTES, type StandIn, type StandInOptions, startStandIn } from '../src/index.js';

const running: StandIn[] = [];
afterEach(async () => {
  for (const s of running.splice(0)) await s.stop();
});

async function start(options: Omit<StandInOptions, 'host'>): Promise<StandIn> {
  const r = await startStandIn({ host: '127.0.0.1', ...options });
  if (!r.ok) throw new Error(r.code);
  running.push(r);
  return r;
}
const post = (s: StandIn, path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${s.origin}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
const request = {
  x402Version: 2,
  paymentPayload: {},
  paymentRequirements: { scheme: 'exact', network: 'eip155:84532' },
};
const HEX64 = /(?<![0-9a-fA-F])[0-9a-fA-F]{64}(?![0-9a-fA-F])/;

describe('the stand-in facilitator (a fake for tests only)', () => {
  it('refuses any host but the literal 127.0.0.1', async () => {
    for (const host of ['localhost', '0.0.0.0', '::1', '127.0.0.2', 'example.test', '', 12345, undefined]) {
      expect(await startStandIn({ host, mode: 'always-valid' })).toEqual({
        ok: false,
        code: 'host-not-loopback-literal',
      });
    }
  });
  it('always-valid: verify, settle and supported reply 200 with the planned shapes', async () => {
    const s = await start({ mode: 'always-valid' });
    const v = await post(s, '/verify', request);
    expect(v.status).toBe(200);
    expect(await v.json()).toEqual({ isValid: true });
    const st = await post(s, '/settle', request);
    expect(st.status).toBe(200);
    const settled = (await st.json()) as { success?: unknown; network?: unknown; transaction?: unknown };
    expect(settled.success).toBe(true);
    expect(settled.network).toBe('eip155:84532');
    expect(typeof settled.transaction === 'string' && settled.transaction.startsWith('stand-in-')).toBe(true);
    const sup = await fetch(`${s.origin}/supported`);
    expect(sup.status).toBe(200);
    expect(await sup.json()).toEqual({
      kinds: [
        { x402Version: 2, scheme: 'exact', network: 'eip155:84532' },
        { x402Version: 2, scheme: 'upto', network: 'eip155:84532' },
      ],
      extensions: [],
      signers: {},
    });
    expect(s.seen().counts).toEqual({ verify: 1, settle: 1, supported: 1, other: 0, refused: 0 });
  });
  it('error: each path replies 500 with the code body', async () => {
    const s = await start({ mode: 'error' });
    for (const r of [
      await post(s, '/verify', request),
      await post(s, '/settle', request),
      await fetch(`${s.origin}/supported`),
    ]) {
      expect(r.status).toBe(500);
      expect(await r.json()).toEqual({ error: 'stand-in-error' });
    }
  });
  it('timeout: a short client deadline is cut off, and stop() ends a held request at once', async () => {
    const a = await start({ mode: 'timeout', holdMs: 1000 });
    const t1 = Date.now();
    const cut = await fetch(`${a.origin}/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(200),
    }).then(
      () => 'answered',
      () => 'cut off',
    );
    // The client's own 200 ms deadline ends it, well before the stand-in's 1000 ms hold.
    expect(cut).toBe('cut off');
    expect(Date.now() - t1 < 900).toBe(true);
    const b = await start({ mode: 'timeout', holdMs: 2000 });
    const held = fetch(`${b.origin}/supported`).then(
      () => 'answered',
      () => 'closed',
    );
    for (let i = 0; i < 50 && b.seen().counts.supported === 0; i++) await new Promise((r) => setTimeout(r, 20));
    expect(b.seen().counts.supported).toBe(1);
    const t0 = Date.now();
    await b.stop();
    expect(await held).toBe('closed');
    expect(Date.now() - t0 < 500).toBe(true);
  });
  it('a 21st request is refused and counted', async () => {
    const s = await start({ mode: 'always-valid' });
    for (let i = 0; i < 20; i++) expect((await fetch(`${s.origin}/supported`)).status).toBe(200);
    const r = await fetch(`${s.origin}/supported`);
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: 'stand-in-request-limit' });
    expect(s.seen().counts).toMatchObject({ supported: 20, refused: 1 });
  });
  it('a body over 1 MiB is refused with 413, counted, and its connection closed', async () => {
    const s = await start({ mode: 'always-valid' });
    const r = await fetch(`${s.origin}/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: new Uint8Array(MAX_STANDIN_BODY_BYTES + 1),
    });
    expect(r.status).toBe(413);
    expect(r.headers.get('connection')).toBe('close');
    expect(await r.json()).toEqual({ error: 'stand-in-body-too-large' });
    expect(s.seen().counts).toMatchObject({ verify: 0, refused: 1 });
    expect(s.seen().requests.length).toBe(0);
  });
  it('an unknown path gives 404 and is counted as other', async () => {
    const s = await start({ mode: 'always-valid' });
    const r = await fetch(`${s.origin}/anything`);
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: 'not-found' });
    expect(s.seen().counts).toMatchObject({ other: 1, verify: 0 });
  });
  it('the log keeps counts, key names and header names only', async () => {
    const s = await start({ mode: 'always-valid' });
    const signature = randomBytes(48).toString('base64');
    const headerValue = randomBytes(24).toString('base64');
    await post(
      s,
      '/verify',
      { ...request, paymentPayload: { x402Version: 2, payload: { signature } } },
      { 'x-test-auth': headerValue },
    );
    const log = s.seen();
    const text = JSON.stringify(log);
    expect(text.includes(signature)).toBe(false);
    expect(text.includes(headerValue)).toBe(false);
    expect(HEX64.test(text)).toBe(false);
    const [req] = log.requests;
    expect(req?.path).toBe('/verify');
    expect(req?.topKeys).toEqual(['x402Version', 'paymentPayload', 'paymentRequirements']);
    expect(req?.x402Version).toBe(2);
    expect(req?.scheme).toBe('exact');
    expect(req?.network).toBe('eip155:84532');
    expect(req?.headerNames.includes('x-test-auth')).toBe(true);
    expect((req?.bodyLength ?? 0) > 0).toBe(true);
  });
  it('mode and hold options are checked', async () => {
    const at = (o: Record<string, unknown>) =>
      startStandIn({ host: '127.0.0.1', mode: 'always-valid', ...o } as StandInOptions);
    expect(await at({ mode: 'approve-everything' })).toEqual({ ok: false, code: 'mode-unknown' });
    expect(await at({ mode: 'timeout', holdMs: 2001 })).toEqual({ ok: false, code: 'hold-too-long' });
    expect(await at({ mode: 'timeout', holdMs: -1 })).toEqual({ ok: false, code: 'hold-invalid' });
    expect(await at({ mode: 'timeout', holdMs: 1.5 })).toEqual({ ok: false, code: 'hold-invalid' });
  });
});
