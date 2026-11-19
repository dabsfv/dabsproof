// Shapes of key material, read from a value without keeping or showing it. The private-key, PEM and
// extended-private-key patterns are adapted from tools/scan.mjs (anchored to the whole value), so
// they are not identical to the scanner's; the mnemonic shape uses its word-count rule without the
// scanner's test-phrase exception; the xpub shape is the fix kit's own. Nothing is checked against
// the scanner automatically. A shape is only a shape: the guard says "looks like", never "is".
import type { KeyType } from '../messages.js';

const BASE58 = '[1-9A-HJ-NP-Za-km-z]';
const PRIVATE_KEY_HEX = /^(?:0x)?[0-9a-fA-F]{64}$/;
const XPRV = new RegExp(`^[xtyzuvYZUV]prv${BASE58}{100,}$`);
const XPUB = new RegExp(`^xpub${BASE58}{100,112}$`);
const PEM_PRIVATE = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/;
const MNEMONIC_COUNTS = new Set([12, 15, 18, 21, 24]);

/** The shape of a value, or null if it looks like none of them. Never returns any of the value. */
export function shapeOf(value: unknown): KeyType | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (PRIVATE_KEY_HEX.test(v)) return 'private-key';
  if (XPRV.test(v)) return 'extended-private-key';
  if (XPUB.test(v)) return 'extended-public-key';
  if (PEM_PRIVATE.test(v)) return 'pem-private-key';
  const words = v.split(' ');
  if (MNEMONIC_COUNTS.has(words.length) && words.every((w) => /^[a-z]{3,8}$/.test(w))) return 'mnemonic-like';
  return null;
}

/** Names that suggest key material (plan §5.1): MNEMONIC, PRIVATE_KEY, SEED, XPRV. */
export const KEY_NAME = /MNEMONIC|PRIVATE_?KEY|SEED|XPRV/i;

/** Every shape except an extended public key is key material. */
export const isKeyMaterial = (t: KeyType | null): boolean => t !== null && t !== 'extended-public-key';
