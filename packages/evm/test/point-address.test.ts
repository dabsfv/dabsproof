import { secp256k1 } from '@noble/curves/secp256k1.js';
import { describe, expect, it } from 'vitest';
import { decompressPublicKey, EVM_TEXT, toChecksumAddress } from '../src/index.js';

describe('decompressPublicKey', () => {
  it('turns 20 random compressed keys into the matching uncompressed keys', () => {
    for (let i = 0; i < 20; i++) {
      const secret = secp256k1.utils.randomSecretKey();
      const compressed = secp256k1.getPublicKey(secret, true);
      const uncompressed = secp256k1.getPublicKey(secret, false);
      expect(decompressPublicKey(compressed)).toEqual(uncompressed);
      expect(decompressPublicKey(uncompressed)).toEqual(uncompressed);
    }
  });
  it('refuses the wrong length', () => {
    expect(() => decompressPublicKey(new Uint8Array(32))).toThrow(EVM_TEXT.wrongLength);
    expect(() => decompressPublicKey(new Uint8Array(64))).toThrow(EVM_TEXT.wrongLength);
  });
  it('refuses bytes that are not a point on the curve', () => {
    const notOnCurve = new Uint8Array(33);
    notOnCurve[0] = 0x02;
    expect(() => decompressPublicKey(notOnCurve)).toThrow(EVM_TEXT.notPoint);
    const badPrefix = secp256k1.getPublicKey(secp256k1.utils.randomSecretKey(), true);
    badPrefix[0] = 0x05;
    expect(() => decompressPublicKey(badPrefix)).toThrow(EVM_TEXT.notPoint);
  });
});

describe('toChecksumAddress (EIP-55)', () => {
  it('gives the mixed-case form of Hardhat account 0 from any case', () => {
    const want = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
    expect(toChecksumAddress(want.toLowerCase())).toBe(want);
    expect(toChecksumAddress(`0x${want.slice(2).toUpperCase()}`)).toBe(want);
  });
  it('refuses anything that is not 0x and 40 hex characters', () => {
    for (const bad of ['', '0x', '0x123', `0x${'g'.repeat(40)}`, `${'0'.repeat(42)}`]) {
      expect(() => toChecksumAddress(bad), bad).toThrow(EVM_TEXT.addressFormat);
    }
  });
});
