// Payment headers. A signed payment is a bearer credential: its header value is registered as a
// secret the moment it is seen, and only its name, length, public terms and a salted fingerprint
// are ever returned.
//
// Decoded: version 2 PAYMENT-SIGNATURE (EIP-3009 exact payments only), PAYMENT-REQUIRED and
// PAYMENT-RESPONSE, as base64 JSON. Anything else, including version 1 X-PAYMENT, Permit2 and
// upto payloads, keeps its name and length only, with a fixed reason code; it is still decoded in
// memory so that every string field named signature or nonce is registered as a secret.
import { z } from 'zod';
import { decodeBase64Json, registerDeepSecrets } from './decode.js';
import { ALL_HEX, ERROR_CODE, LIMITS } from './limits.js';
import { EvidenceError, NO_FINGERPRINT_REASONS, type NoFingerprintReason } from './messages.js';
import type { RunContext } from './run-context.js';
import { type KeptUrl, keepUrl } from './url.js';

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const NETWORK = /^[a-z0-9-]{1,32}:[A-Za-z0-9-]{1,64}$/;
const SCHEME = /^[a-z0-9-]{1,32}$/;
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const digits = (max: number) => new RegExp(`^\\d{1,${max}}$`);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Keeps a public value only if it has the expected form, is under its cap and holds no registered secret. */
class Keeper {
  dropped = 0;
  constructor(private readonly ctx: RunContext) {}
  text(v: unknown, pattern: RegExp, max: number): string | undefined {
    if (v === undefined) return undefined;
    if (typeof v === 'string' && v.length <= max && pattern.test(v) && !this.ctx.holdsSecret(v)) return v;
    this.dropped++;
    return undefined;
  }
  int(v: unknown, max: number): number | undefined {
    if (v === undefined) return undefined;
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max) return v;
    this.dropped++;
    return undefined;
  }
}

/** Drops undefined fields, so an object of maybe-values becomes one with only kept values. */
const compact = <T extends object>(o: { [K in keyof T]: T[K] | undefined }): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

/** The EIP-3009 exact payment shape (read R1). Unknown fields are ignored, never kept. */
const Eip3009Payment = z.object({
  x402Version: z.literal(2),
  resource: z.object({ url: z.unknown() }).optional(),
  accepted: z.object({
    scheme: z.literal('exact'),
    network: z.unknown(),
    asset: z.unknown(),
    amount: z.unknown(),
    payTo: z.unknown(),
  }),
  payload: z.object({
    authorization: z.object({
      from: z.string().regex(ADDRESS),
      validAfter: z.unknown(),
      validBefore: z.string().regex(digits(LIMITS.maxTimeDigits)),
      nonce: z.string().min(1).max(LIMITS.maxText),
    }),
  }),
});
type Eip3009 = z.infer<typeof Eip3009Payment>;

export type DecodedPayment =
  | { ok: true; payment: Eip3009 }
  | { ok: false; decoded: boolean; reason: NoFingerprintReason; error: EvidenceError };

const refuse = (decoded: boolean, reason: NoFingerprintReason): DecodedPayment => ({
  ok: false,
  decoded,
  reason,
  error: new EvidenceError(reason),
});

/**
 * Decodes a PAYMENT-SIGNATURE value in memory. Every failure (base64, JSON.parse or schema)
 * becomes a fixed EvidenceError with no cause; the original error is never kept.
 */
export function decodePaymentSignature(ctx: RunContext, value: string): DecodedPayment {
  const d = decodeBase64Json(value);
  if (!d.ok) return refuse(false, 'undecodable');
  registerDeepSecrets(ctx, d.value);
  const p = d.value;
  if (!isObj(p)) return refuse(true, 'unsupported-payload');
  if (p.x402Version !== 2) return refuse(true, 'unsupported-version');
  if (!isObj(p.accepted) || !isObj(p.payload)) return refuse(true, 'unsupported-payload');
  if (p.accepted.scheme !== 'exact') return refuse(true, 'unsupported-scheme');
  if (!isObj(p.payload.authorization)) return refuse(true, 'unsupported-payload');
  const from = p.payload.authorization.from;
  if (typeof from === 'string') ctx.registerSecret(from);
  const r = Eip3009Payment.safeParse(p);
  if (!r.success) return refuse(true, 'missing-fields');
  return { ok: true, payment: r.data };
}

export interface PaymentTerms {
  scheme?: string;
  network?: string;
  asset?: string;
  amount?: string;
  payTo?: string;
  validAfter?: string;
  validBefore?: string;
  resource?: KeptUrl;
}

export interface PaymentObservation {
  headerName: string;
  length: number | null;
  decoded: boolean;
  terms: PaymentTerms | null;
  fingerprint: string | null;
  /** Set whenever fingerprint is null. A missing fingerprint never means "no reuse found". */
  noFingerprintReason: NoFingerprintReason | null;
  dropped: number;
}

const noFingerprint = (
  headerName: string,
  length: number | null,
  decoded: boolean,
  reason: NoFingerprintReason,
): PaymentObservation => ({
  headerName,
  length,
  decoded,
  terms: null,
  fingerprint: null,
  noFingerprintReason: reason,
  dropped: 0,
});

export function inspectPaymentHeader(ctx: RunContext, name: string, value: unknown): PaymentObservation {
  const headerName = name.toLowerCase();
  if (typeof value !== 'string') return noFingerprint(headerName, null, false, 'undecodable');
  ctx.registerSecret(value);
  if (headerName !== 'payment-signature') {
    // Not decoded for terms: decoded in memory only so its signature and nonce are registered.
    const d = decodeBase64Json(value);
    if (d.ok) registerDeepSecrets(ctx, d.value);
    return noFingerprint(
      headerName,
      value.length,
      false,
      headerName === 'x-payment' ? 'unsupported-version' : 'not-a-payment-header',
    );
  }
  const d = decodePaymentSignature(ctx, value);
  if (!d.ok) return noFingerprint(headerName, value.length, d.decoded, d.reason);
  const { accepted, payload, resource: res } = d.payment;
  const auth = payload.authorization;
  const k = new Keeper(ctx);
  const resource = res ? keepUrl(ctx, res.url) : null;
  const terms = compact<PaymentTerms>({
    scheme: k.text(accepted.scheme, SCHEME, 32),
    network: k.text(accepted.network, NETWORK, LIMITS.maxNetwork),
    asset: k.text(accepted.asset, ADDRESS, 42),
    amount: k.text(accepted.amount, digits(LIMITS.maxAmountDigits), LIMITS.maxAmountDigits),
    payTo: k.text(accepted.payTo, ADDRESS, 42),
    validAfter: k.text(auth.validAfter, digits(LIMITS.maxTimeDigits), LIMITS.maxTimeDigits),
    validBefore: k.text(auth.validBefore, digits(LIMITS.maxTimeDigits), LIMITS.maxTimeDigits),
    ...(resource ? { resource } : {}),
  });
  return {
    headerName,
    length: value.length,
    decoded: true,
    terms,
    fingerprint: ctx.fingerprint(auth.from, auth.nonce, auth.validBefore),
    noFingerprintReason: null,
    dropped: k.dropped + (resource ? resource.dropped : res ? 1 : 0),
  };
}

export interface FingerprintSummary {
  /** Payments that had a fingerprint and were compared. */
  compared: number;
  /** Fingerprints seen more than once in this run. */
  reusedGroups: number;
  /** Payments that could not be compared, by reason. Never counted as "no reuse". */
  notCompared: Record<NoFingerprintReason, number>;
}

/**
 * Compares the fingerprints of one run. Payments without a fingerprint are counted under
 * notCompared by reason; they never add to compared, so they can never read as "no reuse found".
 */
export function summariseFingerprints(observations: readonly PaymentObservation[]): FingerprintSummary {
  const notCompared = Object.fromEntries(NO_FINGERPRINT_REASONS.map((r) => [r, 0])) as Record<
    NoFingerprintReason,
    number
  >;
  const seen = new Map<string, number>();
  for (const o of observations) {
    if (o.fingerprint === null) notCompared[o.noFingerprintReason ?? 'undecodable']++;
    else seen.set(o.fingerprint, (seen.get(o.fingerprint) ?? 0) + 1);
  }
  const compared = [...seen.values()].reduce((a, b) => a + b, 0);
  return { compared, reusedGroups: [...seen.values()].filter((n) => n > 1).length, notCompared };
}

export interface RequiredTerms {
  scheme?: string;
  network?: string;
  asset?: string;
  amount?: string;
  payTo?: string;
  maxTimeoutSeconds?: number;
}

export interface PaymentRequiredObservation {
  headerName: string;
  length: number;
  decoded: boolean;
  resource: KeptUrl | null;
  accepts: RequiredTerms[];
  /** accepts entries over the cap of LIMITS.maxAccepts: counted, not kept. */
  acceptsOverCap: number;
  /** The free-text error is never kept, only its length. */
  errorLength: number | null;
  dropped: number;
}

export function inspectPaymentRequired(ctx: RunContext, name: string, value: string): PaymentRequiredObservation {
  const base = { headerName: name.toLowerCase(), length: value.length };
  const d = decodeBase64Json(value);
  if (!d.ok || !isObj(d.value)) {
    return { ...base, decoded: false, resource: null, accepts: [], acceptsOverCap: 0, errorLength: null, dropped: 0 };
  }
  registerDeepSecrets(ctx, d.value);
  const r = d.value;
  const k = new Keeper(ctx);
  const list = Array.isArray(r.accepts) ? r.accepts : [];
  const accepts = list.slice(0, LIMITS.maxAccepts).map((a): RequiredTerms => {
    if (!isObj(a)) {
      k.dropped++;
      return {};
    }
    return compact<RequiredTerms>({
      scheme: k.text(a.scheme, SCHEME, 32),
      network: k.text(a.network, NETWORK, LIMITS.maxNetwork),
      asset: k.text(a.asset, ADDRESS, 42),
      amount: k.text(a.amount, digits(LIMITS.maxAmountDigits), LIMITS.maxAmountDigits),
      payTo: k.text(a.payTo, ADDRESS, 42),
      maxTimeoutSeconds: k.int(a.maxTimeoutSeconds, LIMITS.maxTimeoutSeconds),
    });
  });
  const resource = isObj(r.resource) ? keepUrl(ctx, r.resource.url) : null;
  return {
    ...base,
    decoded: true,
    resource,
    accepts,
    acceptsOverCap: Math.max(0, list.length - LIMITS.maxAccepts),
    errorLength: typeof r.error === 'string' ? r.error.length : null,
    dropped: k.dropped + (resource ? resource.dropped : isObj(r.resource) ? 1 : 0),
  };
}

/**
 * The rule for keeping a payment service's error code: lower-case letters, digits and
 * underscores, 3 to 64 characters, starting with a letter (ERROR_CODE), not entirely hex digits
 * (ALL_HEX), and holding no registered secret. Anything else keeps only its length.
 */
export function keepErrorCode(ctx: RunContext, v: unknown): { code: string } | { codeLength: number } | null {
  if (typeof v !== 'string') return null;
  if (ERROR_CODE.test(v) && !ALL_HEX.test(v) && !ctx.holdsSecret(v)) return { code: v };
  return { codeLength: v.length };
}

export interface SettlementObservation {
  headerName: string;
  length: number;
  decoded: boolean;
  success: boolean | null;
  network?: string;
  /** From the settlement's transaction field, only if it is 0x and 64 hex characters. */
  transactionHash?: string;
  transactionLength?: number;
  /** Amount actually settled: digits only, at most LIMITS.maxAmountDigits. */
  amount?: string;
  errorReason?: { code: string } | { codeLength: number };
  /** errorMessage is free text: only its length is kept. */
  errorMessageLength?: number;
  dropped: number;
}

export function inspectPaymentResponse(ctx: RunContext, name: string, value: string): SettlementObservation {
  const base = { headerName: name.toLowerCase(), length: value.length };
  const d = decodeBase64Json(value);
  if (!d.ok || !isObj(d.value)) return { ...base, decoded: false, success: null, dropped: 0 };
  registerDeepSecrets(ctx, d.value);
  const s = d.value;
  ctx.registerSecret(s.payer); // the payer is never kept
  const k = new Keeper(ctx);
  const out: SettlementObservation = {
    ...base,
    decoded: true,
    success: typeof s.success === 'boolean' ? s.success : null,
    dropped: 0,
  };
  const network = k.text(s.network, NETWORK, LIMITS.maxNetwork);
  if (network) out.network = network;
  if (typeof s.transaction === 'string') {
    if (TX_HASH.test(s.transaction) && !ctx.holdsSecret(s.transaction)) out.transactionHash = s.transaction;
    else out.transactionLength = s.transaction.length;
  }
  const amount = k.text(s.amount, digits(LIMITS.maxAmountDigits), LIMITS.maxAmountDigits);
  if (amount) out.amount = amount;
  const reason = keepErrorCode(ctx, s.errorReason);
  if (reason) out.errorReason = reason;
  if (typeof s.errorMessage === 'string') out.errorMessageLength = s.errorMessage.length;
  out.dropped = k.dropped;
  return out;
}
