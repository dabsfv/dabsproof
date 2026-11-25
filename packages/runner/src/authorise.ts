// Checks one payment request against the policy and, only if every check passes, returns a checked
// plan. Pure: no key, no signing, no journal, nothing sent, no file, no environment, and no time or
// randomness of its own (the caller passes in a clock and a random source). Every field of the
// seller's terms is untrusted. Each check gives one fixed reason code and nothing else, in a fixed
// order; no error is thrown with input text in it. A plan is made only here, is frozen, and prints
// as [CheckedPlan] only; its nonce and digest are read only through readPlanForSigning, which only
// the signer is meant to call. This file does not count spending: the caller passes the run's total
// so far. Nothing in the runner uses it yet.
import { BASE_SEPOLIA } from '@dabsproof/registry';
import { TRANSFER_DOMAIN, type TypedDataReason, transferDigest } from './typed-data.js';

/** Hard limits in base units (USDC has 6 decimals): a caller may lower them, never raise them. */
export const MAX_PER_SIGNATURE_UNITS = 100_000n;
export const MAX_PER_RUN_UNITS = 1_000_000n;
export const MAX_PAYEES = 5;
export const MAX_WINDOW_SECONDS = 300;

export type AuthoriseReason =
  | 'shape-not-allowed'
  | 'payer-invalid'
  | 'policy-invalid'
  | 'clock-failed'
  | 'chain-id-mismatch'
  | 'token-not-allowed'
  | 'domain-mismatch'
  | 'transfer-method-not-allowed'
  | 'payee-list-invalid'
  | 'payee-not-allowed'
  | 'amount-invalid'
  | 'amount-over-signature-cap'
  | 'amount-over-run-cap'
  | 'window-invalid'
  | 'window-too-long'
  | 'random-source-failed'
  | TypedDataReason;

export interface AuthoriseInput {
  requirements: unknown;
  payer: unknown;
  policy: unknown;
  /** Whole seconds now. */
  clock: () => number;
  /** n random bytes. */
  random: (n: number) => Uint8Array;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const DECIMAL = /^(?:0|[1-9][0-9]{0,77})$/;
const UINT256_MAX = (1n << 256n) - 1n;
const TOKEN = TRANSFER_DOMAIN.verifyingContract.toLowerCase();

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isAddress = (v: unknown): v is string => typeof v === 'string' && ADDRESS.exec(v) !== null;
const isZero = (a: string) => /^0x0{40}$/.test(a);
/** A decimal string within uint256, or null. */
const uint = (v: unknown): bigint | null => {
  if (typeof v !== 'string' || DECIMAL.exec(v) === null) return null;
  const n = BigInt(v);
  return n <= UINT256_MAX ? n : null;
};

const LABEL = '[CheckedPlan]';
/** Every plan authorise made. */
const issued = new WeakSet<object>();
/** Nonce and digest live here, not on the plan, so no method or property of a plan can give them. */
const secrets = new WeakMap<object, Readonly<{ nonce: string; digestHex: string }>>();
const toHex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

class CheckedPlan {
  readonly #from: string;
  readonly #to: string;
  readonly #value: string;
  readonly #validBefore: string;
  constructor(from: string, to: string, value: string, validBefore: string) {
    this.#from = from;
    this.#to = to;
    this.#value = value;
    this.#validBefore = validBefore;
  }
  get network(): string {
    return BASE_SEPOLIA;
  }
  get asset(): string {
    return TRANSFER_DOMAIN.verifyingContract;
  }
  get from(): string {
    return this.#from;
  }
  get to(): string {
    return this.#to;
  }
  get value(): string {
    return this.#value;
  }
  get validAfter(): string {
    return '0';
  }
  get validBefore(): string {
    return this.#validBefore;
  }
  toJSON(): string {
    return LABEL;
  }
  toString(): string {
    return LABEL;
  }
  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return LABEL;
  }
}

/** True only for a plan made by authorise. A look-alike object is never accepted. */
export const isCheckedPlan = (x: unknown): x is CheckedPlan => typeof x === 'object' && x !== null && issued.has(x);

/** Every field the signer needs, nonce and digest included. For the signer only; null for anything else. */
export function readPlanForSigning(plan: unknown): Readonly<{
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
  digestHex: string;
}> | null {
  const hidden = isCheckedPlan(plan) ? secrets.get(plan) : undefined;
  if (!isCheckedPlan(plan) || hidden === undefined) return null;
  const { nonce, digestHex } = hidden;
  return Object.freeze({
    from: plan.from,
    to: plan.to,
    value: plan.value,
    validAfter: plan.validAfter,
    validBefore: plan.validBefore,
    nonce,
    digestHex,
  });
}

export type AuthoriseResult = { ok: true; plan: CheckedPlan } | { ok: false; reason: AuthoriseReason };
const no = (reason: AuthoriseReason): AuthoriseResult => ({ ok: false, reason });

/** Runs every check in order; the first that fails gives its reason, and no plan is made. */
export function authorise(input: AuthoriseInput): AuthoriseResult {
  try {
    const { requirements: r, payer, policy: p, clock, random } = input ?? ({} as AuthoriseInput);
    if (!isObject(r) || !isObject(p) || typeof clock !== 'function' || typeof random !== 'function') {
      return no('shape-not-allowed');
    }
    // Each field is read once, so a value cannot change between its check and its use.
    const { scheme, network, asset, amount, payTo, maxTimeoutSeconds, extra } = r;
    const { payees, perSignatureCap, perRunCap, spentSoFar, excluded } = p;
    if (!Array.isArray(payees) || !Array.isArray(excluded)) return no('shape-not-allowed');
    if (typeof perSignatureCap !== 'string' || typeof perRunCap !== 'string' || typeof spentSoFar !== 'string') {
      return no('shape-not-allowed');
    }
    if (!isAddress(payer)) return no('payer-invalid');
    const sigCap = uint(perSignatureCap);
    const runCap = uint(perRunCap);
    const spent = uint(spentSoFar);
    if (sigCap === null || sigCap <= 0n || sigCap > MAX_PER_SIGNATURE_UNITS) return no('policy-invalid');
    if (runCap === null || runCap <= 0n || runCap > MAX_PER_RUN_UNITS || spent === null) return no('policy-invalid');
    const excludedList = [...excluded];
    if (!excludedList.every(isAddress)) return no('policy-invalid');
    const payeeList = [...payees];

    if (scheme !== 'exact') return no('shape-not-allowed');
    if (network !== BASE_SEPOLIA) return no('chain-id-mismatch');
    if (typeof asset !== 'string' || asset.toLowerCase() !== TOKEN) return no('token-not-allowed');
    const name = isObject(extra) ? extra.name : undefined;
    const version = isObject(extra) ? extra.version : undefined;
    if (name !== TRANSFER_DOMAIN.name || version !== TRANSFER_DOMAIN.version) return no('domain-mismatch');
    const method = isObject(extra) ? extra.assetTransferMethod : undefined;
    if (method !== undefined && method !== 'eip3009') return no('transfer-method-not-allowed');

    const notAllowed = new Set([payer.toLowerCase(), TOKEN, ...excludedList.map((a) => a.toLowerCase())]);
    if (payeeList.length === 0 || payeeList.length > MAX_PAYEES) return no('payee-list-invalid');
    for (const a of payeeList) {
      if (!isAddress(a) || isZero(a) || notAllowed.has(a.toLowerCase())) return no('payee-list-invalid');
    }
    if (!isAddress(payTo) || !payeeList.some((a) => a.toLowerCase() === payTo.toLowerCase())) {
      return no('payee-not-allowed');
    }

    const value = uint(amount);
    if (value === null || value <= 0n) return no('amount-invalid');
    if (value > sigCap) return no('amount-over-signature-cap');
    if (spent + value > runCap) return no('amount-over-run-cap');

    if (typeof maxTimeoutSeconds !== 'number' || !Number.isSafeInteger(maxTimeoutSeconds) || maxTimeoutSeconds <= 0) {
      return no('window-invalid');
    }
    if (maxTimeoutSeconds > MAX_WINDOW_SECONDS) return no('window-too-long');

    let now: unknown;
    try {
      now = clock();
    } catch {
      return no('clock-failed');
    }
    if (typeof now !== 'number' || !Number.isSafeInteger(now) || now < 0) return no('clock-failed');
    if (!Number.isSafeInteger(now + maxTimeoutSeconds)) return no('clock-failed');
    let bytes: unknown;
    try {
      bytes = random(32);
    } catch {
      return no('random-source-failed');
    }
    if (!(bytes instanceof Uint8Array) || bytes.length !== 32) return no('random-source-failed');
    if (bytes.every((b) => b === 0)) return no('random-source-failed');
    const nonce = `0x${toHex(bytes)}`;

    const validBefore = String(now + maxTimeoutSeconds);
    const value10 = value.toString(10);
    const d = transferDigest({ from: payer, to: payTo, value: value10, validAfter: '0', validBefore, nonce });
    if (!d.ok) return no(d.reason);
    const plan = new CheckedPlan(payer, payTo, value10, validBefore);
    Object.freeze(plan);
    secrets.set(plan, Object.freeze({ nonce, digestHex: d.digestHex }));
    issued.add(plan);
    return { ok: true, plan };
  } catch {
    // A getter or proxy on the input that throws: refused with no input text.
    return no('shape-not-allowed');
  }
}
