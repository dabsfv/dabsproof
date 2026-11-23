// Unit tests for the unpaid probe. Every request goes only to a stub server on 127.0.0.1, on a port
// the operating system picks, closed after each test.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { probeUnpaid } from '../src/index.js';

let server: Server | undefined;
let hits = 0;

/** Starts a stub on 127.0.0.1 and returns its origin. */
function stub(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<string> {
  hits = 0;
  return new Promise((resolve) => {
    const s = createServer((req, res) => {
      hits++;
      handler(req, res);
    });
    server = s;
    s.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(s.address() as AddressInfo).port}`));
  });
}

afterEach(async () => {
  const s = server;
  server = undefined;
  if (!s) return;
  s.closeAllConnections();
  await new Promise<void>((done) => s.close(() => done()));
});

const LOCAL = { local: true };
const ok = (_req: IncomingMessage, res: ServerResponse) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('hello');
};

describe('probeUnpaid', () => {
  it('a target other than the literal loopback is refused before any request', async () => {
    const origin = await stub(ok);
    const named = origin.replace('127.0.0.1', 'localhost');
    expect(await probeUnpaid(named, LOCAL, [{ route: '/a', path: '/a' }])).toEqual({
      ok: false,
      code: 'host-not-loopback-literal',
    });
    expect(await probeUnpaid(origin, { local: false }, [{ route: '/a', path: '/a' }])).toEqual({
      ok: false,
      code: 'local-flag-required',
    });
    expect(hits).toBe(0);
  });
  it('a non-402 reply is recorded with no network check and no outcome', async () => {
    const origin = await stub(ok);
    const r = await probeUnpaid(origin, LOCAL, [{ route: '/a', path: '/a' }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [entry] = r.entries;
    expect(entry?.sent).toBe(true);
    if (!entry?.sent) return;
    expect(entry.record.status).toBe(200);
    expect(entry.record.body?.length).toBe(5);
    expect(entry.network).toBe(null);
    expect(Object.keys(entry).sort()).toEqual(['network', 'record', 'route', 'sent']);
    expect(hits).toBe(1);
  });
  it('a refused route is reported by code and the others still run', async () => {
    const origin = await stub(ok);
    const r = await probeUnpaid(origin, LOCAL, [
      { route: '/bad', path: '//example.test' },
      { route: '/a', path: '/a' },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entries[0]).toEqual({ route: '/bad', sent: false, code: 'path-invalid' });
    expect(r.entries[1]?.sent).toBe(true);
    expect(hits).toBe(1);
  });
  it('a payment header in a route is refused and not sent', async () => {
    const origin = await stub(ok);
    const r = await probeUnpaid(origin, LOCAL, [
      { route: '/a', path: '/a', headers: { 'PAYMENT-SIGNATURE': 'x' } },
      { route: '/b', path: '/b', headers: { 'X-Payment': 'x' } },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entries).toEqual([
      { route: '/a', sent: false, code: 'payment-header-not-allowed' },
      { route: '/b', sent: false, code: 'payment-header-not-allowed' },
    ]);
    expect(hits).toBe(0);
  });
});
