// A test-only fake paid path: it approves whatever the configured facilitator approves. It says
// nothing about real facilitators, buyers or settlement, and it is not a model for a real seller.
// The facilitator must be on the literal 127.0.0.1 (lib/origin.js's rule); its request shapes copy
// what the installed @x402/core 2.31.0 client sends to /verify and /settle. A settle timeout is
// indeterminate by that client's own comment; treating it as unpaid is a demo choice. The payment
// header and its decoded payload are never logged, stored or returned: only a short reason code.
import { configuredOrigin } from './origin.js';

const MAX_HEADER = 8 * 1024;
const MAX_REPLY = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 2000;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const unpaid = (reason) => ({ paid: false, reason });

/** The decoded payment payload, or a reason code. The header is never returned. */
function decodeHeader(headerValue) {
  if (headerValue === undefined || headerValue === null || headerValue === '') return { reason: 'no-header' };
  if (typeof headerValue !== 'string') return { reason: 'header-not-text' };
  if (headerValue.length > MAX_HEADER) return { reason: 'header-too-large' };
  if (headerValue.length % 4 !== 0 || !BASE64.test(headerValue)) return { reason: 'header-not-base64-json' };
  let payload;
  try {
    payload = JSON.parse(Buffer.from(headerValue, 'base64').toString('utf8'));
  } catch {
    return { reason: 'header-not-base64-json' };
  }
  if (!isPlainObject(payload)) return { reason: 'payload-not-object' };
  return { payload };
}

/** Reads at most MAX_REPLY bytes of a reply as JSON; null if it is longer, unreadable or not an object. */
async function readJson(res) {
  if (!res.body) return null;
  const reader = res.body.getReader();
  const parts = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_REPLY) {
      await reader.cancel().catch(() => {});
      return null;
    }
    parts.push(value);
  }
  try {
    const v = JSON.parse(Buffer.concat(parts).toString('utf8'));
    return isPlainObject(v) ? v : null;
  } catch {
    return null;
  }
}

/** One POST with its own deadline. Returns { status, json } or { reason } on a thrown error or timeout. */
async function post(fetchImpl, url, body, timeoutMs, failedReason) {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      redirect: 'manual',
      signal,
    });
    if (res.status !== 200) {
      await res.body?.cancel().catch(() => {});
      return { reason: failedReason };
    }
    const json = await readJson(res);
    return json === null ? { reason: 'reply-bad-shape' } : { json };
  } catch {
    return { reason: signal.aborted ? 'timeout' : failedReason };
  }
}

/**
 * Decides whether a request carrying this payment header counts as paid. requirement is the route's
 * one accepts entry. Paid only if verify answers 200 with isValid true and then settle answers 200
 * with success true and a text transaction. Every other outcome is unpaid, with a reason code; the
 * caller answers unpaid with its 402. Never throws.
 */
export async function decidePaid({ headerValue, requirement, facilitatorOrigin, fetch: fetchImpl, timeoutMs }) {
  const decoded = decodeHeader(headerValue);
  if (!decoded.payload) return unpaid(decoded.reason);
  const origin = configuredOrigin(facilitatorOrigin);
  // The caller passes fetch in; without one nothing is sent, so a test can never reach the network.
  if (!origin.ok || typeof fetchImpl !== 'function') return unpaid('facilitator-missing');
  const send = fetchImpl;
  const deadline =
    Number.isInteger(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs, MAX_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS;
  const body = JSON.stringify({ x402Version: 2, paymentPayload: decoded.payload, paymentRequirements: requirement });

  const verify = await post(send, `${origin.origin}/verify`, body, deadline, 'verify-failed');
  if (!verify.json) return unpaid(verify.reason);
  if (verify.json.isValid !== true) return unpaid('verify-not-valid');

  const settle = await post(send, `${origin.origin}/settle`, body, deadline, 'settle-failed');
  if (!settle.json) return unpaid(settle.reason);
  if (settle.json.success !== true) return unpaid('settle-not-success');
  if (typeof settle.json.transaction !== 'string') return unpaid('reply-bad-shape');
  return { paid: true, reason: 'paid' };
}
