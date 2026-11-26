// Signs one checked plan with the buyer key, once, and returns a one-shot payment. Nothing here
// writes a file, keeps a record, sends anything, reads the environment or prints. The home folder is
// passed in. The key folder and file are checked by metadata before the key is read: a real folder
// owned by the current user with mode 0700, and a plain file opened without following a link, owned
// by the current user, mode 0600, one hard link, exactly 67 bytes. The file's bytes are never turned
// into text: they are checked byte by byte and decoded into a 32-byte key by arithmetic, and the read
// buffer and the key are zeroed on every path. The key goes only to the curve library (to derive the
// address and to sign); copies the library makes inside itself could not be cleared from here. The
// digest is signed as it is, not hashed again, with a low s and a recovery byte, and the signature is
// checked to recover to the payer before it is returned. Each result is one reason code; no path,
// error text or key material is ever in one. The signature and nonce leave only through take(),
// once. Nothing in the runner uses this file yet.
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { publicKeyToAddress } from '@dabsproof/evm';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { isCheckedPlan, readPlanForSigning } from './authorise.js';
import { walletFolderParts } from './wallet.js';

export type SignReason =
  | 'plan-not-checked'
  | 'plan-already-signed'
  | 'key-path-invalid'
  | 'key-folder-mode-wrong'
  | 'key-file-is-link'
  | 'key-file-missing'
  | 'key-file-mode-wrong'
  | 'key-file-malformed'
  | 'payer-mismatch'
  | 'sign-failed';

export interface SignInput {
  home: unknown;
  plan: unknown;
  /** RunContext.fingerprint, passed in: (payer, nonce, validBefore) => an fp1 string. */
  fingerprint: unknown;
}

const KEY_FILE = 'buyer.key';
const KEY_FILE_BYTES = 67;
const FP1 = /^fp1:[A-Za-z0-9_-]{43}$/;
/** The curve order as 32 big-endian bytes, from the library (a secret key must be below it). */
const ORDER = (() => {
  const out = new Uint8Array(32);
  let n = secp256k1.Point.Fn.ORDER;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return out;
})();

/** Every plan signed here; a plan is signed at most once. */
const signed = new WeakSet<object>();
type Secret = { authorization: Readonly<Record<string, string>>; signature: string };
/** The authorization and signature live here, not on the payment; take() removes them. */
const secrets = new WeakMap<object, Secret>();
const LABEL = '[SignedPayment]';

class SignedPayment {
  readonly #fp: string;
  readonly #network: string;
  readonly #asset: string;
  readonly #payTo: string;
  readonly #value: string;
  constructor(fp: string, network: string, asset: string, payTo: string, value: string) {
    this.#fp = fp;
    this.#network = network;
    this.#asset = asset;
    this.#payTo = payTo;
    this.#value = value;
  }
  get fp(): string {
    return this.#fp;
  }
  get network(): string {
    return this.#network;
  }
  get asset(): string {
    return this.#asset;
  }
  get payTo(): string {
    return this.#payTo;
  }
  get value(): string {
    return this.#value;
  }
  /** The authorization and signature, once; every later call gives already-sent. */
  take(): Secret | { ok: false; reason: 'already-sent' } {
    const s = secrets.get(this);
    if (s === undefined) return { ok: false, reason: 'already-sent' };
    secrets.delete(this);
    return s;
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

/** A plain absolute path as text: starts with /, no backslash or NUL, no empty, "." or ".." segment. */
function isPlainAbsolute(p: unknown): p is string {
  if (typeof p !== 'string' || p === '' || p.includes('\0') || p.includes('\\') || !isAbsolute(p)) return false;
  if (!p.startsWith('/')) return false;
  return p
    .slice(1)
    .split('/')
    .every((s) => s !== '' && s !== '.' && s !== '..');
}

/** One lower-case hex digit's value, or -1. */
const nibble = (b: number): number => (b >= 0x30 && b <= 0x39 ? b - 0x30 : b >= 0x61 && b <= 0x66 ? b - 0x57 : -1);

type Fail = { ok: false; reason: SignReason };
const no = (reason: SignReason): Fail => ({ ok: false, reason });

/** The injected fingerprint of the plan's payer, nonce and validBefore if it is fp1 plus 43 characters; else null. */
function fingerprintOf(p: { from: string; nonce: string; validBefore: string }, fingerprint: unknown): string | null {
  let fp: unknown;
  try {
    fp = typeof fingerprint === 'function' ? fingerprint(p.from, p.nonce, p.validBefore) : undefined;
  } catch {
    return null;
  }
  return typeof fp === 'string' && FP1.test(fp) ? fp : null;
}

/**
 * The fingerprint signPlan would give this plan, without reading a key, opening a file or marking
 * the plan as signed: so that the caller can record its intent before anything is signed.
 */
export function planFingerprint(
  plan: unknown,
  fingerprint: unknown,
): { ok: true; fp: string } | { ok: false; reason: 'plan-not-checked' | 'sign-failed' } {
  try {
    const p = readPlanForSigning(plan);
    if (p === null) return { ok: false, reason: 'plan-not-checked' };
    const fp = fingerprintOf(p, fingerprint);
    return fp === null ? { ok: false, reason: 'sign-failed' } : { ok: true, fp };
  } catch {
    return { ok: false, reason: 'sign-failed' };
  }
}

/** Runs every check in order; the first that fails gives its reason, and nothing is signed. */
export function signPlan(input: SignInput): { ok: true; payment: SignedPayment } | Fail {
  const key = new Uint8Array(32);
  const raw = new Uint8Array(KEY_FILE_BYTES + 1);
  let fd = -1;
  try {
    const { home, plan, fingerprint } = input ?? ({} as SignInput);
    const p = readPlanForSigning(plan);
    if (p === null || !isCheckedPlan(plan)) return no('plan-not-checked');
    if (signed.has(plan as object)) return no('plan-already-signed');
    // The fingerprint is made before the key is touched, so a bad one never costs a key read.
    const fp = fingerprintOf(p, fingerprint);
    if (fp === null) return no('sign-failed');
    if (!isPlainAbsolute(home)) return no('key-path-invalid');

    const uid = typeof process.getuid === 'function' ? process.getuid() : -1;
    const NOFOLLOW = constants.O_NOFOLLOW;
    if (uid < 0 || typeof NOFOLLOW !== 'number' || NOFOLLOW === 0) return no('key-folder-mode-wrong');
    const folder = join(home, ...walletFolderParts());
    const dir = lstatSync(folder, { throwIfNoEntry: false });
    if (dir === undefined || dir.isSymbolicLink() || !dir.isDirectory() || dir.uid !== uid) {
      return no('key-folder-mode-wrong');
    }
    if ((dir.mode & 0o7777) !== 0o700) return no('key-folder-mode-wrong');

    const file = join(folder, KEY_FILE);
    try {
      fd = openSync(file, constants.O_RDONLY | NOFOLLOW);
    } catch (e) {
      const code = (e as { code?: unknown } | null)?.code;
      if (code === 'ELOOP') return no('key-file-is-link');
      if (code === 'ENOENT') return no('key-file-missing');
      return no('key-file-mode-wrong');
    }
    const st = fstatSync(fd);
    if (!st.isFile() || st.uid !== uid || (st.mode & 0o7777) !== 0o600 || st.nlink !== 1) {
      return no('key-file-mode-wrong');
    }
    if (st.size !== KEY_FILE_BYTES) return no('key-file-mode-wrong');
    const atPath = lstatSync(file, { throwIfNoEntry: false });
    const again = lstatSync(folder, { throwIfNoEntry: false });
    if (atPath === undefined || atPath.isSymbolicLink() || atPath.dev !== st.dev || atPath.ino !== st.ino) {
      return no('key-file-mode-wrong');
    }
    if (again === undefined || again.isSymbolicLink() || again.dev !== dir.dev || again.ino !== dir.ino) {
      return no('key-folder-mode-wrong');
    }

    // One byte more than expected is asked for, so a file that grew is caught.
    let total = 0;
    for (;;) {
      const n = readSync(fd, raw, total, raw.length - total, total);
      if (n === 0) break;
      total += n;
      if (total >= raw.length) break;
    }
    let shapeOk = total === KEY_FILE_BYTES && raw[0] === 0x30 && raw[1] === 0x78 && raw[66] === 0x0a;
    for (let i = 0; shapeOk && i < 32; i++) {
      const hi = nibble(raw[2 + 2 * i] as number);
      const lo = nibble(raw[3 + 2 * i] as number);
      if (hi < 0 || lo < 0) shapeOk = false;
      else key[i] = hi * 16 + lo;
    }
    raw.fill(0);
    // Not all zero and below the curve order, compared byte by byte, so no copy of the key is made.
    let nonZero = false;
    let below = false;
    let decided = false;
    for (let i = 0; i < 32; i++) {
      const k = key[i] as number;
      const o = ORDER[i] as number;
      if (k !== 0) nonZero = true;
      if (!decided && k !== o) {
        below = k < o;
        decided = true;
      }
    }
    if (!shapeOk || !nonZero || !below) return no('key-file-malformed');

    const address = publicKeyToAddress(secp256k1.getPublicKey(key, true));
    if (address.toLowerCase() !== p.from.toLowerCase()) {
      key.fill(0);
      return no('payer-mismatch');
    }

    let signature: string;
    try {
      const digest = hexToBytes(p.digestHex.slice(2));
      if (digest.length !== 32) return no('sign-failed');
      const rec = secp256k1.sign(digest, key, { prehash: false, lowS: true, format: 'recovered', extraEntropy: false });
      key.fill(0);
      const recId = rec[0] as number;
      if (rec.length !== 65 || (recId !== 0 && recId !== 1)) return no('sign-failed');
      if (secp256k1.Signature.fromBytes(rec, 'recovered').hasHighS()) return no('sign-failed');
      const back = publicKeyToAddress(secp256k1.recoverPublicKey(rec, digest, { prehash: false }));
      if (back.toLowerCase() !== p.from.toLowerCase()) return no('sign-failed');
      signature = `0x${bytesToHex(rec.subarray(1))}${(27 + recId).toString(16)}`;
    } catch {
      return no('sign-failed');
    }

    const payment = new SignedPayment(fp, plan.network, plan.asset, p.to, p.value);
    Object.freeze(payment);
    const authorization = Object.freeze({
      from: p.from,
      to: p.to,
      value: p.value,
      validAfter: p.validAfter,
      validBefore: p.validBefore,
      nonce: p.nonce,
    });
    secrets.set(payment, Object.freeze({ authorization, signature }));
    signed.add(plan as object);
    return { ok: true, payment };
  } catch {
    return no('sign-failed');
  } finally {
    key.fill(0);
    raw.fill(0);
    if (fd >= 0) {
      try {
        closeSync(fd);
      } catch {
        // Nothing more to do; the result stands.
      }
    }
  }
}
