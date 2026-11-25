// The EIP-712 digest for TransferWithAuthorization on the one allowed domain. The expected values
// were computed once with viem 2.58.0 (hashDomain, hashStruct and hashTypedData, the copy installed
// for the local facilitator package), from a script read from standard input and never saved. The
// domain separator is also the value the USDC contract on Base Sepolia gave for DOMAIN_SEPARATOR in
// an earlier fork read. Addresses are made-up repeats and nonces are repeating patterns: no key,
// signature or real nonce is used.
import { describe, expect, it } from 'vitest';
import { TRANSFER_DOMAIN, TRANSFER_DOMAIN_SEPARATOR, type TransferInput, transferDigest } from '../src/typed-data.js';

const MAX = ((1n << 256n) - 1n).toString();
const VECTORS: { name: string; input: TransferInput; structHash: string; digest: string }[] = [
  {
    name: 'normal',
    input: {
      from: `0x${'1'.repeat(40)}`,
      to: `0x${'2'.repeat(40)}`,
      value: '1000',
      validAfter: '1700000000',
      validBefore: '1700000300',
      nonce: `0x${'0123456789abcdef'.repeat(4)}`,
    },
    structHash: '0xe4bcefc08ba14e72a7af5f44b7c4ca7cf5803c786c9b77e699f5a0049a0a5b6c',
    digest: '0x33361166137ff0a305e10e34b6eedc834caae4c7498400561a3627600c9e0b20',
  },
  {
    name: 'zero validAfter',
    input: {
      from: `0x${'1'.repeat(40)}`,
      to: `0x${'2'.repeat(40)}`,
      value: '2000',
      validAfter: '0',
      validBefore: '1764000300',
      nonce: `0x${'a5'.repeat(32)}`,
    },
    structHash: '0xb937a8c2a96984fabbdebada4161aec0a6087c1ca9b2bc3e2b0edfdd4755de36',
    digest: '0xf1f4e8cb9369a48efe617b7fdfedec85133a8cc970b1bcb9f40dab457fd91080',
  },
  {
    name: 'maximum uint256 value and validBefore',
    input: {
      from: `0x${'3'.repeat(40)}`,
      to: `0x${'4'.repeat(40)}`,
      value: MAX,
      validAfter: '0',
      validBefore: MAX,
      nonce: `0x${'f0'.repeat(32)}`,
    },
    structHash: '0xaa477bbe43a153f1b9e258b91842f8ccb9f6740ad43fa8ad753cdd9ce832d40a',
    digest: '0x5f8669a48d6dd91b2fe0702d641a36566cf5cbcce1cd2c3fa9f536f7abc90fa0',
  },
];
const base = VECTORS[0]?.input as TransferInput;

describe('typed data: the one domain', () => {
  it('is USDC version 2 on chain 84532 at the allowed USDC address', () => {
    expect(TRANSFER_DOMAIN).toEqual({
      name: 'USDC',
      version: '2',
      chainId: 84532n,
      verifyingContract: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    });
    expect(Object.isFrozen(TRANSFER_DOMAIN)).toBe(true);
  });
  it('has the domain separator viem computes, which the token also reports', () => {
    // The public DOMAIN_SEPARATOR the USDC contract on Base Sepolia returned in the earlier fork read.
    const EXPECTED_SEPARATOR_HASH = '0x71f17a3b2ff373b803d70a5a07c046c1a2bc8e89c09ef722fcb047abe94c9818';
    expect(TRANSFER_DOMAIN_SEPARATOR).toBe(EXPECTED_SEPARATOR_HASH);
  });
});

describe('typed data: fixed vectors from viem', () => {
  for (const v of VECTORS) {
    it(`${v.name}: struct hash and digest match`, () => {
      const r = transferDigest(v.input);
      if (!r.ok) throw new Error(r.reason);
      expect(r.structHashHex).toBe(v.structHash);
      expect(r.digestHex).toBe(v.digest);
      expect(r.digest).toBeInstanceOf(Uint8Array);
      expect(r.digest.length).toBe(32);
      expect(`0x${Buffer.from(r.digest).toString('hex')}`).toBe(v.digest);
    });
  }
  it('gives the same digest on two calls, and address case does not change it', () => {
    const a = transferDigest(base);
    const b = transferDigest(base);
    const upper = transferDigest({ ...base, from: `0x${'A'.repeat(40)}`, to: `0x${'B'.repeat(40)}` });
    const lower = transferDigest({ ...base, from: `0x${'a'.repeat(40)}`, to: `0x${'b'.repeat(40)}` });
    expect(a.ok && b.ok && a.digestHex === b.digestHex).toBe(true);
    expect(upper.ok && lower.ok && upper.digestHex === lower.digestHex).toBe(true);
  });
  it('a change to any one field changes the digest', () => {
    const first = transferDigest(base);
    if (!first.ok) throw new Error(first.reason);
    const changes: Partial<TransferInput>[] = [
      { from: `0x${'5'.repeat(40)}` },
      { to: `0x${'6'.repeat(40)}` },
      { value: '1001' },
      { validAfter: '1700000001' },
      { validBefore: '1700000301' },
      { nonce: `0x${'0123456789abcdef'.repeat(3)}0123456789abcdee` },
    ];
    const seen = new Set([first.digestHex]);
    for (const c of changes) {
      const r = transferDigest({ ...base, ...c });
      if (!r.ok) throw new Error(r.reason);
      expect(seen.has(r.digestHex)).toBe(false);
      seen.add(r.digestHex);
    }
    expect(seen.size).toBe(changes.length + 1);
  });
});

describe('typed data: refusals give a fixed code and no digest', () => {
  const MARK = 'zz-input-marker-zz';
  const badAddresses: unknown[] = [
    undefined,
    null,
    42,
    '',
    `0x${'1'.repeat(39)}`,
    `0x${'1'.repeat(41)}`,
    `0x${'g'.repeat(40)}`,
    '1'.repeat(42),
    MARK,
  ];
  const badUints: unknown[] = [
    undefined,
    null,
    1000,
    1000n,
    '',
    '-1',
    '+1',
    '1.5',
    '1e3',
    '0x10',
    ' 1',
    '01',
    '1'.repeat(79),
    (1n << 256n).toString(),
    MARK,
  ];
  const badNonces: unknown[] = [
    undefined,
    null,
    '',
    `0x${'a5'.repeat(31)}`,
    `0x${'a5'.repeat(33)}`,
    `0x${'g5'.repeat(32)}`,
    'a5'.repeat(32),
    MARK,
  ];

  it('invalid-address for from or to', () => {
    for (const bad of badAddresses) {
      expect(transferDigest({ ...base, from: bad })).toEqual({ ok: false, reason: 'invalid-address' });
      expect(transferDigest({ ...base, to: bad })).toEqual({ ok: false, reason: 'invalid-address' });
    }
  });
  it('invalid-uint for value, validAfter or validBefore', () => {
    for (const bad of badUints) {
      for (const field of ['value', 'validAfter', 'validBefore'] as const) {
        expect(transferDigest({ ...base, [field]: bad })).toEqual({ ok: false, reason: 'invalid-uint' });
      }
    }
  });
  it('invalid-nonce for a nonce that is not 0x and 64 hex characters', () => {
    for (const bad of badNonces) {
      expect(transferDigest({ ...base, nonce: bad })).toEqual({ ok: false, reason: 'invalid-nonce' });
    }
  });
  it('a missing or empty input is refused without throwing', () => {
    expect(transferDigest(undefined as unknown as TransferInput)).toEqual({ ok: false, reason: 'invalid-address' });
    expect(transferDigest({} as TransferInput)).toEqual({ ok: false, reason: 'invalid-address' });
  });
  it('no refusal throws, and no result holds the input text', () => {
    for (const field of ['from', 'to', 'value', 'validAfter', 'validBefore', 'nonce'] as const) {
      let r: unknown;
      expect(() => {
        r = transferDigest({ ...base, [field]: MARK });
      }).not.toThrow();
      expect(JSON.stringify(r).includes(MARK)).toBe(false);
    }
  });
});
