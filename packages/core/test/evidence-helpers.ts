// Fakes for the evidence and canary tests. Every value is built at run time from random bytes,
// so no test file or snapshot holds a key-, signature- or hash-shaped string.
import { randomBytes } from 'node:crypto';
import { inspect } from 'node:util';
import { shortAddress } from '../src/index.js';

export const hex = (bytes: number): string => randomBytes(bytes).toString('hex');
export const address = (): string => `0x${hex(20)}`;
export const txHash = (): string => `0x${hex(32)}`;
export const b64 = (value: unknown): string => Buffer.from(JSON.stringify(value), 'utf8').toString('base64');

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const word = (): string =>
  Array.from(randomBytes(6), (b) => LETTERS[b % 26])
    .join('')
    .slice(0, 3 + ((randomBytes(1)[0] ?? 0) % 4));
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** One set of planted fakes. None of them may ever appear in any output. */
export function makeCanaries() {
  return {
    privateKey: hex(32),
    privateKey0x: `0x${hex(32)}`,
    signature: `0x${hex(65)}`,
    nonce: `0x${hex(32)}`,
    xprv: ['x', 'p', 'r', 'v'].join('') + Array.from(randomBytes(107), (b) => BASE58[b % 58]).join(''),
    mnemonic: Array.from({ length: 12 }, word).join(' '),
    apiToken: `tok_${hex(20)}`,
    payer: address(),
    queryValue: `qv${hex(12)}`,
    bodySecret: `body${hex(16)}`,
    cookie: `sid=${hex(16)}`,
    basicPassword: `pw${hex(10)}`,
    fragment: `frag${hex(10)}`,
  };
}
export type Canaries = ReturnType<typeof makeCanaries>;

export interface PaymentFields {
  from: string;
  to: string;
  nonce: string;
  signature: string;
  validBefore?: string;
  validAfter?: string;
  amount?: string;
  network?: string;
  asset?: string;
  scheme?: string;
  url?: string;
}

/** A version 2 PAYMENT-SIGNATURE value in the EIP-3009 exact shape (read R1). */
export function paymentHeader(f: PaymentFields, extra: Record<string, unknown> = {}): string {
  return b64({
    x402Version: 2,
    resource: { url: f.url ?? 'https://seller.test/api/report', description: 'a report', mimeType: 'application/json' },
    accepted: {
      scheme: f.scheme ?? 'exact',
      network: f.network ?? 'eip155:84532',
      asset: f.asset ?? '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      amount: f.amount ?? '10000',
      payTo: f.to,
      maxTimeoutSeconds: 60,
      extra: { name: 'USDC', version: '2' },
    },
    payload: {
      signature: f.signature,
      authorization: {
        from: f.from,
        to: f.to,
        value: f.amount ?? '10000',
        validAfter: f.validAfter ?? '1763400000',
        validBefore: f.validBefore ?? '1763400600',
        nonce: f.nonce,
      },
    },
    ...extra,
  });
}

/** A Permit2 exact payload (read R1): no validBefore, a decimal nonce. */
export function permit2Header(from: string, to: string, signature: string, nonce: string): string {
  return b64({
    x402Version: 2,
    accepted: { scheme: 'exact', network: 'eip155:84532', asset: address(), amount: '10000', payTo: to },
    payload: {
      signature,
      permit2Authorization: {
        permitted: { token: address(), amount: '10000' },
        spender: address(),
        nonce,
        deadline: '1763400600',
        witness: { to, validAfter: '1763400000' },
        from,
      },
    },
  });
}

/**
 * True if the text shows the value in any form the canary suite looks for: as is, in any letter
 * case, any 8 characters in a row, or the hex or base64 form of the whole value. This is written
 * separately from the code under test, so the suite does not use that code as its own judge.
 */
export function shows(text: string, value: string): boolean {
  const lower = text.toLowerCase();
  const plain = (/^0x/i.test(value) ? value.slice(2) : value).toLowerCase();
  for (let i = 0; i + 8 <= plain.length; i++) if (lower.includes(plain.slice(i, i + 8))) return true;
  const bytes = Buffer.from(value, 'utf8');
  for (const f of [bytes.toString('hex'), bytes.toString('base64'), bytes.toString('base64url')]) {
    if (lower.includes(f.toLowerCase())) return true;
  }
  return false;
}

/** Every printed form of a value: JSON, util.inspect (deep and with hidden fields) and String. */
export function printedForms(value: unknown): string[] {
  const out: string[] = [];
  try {
    out.push(String(JSON.stringify(value)));
  } catch {
    out.push('');
  }
  out.push(inspect(value, { depth: null, showHidden: true, getters: true }));
  out.push(String(value));
  if (value instanceof Error) out.push(value.message, String(value.stack), inspect(value.cause, { depth: null }));
  return out;
}

/** Fails with the canary's name only, never its value. */
export function expectNoCanary(texts: string[], canaries: Record<string, string>): void {
  const joined = texts.join('\n');
  const found = Object.entries(canaries)
    .filter(([, v]) => shows(joined, v))
    .map(([k]) => k);
  if (found.length) throw new Error(`canary shown: ${found.join(', ')}`);
}

/** The payer must not appear in full or in the short form reports use. */
export function expectNoPayer(texts: string[], payer: string): void {
  const joined = texts.join('\n');
  if (shows(joined, payer) || joined.includes(shortAddress(payer))) throw new Error('payer shown');
}
