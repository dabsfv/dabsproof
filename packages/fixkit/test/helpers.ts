// Test helpers. Every key-shaped value is built at run time; no test file holds one. The test
// xpub comes from evm's helper, which derives it from the public Hardhat test mnemonic.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { inspect } from 'node:util';
import { ALLOWED_NETWORKS, BASE_SEPOLIA } from '@dabsproof/evm';
import { testRoot } from '../../evm/test/helpers.js';

export const fixturePath = (name: string): string =>
  new URL(`../../../fixtures/manifests/${name}.json`, import.meta.url).pathname;

export const readFixture = (name: string): { routes: Record<string, unknown>[] } & Record<string, unknown> =>
  JSON.parse(readFileSync(fixturePath(name), 'utf8'));

const USDC = ALLOWED_NETWORKS[BASE_SEPOLIA]?.assets[0]?.address ?? '';

/** A fixture with every route's asset set to the allow-listed Base Sepolia USDC (fixtures use fake assets). */
export function allowListed(name: string, change: (routes: Record<string, unknown>[]) => void = () => {}) {
  const m = readFixture(name);
  change(m.routes);
  for (const r of m.routes) r.asset = USDC;
  return m;
}

const account = testRoot().derive("m/44'/60'/0'");
/** The account-level xpub of the public test mnemonic. */
export const TEST_XPUB = account.publicExtendedKey;
/** Its private counterpart, only to prove it is refused. Never printed. */
export const TEST_XPRV = account.privateExtendedKey;
/** An xpub at the wrong depth. */
export const WRONG_DEPTH_XPUB = testRoot().derive("m/44'/60'").publicExtendedKey;

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const word = (): string =>
  Array.from(randomBytes(5), (b) => LETTERS[b % 26])
    .join('')
    .slice(0, 3 + ((randomBytes(1)[0] ?? 0) % 3));

/** Planted fakes, one of each shape. None may appear in any output. */
export function makeCanaries() {
  const pemBody = randomBytes(48).toString('base64');
  return {
    privateKey: randomBytes(32).toString('hex'),
    privateKey0x: `0x${randomBytes(32).toString('hex')}`,
    xprv: ['x', 'p', 'r', 'v'].join('') + Array.from(randomBytes(107), (b) => BASE58[b % 58]).join(''),
    mnemonic: Array.from({ length: 12 }, word).join(' '),
    pem: `${['-----BEGIN', 'PRIVATE KEY-----'].join(' ')}\n${pemBody}\n${['-----END', 'PRIVATE KEY-----'].join(' ')}`,
    pemBody,
    token: `tok_${randomBytes(16).toString('hex')}`,
  };
}

/** True if the text shows the value: as is, in any letter case, or any 8 characters in a row. */
export function shows(text: string, value: string): boolean {
  const lower = text.toLowerCase();
  const plain = value.toLowerCase().replace(/^0x/, '');
  for (let i = 0; i + 8 <= plain.length; i++) if (lower.includes(plain.slice(i, i + 8))) return true;
  return false;
}

export function printed(value: unknown): string {
  let json = '';
  try {
    json = String(JSON.stringify(value));
  } catch {
    json = '';
  }
  const parts = [json, inspect(value, { depth: null, showHidden: true, getters: true }), String(value)];
  if (value instanceof Error) parts.push(value.message, String(value.stack), inspect(value.cause));
  return parts.join('\n');
}

/**
 * The secret parts of the canaries. A PEM key's header and footer are public boilerplate (and
 * share words with the approved label "PEM private key"), so only its body is a secret.
 */
export function secretsOf(c: ReturnType<typeof makeCanaries>): Record<string, string> {
  const { pem: _pem, ...rest } = c;
  return rest;
}

/** Fails with the names of the values shown, never the values. */
export function expectNotShown(texts: string[], values: Record<string, string>): void {
  const all = texts.join('\n');
  const found = Object.entries(values)
    .filter(([, v]) => shows(all, v))
    .map(([k]) => k);
  if (found.length) throw new Error(`shown: ${found.join(', ')}`);
}
