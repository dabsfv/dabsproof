import { HARDENED_OFFSET, HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import { describe, expect, it } from 'vitest';
import { deriveAddress, EVM_TEXT, EvmInputError, parseAccountXpub, publicKeyToAddress } from '../src/index.js';
import { echoes, TEST_MNEMONIC, testRoot } from './helpers.js';

// Hardhat's well-known default accounts m/44'/60'/0'/0/0 to /2 of the public test mnemonic.
const HARDHAT = [
  '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
];

const root = testRoot();
const accountPrivate = root.derive("m/44'/60'/0'");
const xpub = accountPrivate.publicExtendedKey;

describe('deriveAddress: vectors from the public test mnemonic', () => {
  it('the account xpub derives Hardhat accounts 0, 1 and 2, checksummed', () => {
    const account = parseAccountXpub(xpub);
    expect([0, 1, 2].map((i) => deriveAddress(account, i))).toEqual(HARDHAT);
  });
  it('matches the same path derived privately, for indexes 0 to 9 and a high index', () => {
    const account = parseAccountXpub(xpub);
    for (const i of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 1000, 2 ** 31 - 1]) {
      const viaPrivate = root.derive(`m/44'/60'/0'/0/${i}`).publicKey;
      if (!viaPrivate) throw new Error('no public key');
      expect(deriveAddress(account, i)).toBe(publicKeyToAddress(viaPrivate));
    }
  });
});

describe('parseAccountXpub refuses, without repeating the input', () => {
  const refuses = (input: string, message: string) => {
    let err: unknown;
    try {
      parseAccountXpub(input);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(EvmInputError);
    expect((err as Error).message).toBe(message);
    expect(echoes((err as Error).message, input)).toBe(false);
  };

  it('a private extended key (generated at run time from the test mnemonic)', () => {
    refuses(accountPrivate.privateExtendedKey, EVM_TEXT.privateKeyRefused);
  });
  it('a key that is not at account level (depth 0, 4 and 5)', () => {
    refuses(root.publicExtendedKey, EVM_TEXT.wrongDepth);
    refuses(accountPrivate.deriveChild(0).publicExtendedKey, EVM_TEXT.wrongDepth);
    refuses(accountPrivate.deriveChild(0).deriveChild(0).publicExtendedKey, EVM_TEXT.wrongDepth);
  });
  it('an account-level key whose last step is not hardened', () => {
    const notHardened = root.derive("m/44'/60'/0").publicExtendedKey;
    expect(HDKey.fromExtendedKey(notHardened).index).toBeLessThan(HARDENED_OFFSET);
    refuses(notHardened, EVM_TEXT.notHardened);
  });
  it('a tpub (testnet version bytes)', () => {
    const testnet = { private: 0x04358394, public: 0x043587cf };
    const tpub = HDKey.fromMasterSeed(mnemonicToSeedSync(TEST_MNEMONIC), testnet).derive(
      "m/44'/60'/0'",
    ).publicExtendedKey;
    expect(tpub.startsWith('tpub')).toBe(true);
    refuses(tpub, EVM_TEXT.notExtendedKey);
  });
  it('a broken checksum, random text and an empty string', () => {
    const last = xpub.at(-1) === 'A' ? 'B' : 'A';
    refuses(`${xpub.slice(0, -1)}${last}`, EVM_TEXT.notExtendedKey);
    refuses('zq-not-a-key-at-all', EVM_TEXT.notExtendedKey);
    refuses('', EVM_TEXT.notExtendedKey);
  });
  it('a value that is not text', () => {
    expect(() => parseAccountXpub(42 as unknown as string)).toThrow(EVM_TEXT.notExtendedKey);
  });
});

describe('deriveAddress refuses an index out of range', () => {
  const account = parseAccountXpub(xpub);
  for (const bad of [-1, 1.5, 2 ** 31, Number.NaN, Number.POSITIVE_INFINITY]) {
    it(String(bad), () => {
      expect(() => deriveAddress(account, bad)).toThrow(EVM_TEXT.indexRange);
    });
  }
});
