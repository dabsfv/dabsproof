// Every test here talks only to a stub server on 127.0.0.1, on a port the operating system picks,
// closed after each test. Nothing is sent anywhere else.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildJsonRequest,
  buildRequest,
  checkRequiredNetworks,
  checkTarget,
  type LocalTarget,
  MAX_BODY_BYTES,
  MAX_JSON_BODY_BYTES,
  RequestBudget,
  sendLocal,
  sendLocalJson,
} from '../src/index.js';

let server: Server | undefined;
let hits = 0;

/** Starts a stub on 127.0.0.1 and returns its checked target. */
function stub(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<LocalTarget> {
  hits = 0;
  return new Promise((resolve, reject) => {
    const s = createServer((req, res) => {
      hits++;
      res.on('error', () => {});
      handler(req, res);
    });
    server = s;
    s.listen(0, '127.0.0.1', () => {
      const t = checkTarget(`http://127.0.0.1:${(s.address() as AddressInfo).port}`, { local: true });
      if (t.ok) resolve(t.target);
      else reject(new Error(t.code));
    });
  });
}

afterEach(async () => {
  const s = server;
  server = undefined;
  if (!s) return;
  s.closeAllConnections();
  await new Promise<void>((done) => s.close(() => done()));
});

const budget = () => new RequestBudget({ requestsPerRoute: 20, burst: 10 });
const redirectTo = (location: string) => (_req: IncomingMessage, res: ServerResponse) => {
  res.writeHead(302, { location });
  res.end();
};
const LOCAL: LocalTarget = { origin: 'http://127.0.0.1:4319', host: '127.0.0.1', port: 4319 };

/** A made-up PAYMENT-REQUIRED value: test data, not a payment. */
const fixture = (network: string) =>
  Buffer.from(
    JSON.stringify({
      x402Version: 2,
      resource: { url: 'http://127.0.0.1:4319/api/alpha' },
      accepts: [
        {
          scheme: 'exact',
          network,
          asset: `0x${'1'.repeat(40)}`,
          amount: '1000',
          payTo: `0x${'2'.repeat(40)}`,
          maxTimeoutSeconds: 300,
          extra: {},
        },
      ],
    }),
  ).toString('base64');

describe('sending', () => {
  it('the runner never sets Host', () => {
    // fetch sets its own Host from the URL; this checks only the runner's own header list.
    const r = buildRequest(LOCAL, '/api/alpha', { accept: 'application/json' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Object.keys(r.init.headers).map((k) => k.toLowerCase())).not.toContain('host');
      expect(r.init.redirect).toBe('manual');
    }
    expect(buildRequest(LOCAL, '/api/alpha', { Host: 'example.test' })).toEqual({
      ok: false,
      code: 'host-header-not-allowed',
    });
  });
  it("sends one GET within the budget and returns the stub's status", async () => {
    const target = await stub((_req, res) => {
      res.writeHead(402, { 'content-type': 'application/json' });
      res.end('{}');
    });
    const r = await sendLocal(target, budget(), '/api/alpha', '/api/alpha');
    expect(r.ok && r.status).toBe(402);
    expect(hits).toBe(1);
  });
  it('refuses an off-host redirect without following it', async () => {
    const target = await stub(redirectTo('http://example.test/'));
    expect(await sendLocal(target, budget(), '/a', '/a')).toEqual({ ok: false, code: 'redirect-off-host' });
    expect(hits).toBe(1);
  });
  it('does not follow a same-host redirect', async () => {
    const target = await stub((_req, res) => redirectTo(`${target.origin}/x`)(_req, res));
    expect(await sendLocal(target, budget(), '/a', '/a')).toEqual({ ok: false, code: 'redirect-not-followed' });
    expect(hits).toBe(1);
  });
  it('a relative Location is the same host and is not followed', async () => {
    const target = await stub(redirectTo('/x'));
    expect(await sendLocal(target, budget(), '/a', '/a')).toEqual({ ok: false, code: 'redirect-not-followed' });
    expect(hits).toBe(1);
  });
  it('a protocol-relative Location is another host and is not followed', async () => {
    const target = await stub(redirectTo('//example.test/x'));
    expect(await sendLocal(target, budget(), '/a', '/a')).toEqual({ ok: false, code: 'redirect-off-host' });
    expect(hits).toBe(1);
  });
  it('a 3xx reply with no Location is returned as an ordinary reply', async () => {
    const target = await stub((_req, res) => {
      res.writeHead(304);
      res.end();
    });
    const r = await sendLocal(target, budget(), '/a', '/a');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.status).toBe(304);
      expect(r.headers.location).toBeUndefined();
    }
    expect(hits).toBe(1);
  });
  it('refuses a body over the cap and keeps none of it', async () => {
    const target = await stub((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      res.end(Buffer.alloc(MAX_BODY_BYTES + 1, 1));
    });
    expect(await sendLocal(target, budget(), '/a', '/a')).toEqual({ ok: false, code: 'body-too-large' });
    expect(hits).toBe(1);
  });
  it('returns a body just under the cap whole', async () => {
    const target = await stub((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      res.end(Buffer.alloc(MAX_BODY_BYTES - 1, 1));
    });
    const r = await sendLocal(target, budget(), '/a', '/a');
    expect(r.ok && r.body.byteLength).toBe(MAX_BODY_BYTES - 1);
    expect(hits).toBe(1);
  });
  it('refuses a path that could change the host', () => {
    for (const p of ['//example.test', '/@x', 'api', '/a\\b', '/a b', '/a#b', '/a\u0001b']) {
      expect(buildRequest(LOCAL, p)).toEqual({ ok: false, code: 'path-invalid' });
    }
  });
  it('refuses a mainnet 402 fixture and accepts a Base Sepolia one', () => {
    expect(checkRequiredNetworks(fixture('eip155:8453'))).toEqual({ ok: false, code: 'not-base-sepolia' });
    expect(checkRequiredNetworks(fixture('eip155:84532'))).toEqual({ ok: true });
    expect(checkRequiredNetworks('not base64 json')).toEqual({ ok: false, code: 'payment-required-undecodable' });
  });
});

describe('sending one JSON body (sendLocalJson)', () => {
  /** Records method, content type and body text only; answers with a small JSON reply. */
  const seen: { method?: string | undefined; contentType?: string | undefined; body?: string; names?: string[] } = {};
  const recorder = (req: IncomingMessage, res: ServerResponse) => {
    const parts: Buffer[] = [];
    req.on('data', (c: Buffer) => parts.push(c));
    req.on('end', () => {
      seen.method = req.method;
      seen.contentType = req.headers['content-type'];
      seen.body = Buffer.concat(parts).toString('utf8');
      seen.names = Object.keys(req.headers);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"result":"ok"}');
    });
  };
  const call = { jsonrpc: '2.0', id: 1, method: 'test_call', params: [] };

  it('refuses a target that is not a loopback literal, before anything is sent', async () => {
    for (const origin of ['http://10.0.0.1:1234', 'http://localhost:1234', 'https://127.0.0.1:1234', '']) {
      const t = { origin, host: '127.0.0.1', port: 1234 } as LocalTarget;
      expect(await sendLocalJson(t, budget(), 'r', '/', call)).toEqual({ ok: false, code: 'target-not-loopback' });
    }
  });
  it('refuses a body over 4 KiB, or one that is not JSON, before anything is sent', async () => {
    const target = await stub(recorder);
    const over = 'x'.repeat(MAX_JSON_BODY_BYTES);
    expect(await sendLocalJson(target, budget(), 'r', '/', { over })).toEqual({
      ok: false,
      code: 'request-body-too-large',
    });
    expect(await sendLocalJson(target, budget(), 'r', '/', undefined)).toEqual({
      ok: false,
      code: 'request-body-not-json',
    });
    expect(await sendLocalJson(target, budget(), 'r', '/', { n: 1n })).toEqual({
      ok: false,
      code: 'request-body-not-json',
    });
    expect(hits).toBe(0);
    // A body of exactly 4 KiB is sent.
    const exact = 'x'.repeat(MAX_JSON_BODY_BYTES - 2);
    expect(Buffer.byteLength(JSON.stringify(exact))).toBe(MAX_JSON_BODY_BYTES);
    expect((await sendLocalJson(target, budget(), 'r', '/', exact)).ok).toBe(true);
    expect(hits).toBe(1);
  });
  it('never follows a redirect, on the same host or off it', async () => {
    const off = await stub(redirectTo('http://example.test/'));
    expect(await sendLocalJson(off, budget(), 'r', '/', call)).toEqual({ ok: false, code: 'redirect-off-host' });
    expect(hits).toBe(1);
    const s = server;
    server = undefined;
    s?.closeAllConnections();
    await new Promise<void>((done) => s?.close(() => done()));
    const same = await stub((_req, res) => redirectTo(`${same.origin}/x`)(_req, res));
    expect(await sendLocalJson(same, budget(), 'r', '/', call)).toEqual({ ok: false, code: 'redirect-not-followed' });
    expect(hits).toBe(1);
  });
  it('sends a POST with only the content-type header of its own, never a Host header', async () => {
    const target = await stub(recorder);
    const built = buildJsonRequest(target, '/', call);
    expect(built.ok && built.init.headers).toEqual({ 'content-type': 'application/json' });
    expect(built.ok && built.init.method).toBe('POST');
    expect(built.ok && built.init.redirect).toBe('manual');
    const r = await sendLocalJson(target, budget(), 'r', '/', call);
    expect(r.ok && r.status).toBe(200);
    expect(seen.method).toBe('POST');
    expect(seen.contentType).toBe('application/json');
    expect(JSON.parse(seen.body ?? '')).toEqual(call);
    for (const name of ['authorization', 'cookie', 'payment-signature', 'x-payment']) {
      expect(seen.names?.includes(name)).toBe(false);
    }
    expect(buildJsonRequest(target, '//example.test', call)).toEqual({ ok: false, code: 'path-invalid' });
  });
  it('takes one budget slot per call and refuses a 21st request', async () => {
    const target = await stub(recorder);
    const b = new RequestBudget({ requestsPerRoute: 20, burst: 1 });
    for (let i = 0; i < 20; i++) expect((await sendLocalJson(target, b, 'chain-ready', '/', call)).ok).toBe(true);
    expect(await sendLocalJson(target, b, 'chain-ready', '/', call)).toEqual({
      ok: false,
      code: 'route-request-limit',
    });
    expect(hits).toBe(20);
  });
});
