// Sending one GET to a checked local target, within the budget. Redirects are never followed. The
// body is read as a stream and refused, with none of it kept, once it passes MAX_BODY_BYTES.
import type { RequestBudget } from './budget.js';
import type { LocalTarget } from './target.js';

export const MAX_BODY_BYTES = 1_048_576;
/** Only so that a server that never answers cannot stall a run. */
const REQUEST_TIMEOUT_MS = 30_000;

export type SendCode =
  | 'path-invalid'
  | 'host-header-not-allowed'
  | 'route-request-limit'
  | 'burst-limit'
  | 'redirect-not-followed'
  | 'redirect-off-host'
  | 'body-too-large'
  | 'request-failed';

/** A path from the manifest: one leading /, no // anywhere, and no backslash, @, #, white space or control character. */
const PATH = /^\/[^\\@#\s]*$/;
const hasControl = (s: string): boolean =>
  [...s].some((c) => {
    const n = c.charCodeAt(0);
    return n < 0x20 || n === 0x7f;
  });

/** The request the runner will make: GET, the target's origin plus a path, and the caller's headers. Never a Host header. */
export function buildRequest(
  target: LocalTarget,
  path: string,
  headers: Readonly<Record<string, string>> = {},
):
  | { ok: true; url: string; init: { method: 'GET'; headers: Record<string, string>; redirect: 'manual' } }
  | { ok: false; code: 'path-invalid' | 'host-header-not-allowed' } {
  if (typeof path !== 'string' || !PATH.test(path) || path.includes('//') || hasControl(path)) {
    return { ok: false, code: 'path-invalid' };
  }
  const url = `${target.origin}${path}`;
  if (new URL(url).origin !== new URL(target.origin).origin) return { ok: false, code: 'path-invalid' };
  const own: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === 'host') return { ok: false, code: 'host-header-not-allowed' };
    own[name] = value;
  }
  // fetch sets its own Host from the URL; this checks only the runner's own header list.
  return { ok: true, url, init: { method: 'GET', headers: own, redirect: 'manual' } };
}

/** Reads the body up to MAX_BODY_BYTES. Past the cap it stops reading and keeps nothing. */
async function readCapped(res: Response): Promise<Uint8Array | 'too-large' | 'failed'> {
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        parts.length = 0;
        await reader.cancel().catch(() => {});
        return 'too-large';
      }
      parts.push(value);
    }
  } catch {
    return 'failed';
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

/** Sends one GET within the budget. Redirects are never followed. */
export async function sendLocal(
  target: LocalTarget,
  budget: RequestBudget,
  route: string,
  path: string,
  headers?: Readonly<Record<string, string>>,
): Promise<
  { ok: true; status: number; headers: Record<string, string>; body: Uint8Array } | { ok: false; code: SendCode }
> {
  const built = buildRequest(target, path, headers);
  if (!built.ok) return built;
  const slot = budget.begin(route);
  if (!slot.ok) return slot;
  try {
    let res: Response;
    try {
      res = await fetch(built.url, { ...built.init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch {
      return { ok: false, code: 'request-failed' };
    }
    const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    // A 3xx reply with no Location header is returned below as an ordinary reply: there is nothing to follow.
    if (location !== null) {
      await res.body?.cancel().catch(() => {});
      let next: URL;
      try {
        next = new URL(location, built.url);
      } catch {
        // A Location that cannot be read cannot be shown to stay on this host.
        return { ok: false, code: 'redirect-off-host' };
      }
      return {
        ok: false,
        code: next.origin === new URL(built.url).origin ? 'redirect-not-followed' : 'redirect-off-host',
      };
    }
    const body = await readCapped(res);
    if (body === 'too-large') return { ok: false, code: 'body-too-large' };
    if (body === 'failed') return { ok: false, code: 'request-failed' };
    return { ok: true, status: res.status, headers: Object.fromEntries(res.headers), body };
  } finally {
    slot.release();
  }
}
