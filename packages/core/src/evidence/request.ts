// One request and its response, captured by allow-list. Header names are matched without regard
// to letter case. Every value not on an allow-list (and every query value) is registered as a
// secret on sight, before anything is kept, so every kept field is checked against the full register.
// Response header values off the allow-list are reduced to name and length; those whose name
// suggests a credential (cookie, auth, token, key, secret, session) are also registered.
import { type BodyDigest, bodyDigest } from './body.js';
import { LIMITS } from './limits.js';
import {
  inspectPaymentHeader,
  inspectPaymentRequired,
  inspectPaymentResponse,
  type PaymentObservation,
  type PaymentRequiredObservation,
  type SettlementObservation,
} from './payment.js';
import type { RunContext } from './run-context.js';
import { type KeptUrl, keepUrl } from './url.js';

/** Request headers whose values are kept. */
export const REQUEST_VALUE_HEADERS = Object.freeze(['content-type', 'accept', 'content-length']);
/** Response headers whose values are kept (cache headers for X402-04). */
export const RESPONSE_VALUE_HEADERS = Object.freeze([
  'content-type',
  'content-length',
  'cache-control',
  'vary',
  'age',
  'expires',
  'pragma',
]);
const PAYMENT_REQUEST_HEADERS = Object.freeze(['payment-signature', 'x-payment']);
const HEADER_NAME = /^[a-z0-9-]{1,64}$/;
const CREDENTIAL_NAME = /cookie|auth|token|key|secret|session/;

/** Registers a header value, or each item of a list value. */
const register = (ctx: RunContext, v: unknown): void => {
  if (Array.isArray(v)) for (const item of v) ctx.registerSecret(item);
  else ctx.registerSecret(v);
};

export type Headers = Iterable<readonly [string, unknown]> | Record<string, unknown>;

export interface HeaderEntry {
  name: string;
  value?: string;
  length: number | null;
  note?: 'not-text';
}

export interface RequestRecord {
  kind: 'request-record';
  runId: string;
  method: string | null;
  url: KeptUrl | null;
  status: number | null;
  requestHeaders: HeaderEntry[];
  responseHeaders: HeaderEntry[];
  payment: PaymentObservation | null;
  paymentRequired: PaymentRequiredObservation | null;
  settlement: SettlementObservation | null;
  body: BodyDigest | null;
  /** Fields over a cap or not kept for another reason: counted, never kept. */
  dropped: number;
}

export interface RequestInput {
  method: unknown;
  url: unknown;
  requestHeaders?: Headers;
  status?: unknown;
  responseHeaders?: Headers;
  body?: Uint8Array | string;
}

const entriesOf = (h: Headers | undefined): [string, unknown][] =>
  h === undefined
    ? []
    : Symbol.iterator in Object(h)
      ? [...(h as Iterable<readonly [string, unknown]>)].map(([k, v]) => [k, v])
      : Object.entries(h);

export function recordRequest(ctx: RunContext, input: RequestInput): RequestRecord {
  const req = entriesOf(input.requestHeaders).map(([k, v]) => [String(k).toLowerCase(), v] as const);
  const res = entriesOf(input.responseHeaders).map(([k, v]) => [String(k).toLowerCase(), v] as const);

  // Pass 1: register every value that must stay private, before anything is kept.
  for (const [name, v] of req) if (!REQUEST_VALUE_HEADERS.includes(name)) register(ctx, v);
  for (const [name, v] of res) if (CREDENTIAL_NAME.test(name)) register(ctx, v);
  let payment: PaymentObservation | null = null;
  for (const [name, v] of req)
    if (PAYMENT_REQUEST_HEADERS.includes(name) && !payment) payment = inspectPaymentHeader(ctx, name, v);
  let paymentRequired: PaymentRequiredObservation | null = null;
  let settlement: SettlementObservation | null = null;
  for (const [name, v] of res) {
    if (typeof v !== 'string') continue;
    if (name === 'payment-required' && !paymentRequired) paymentRequired = inspectPaymentRequired(ctx, name, v);
    if (name === 'payment-response' && !settlement) settlement = inspectPaymentResponse(ctx, name, v);
  }
  const url = keepUrl(ctx, input.url);

  // Pass 2: keep what the allow-lists permit.
  let dropped = url ? url.dropped : 1;
  const keepHeaders = (list: readonly (readonly [string, unknown])[], allow: readonly string[]): HeaderEntry[] =>
    list.map(([name, v]) => {
      const safeName = HEADER_NAME.test(name) ? name : '(header)';
      if (safeName !== name) dropped++;
      if (typeof v !== 'string') return { name: safeName, length: null, note: 'not-text' };
      if (allow.includes(name) && v.length <= LIMITS.maxText && !ctx.holdsSecret(v)) {
        return { name: safeName, value: v, length: v.length };
      }
      if (allow.includes(name)) dropped++;
      return { name: safeName, length: v.length };
    });
  const method =
    typeof input.method === 'string' && /^[A-Za-z]{1,10}$/.test(input.method) ? input.method.toUpperCase() : null;
  const status =
    typeof input.status === 'number' && Number.isInteger(input.status) && input.status >= 100 && input.status <= 599
      ? input.status
      : null;
  return {
    kind: 'request-record',
    runId: ctx.runId,
    method,
    url,
    status,
    requestHeaders: keepHeaders(req, REQUEST_VALUE_HEADERS),
    responseHeaders: keepHeaders(res, RESPONSE_VALUE_HEADERS),
    payment,
    paymentRequired,
    settlement,
    body: input.body === undefined ? null : bodyDigest(input.body),
    dropped: dropped + (payment?.dropped ?? 0) + (paymentRequired?.dropped ?? 0) + (settlement?.dropped ?? 0),
  };
}
