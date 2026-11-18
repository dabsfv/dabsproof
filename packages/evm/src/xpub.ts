// Account-level extended public keys (xpub) and public derivation of payment addresses.
// Only public keys are handled: a private extended key is refused and wiped, and no error
// message ever repeats the input.
import { HARDENED_OFFSET, HDKey } from '@scure/bip32';
import { publicKeyToAddress } from './address.js';
import { EvmInputError, EVM_TEXT as T } from './messages.js';

/** An account-level key at depth 3 (for example m/44'/60'/0'), public only. */
export interface AccountKey {
  readonly depth: 3;
  readonly key: HDKey;
}

export function parseAccountXpub(text: string): AccountKey {
  if (typeof text !== 'string') throw new EvmInputError('not-extended-key', T.notExtendedKey);
  let key: HDKey;
  try {
    // Default versions: only the standard xpub (and xprv) prefixes decode; tpub and others fail here.
    key = HDKey.fromExtendedKey(text.trim());
  } catch {
    throw new EvmInputError('not-extended-key', T.notExtendedKey);
  }
  if (key.privateKey) {
    key.wipePrivateData();
    throw new EvmInputError('private-key', T.privateKeyRefused);
  }
  if (key.depth !== 3) throw new EvmInputError('wrong-depth', T.wrongDepth);
  if (key.index < HARDENED_OFFSET) throw new EvmInputError('not-hardened', T.notHardened);
  return Object.freeze({ depth: 3, key });
}

/**
 * The address at <account>/0/<index>: the same path the demo's hd-payto code uses
 * (account.deriveChild(0).deriveChild(index)). Public derivation only.
 */
export function deriveAddress(account: AccountKey, index: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= HARDENED_OFFSET) {
    throw new EvmInputError('index-range', T.indexRange);
  }
  const child = account.key.deriveChild(0).deriveChild(index);
  if (!child.publicKey) throw new EvmInputError('not-extended-key', T.notExtendedKey);
  return publicKeyToAddress(child.publicKey);
}
