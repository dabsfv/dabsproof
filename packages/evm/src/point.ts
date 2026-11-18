// The one place that touches the curve library's point type. @noble/curves 2.x calls it
// Point (1.x called it ProjectivePoint); keeping it here limits any future rename to this file.
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { EvmInputError, EVM_TEXT as T } from './messages.js';

/** A 33-byte compressed or 65-byte uncompressed public key, returned as 65 bytes uncompressed. */
export function decompressPublicKey(key: Uint8Array): Uint8Array {
  if (key.length !== 33 && key.length !== 65) throw new EvmInputError('wrong-length', T.wrongLength);
  try {
    return secp256k1.Point.fromBytes(key).toBytes(false);
  } catch {
    throw new EvmInputError('not-a-point', T.notPoint);
  }
}
