// A stand-in facilitator for tests only. It is a fake: it approves, fails or stalls on purpose, on
// the literal 127.0.0.1 only, and says nothing about how any real facilitator behaves or what the
// real client's reply schemas accept. Its paths and shapes copy what the installed @x402/core
// 2.31.0 client calls (POST /verify, POST /settle, GET /supported), as read from that package's
// types; nothing more is claimed. It records counts and shapes only: never a body, never any part
// of a payment, never a header value, never a reply. Nothing is logged or printed. The mode can be
// changed while it runs (setMode); a change applies to later requests only, and the counts and the
// log are never reset.
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

export const STANDIN_HOST = '127.0.0.1';
export const MAX_STANDIN_BODY_BYTES = 1_048_576;
export const MAX_HOLD_MS = 2000;
const DEFAULT_HOLD_MS = 1000;
const MAX_REQUESTS = 20;
const MODES = ['always-valid', 'error', 'timeout'] as const;

export type StandInMode = (typeof MODES)[number];
export type StandInPath = 'verify' | 'settle' | 'supported' | 'other';
export type StandInCode =
  | 'host-not-loopback-literal'
  | 'mode-unknown'
  | 'hold-too-long'
  | 'hold-invalid'
  | 'listen-failed';

export interface StandInOptions {
  /** Must be exactly '127.0.0.1'. */
  host: unknown;
  /** The starting mode; setMode() can change it while running, for later requests only. */
  mode: StandInMode;
  /** Timeout mode only: how long a request is held unanswered before its connection is closed. At most MAX_HOLD_MS. */
  holdMs?: number;
  /** Requests answered before every further one is refused; kept within 1 to 20. */
  maxRequests?: number;
}

export interface StandInRequest {
  path: string;
  method: string;
  bodyLength: number;
  json: boolean;
  topKeys: string[];
  x402Version: number | null;
  scheme: string | null;
  network: string | null;
  headerNames: string[];
}

export interface StandInLog {
  counts: Record<StandInPath | 'refused', number>;
  requests: StandInRequest[];
}

export interface StandIn {
  origin: string;
  port: number;
  /** A copy of what was received: counts and shapes only. Cumulative; never reset by setMode. */
  seen: () => StandInLog;
  /**
   * Changes how later requests are answered. A request already held in timeout mode keeps its own
   * hold until that ends or stop() is called. Setting the same mode again is fine.
   */
  setMode: (mode: unknown) => { ok: true } | { ok: false; code: 'mode-unknown' | 'stopped' };
  /** Clears every timer and closes every connection at once, then stops listening. */
  stop: () => Promise<void>;
}

const KEY = /^[A-Za-z][A-Za-z0-9_]{0,40}$/;
const SCHEME = /^[a-z0-9-]{1,32}$/;
const NETWORK = /^[a-z0-9-]{1,32}:[A-Za-z0-9-]{1,64}$/;
const HEADER = /^[a-z0-9-]{1,64}$/;
const kept = (v: unknown, pattern: RegExp): string | null => (typeof v === 'string' && pattern.test(v) ? v : null);

const pathOf = (req: IncomingMessage): StandInPath => {
  const p = (req.url ?? '').split('?')[0];
  if (req.method === 'POST' && p === '/verify') return 'verify';
  if (req.method === 'POST' && p === '/settle') return 'settle';
  if (req.method === 'GET' && p === '/supported') return 'supported';
  return 'other';
};

/** The shape of a request: names, lengths and short public fields only. */
function shapeOf(req: IncomingMessage, body: Buffer): StandInRequest {
  const shape: StandInRequest = {
    path: pathOf(req) === 'other' ? 'other' : `/${pathOf(req)}`,
    method: typeof req.method === 'string' && /^[A-Z]{1,10}$/.test(req.method) ? req.method : '(method)',
    bodyLength: body.length,
    json: false,
    topKeys: [],
    x402Version: null,
    scheme: null,
    network: null,
    headerNames: Object.keys(req.headers)
      .filter((h) => HEADER.test(h))
      .sort(),
  };
  if (body.length === 0) return shape;
  try {
    const v: unknown = JSON.parse(body.toString('utf8'));
    shape.json = true;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      shape.topKeys = Object.keys(o)
        .filter((k) => KEY.test(k))
        .slice(0, 20);
      shape.x402Version = Number.isInteger(o.x402Version) ? (o.x402Version as number) : null;
      const pr = o.paymentRequirements;
      if (pr && typeof pr === 'object') {
        const r = pr as Record<string, unknown>;
        shape.scheme = kept(r.scheme, SCHEME);
        shape.network = kept(r.network, NETWORK);
      }
    }
  } catch {
    // Not JSON: only its length is kept.
  }
  return shape;
}

const send = (res: ServerResponse, status: number, body: unknown, close = false): void => {
  res.writeHead(status, { 'content-type': 'application/json', ...(close ? { connection: 'close' } : {}) });
  res.end(JSON.stringify(body));
};

/** The replies of the always-valid mode. A fake for tests only. */
function alwaysValid(path: StandInPath, fakeTransaction: string): [number, unknown] {
  if (path === 'verify') return [200, { isValid: true }];
  // transaction is a made-up value with a stand-in- prefix, made at run time: not a real transaction.
  // Whether the real client's schema accepts it could not be verified here.
  if (path === 'settle') return [200, { success: true, transaction: fakeTransaction, network: 'eip155:84532' }];
  return [
    200,
    {
      kinds: [
        { x402Version: 2, scheme: 'exact', network: 'eip155:84532' },
        { x402Version: 2, scheme: 'upto', network: 'eip155:84532' },
      ],
      extensions: [],
      signers: {},
    },
  ];
}

export async function startStandIn(
  options: StandInOptions,
): Promise<({ ok: true } & StandIn) | { ok: false; code: StandInCode }> {
  if (options?.host !== STANDIN_HOST) return { ok: false, code: 'host-not-loopback-literal' };
  if (!(MODES as readonly unknown[]).includes(options.mode)) return { ok: false, code: 'mode-unknown' };
  const holdMs = options.holdMs ?? DEFAULT_HOLD_MS;
  if (!Number.isInteger(holdMs) || holdMs < 0) return { ok: false, code: 'hold-invalid' };
  if (holdMs > MAX_HOLD_MS) return { ok: false, code: 'hold-too-long' };
  const requested = options.maxRequests;
  const maxRequests =
    typeof requested === 'number' && Number.isInteger(requested)
      ? Math.min(Math.max(requested, 1), MAX_REQUESTS)
      : MAX_REQUESTS;
  // Read when each request has finished arriving, so setMode() affects later requests only.
  let mode: StandInMode = options.mode;
  const fakeTransaction = `stand-in-${randomBytes(4).toString('hex')}`;

  const log: StandInLog = { counts: { verify: 0, settle: 0, supported: 0, other: 0, refused: 0 }, requests: [] };
  const sockets = new Set<Socket>();
  const timers = new Set<NodeJS.Timeout>();
  let received = 0;

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk: Buffer) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > MAX_STANDIN_BODY_BYTES) {
        // Past the cap: keep nothing, and answer once the request has finished arriving.
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) {
        log.counts.refused++;
        send(res, 413, { error: 'stand-in-body-too-large' }, true);
        return;
      }
      received++;
      if (received > maxRequests) {
        log.counts.refused++;
        send(res, 503, { error: 'stand-in-request-limit' });
        return;
      }
      const path = pathOf(req);
      log.counts[path]++;
      log.requests.push(shapeOf(req, Buffer.concat(chunks)));
      if (path === 'other') {
        send(res, 404, { error: 'not-found' });
        return;
      }
      if (mode === 'error') {
        send(res, 500, { error: 'stand-in-error' });
        return;
      }
      if (mode === 'timeout') {
        // The only timer: hold the request unanswered, then close its connection. unref() so it never
        // keeps Node running; stop() clears it.
        const t = setTimeout(() => {
          timers.delete(t);
          req.socket.destroy();
        }, holdMs);
        t.unref();
        timers.add(t);
        return;
      }
      const [status, body] = alwaysValid(path, fakeTransaction);
      send(res, status, body);
    });
  });
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });

  const port = await new Promise<number | null>((resolve) => {
    server.once('error', () => resolve(null));
    server.listen(0, STANDIN_HOST, () => resolve((server.address() as AddressInfo).port));
  });
  if (port === null) return { ok: false, code: 'listen-failed' };

  let stopped: Promise<void> | null = null;
  return {
    ok: true,
    origin: `http://${STANDIN_HOST}:${port}`,
    port,
    seen: () => JSON.parse(JSON.stringify(log)) as StandInLog,
    setMode: (next) => {
      if (stopped) return { ok: false, code: 'stopped' };
      if (!(MODES as readonly unknown[]).includes(next)) return { ok: false, code: 'mode-unknown' };
      mode = next as StandInMode;
      return { ok: true };
    },
    stop: () => {
      if (stopped) return stopped;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      for (const s of sockets) s.destroy();
      sockets.clear();
      stopped = new Promise<void>((done) => server.close(() => done()));
      return stopped;
    },
  };
}
