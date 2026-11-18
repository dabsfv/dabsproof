// Ethereum addresses from public keys, and the EIP-55 mixed-case checksum. No viem.
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { EvmInputError, EVM_TEXT as T } from './messages.js';
import { decompressPublicKey } from './point.js';

export const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** EIP-55: a hex digit of the address is upper case when the matching hash digit is 8 or more. */
export function toChecksumAddress(address: string): string {
  if (typeof address !== 'string' || !ADDRESS.test(address)) throw new EvmInputError('address-format', T.addressFormat);
  const lower = address.slice(2).toLowerCase();
  const hash = bytesToHex(keccak_256(utf8ToBytes(lower)));
  let out = '0x';
  for (let i = 0; i < lower.length; i++) {
    const c = lower[i] as string;
    out += Number.parseInt(hash[i] as string, 16) >= 8 ? c.toUpperCase() : c;
  }
  return out;
}

/** The address is the last 20 bytes of keccak-256 over the uncompressed key without its 0x04 prefix. */
export function publicKeyToAddress(publicKey: Uint8Array): string {
  const full = decompressPublicKey(publicKey);
  const hash = keccak_256(full.subarray(1));
  return toChecksumAddress(`0x${bytesToHex(hash.subarray(12))}`);
}
