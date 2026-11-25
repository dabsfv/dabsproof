// The EIP-712 digest for exactly one shape, EIP-3009 TransferWithAuthorization, on exactly one
// domain: USDC version 2 on Base Sepolia (eip155:84532). Pure functions: nothing here starts a
// process, opens a file or a socket, sends a request, reads the environment or prints anything, and
// no key is used. The digest is keccak256(0x1901 || domainSeparator || structHash), from
// @noble/hashes only. Every input is checked first; a bad one gives a fixed reason code and no
// digest, and no error is thrown with any input text in it. This file only computes a digest: it
// does not decide whether a payment should be made, and nothing in the runner uses it yet.
import { ALLOWED_NETWORKS, BASE_SEPOLIA as EVM_BASE_SEPOLIA } from '@dabsproof/evm';
import { BASE_SEPOLIA } from '@dabsproof/registry';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

/** The token's EIP-712 name and version, as the token itself and @x402/evm 2.31.0 give them. */
const DOMAIN_NAME = 'USDC';
const DOMAIN_VERSION = '2';
/** 84532, taken from the registry's Base Sepolia network name, not written again. */
const DOMAIN_CHAIN_ID = BigInt(BASE_SEPOLIA.split(':')[1] ?? '0');
/** The one allowed USDC address on Base Sepolia, taken from the evm package's allowed asset. */
const DOMAIN_CONTRACT = ALLOWED_NETWORKS[EVM_BASE_SEPOLIA]?.assets.find((a) => a.symbol === 'USDC')?.address ?? '';
// A fixed message with no input in it: the domain cannot be built without both values.
if (DOMAIN_CHAIN_ID <= 0n || !/^0x[0-9a-fA-F]{40}$/.test(DOMAIN_CONTRACT)) {
  throw new Error('typed-data-domain-not-found');
}

export const TRANSFER_DOMAIN = Object.freeze({
  name: DOMAIN_NAME,
  version: DOMAIN_VERSION,
  chainId: DOMAIN_CHAIN_ID,
  verifyingContract: DOMAIN_CONTRACT,
});

const DOMAIN_TYPE = 'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)';
const TRANSFER_TYPE =
  'TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)';

export type TypedDataReason = 'invalid-address' | 'invalid-uint' | 'invalid-nonce';

export interface TransferInput {
  from: unknown;
  to: unknown;
  /** Decimal strings: digits only, no leading zero (except "0"), at most 78 digits, within uint256. */
  value: unknown;
  validAfter: unknown;
  validBefore: unknown;
  /** 0x followed by 64 hex characters. */
  nonce: unknown;
}

export type TransferDigest =
  | { ok: true; digest: Uint8Array; digestHex: string; structHashHex: string }
  | { ok: false; reason: TypedDataReason };

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const NONCE = /^0x[0-9a-fA-F]{64}$/;
const DECIMAL = /^(?:0|[1-9][0-9]{0,77})$/;
const UINT256_MAX = (1n << 256n) - 1n;

const hex = (bytes: Uint8Array): string => `0x${bytesToHex(bytes)}`;
const word = (n: bigint): Uint8Array => hexToBytes(n.toString(16).padStart(64, '0'));
const addressWord = (address: string): Uint8Array => hexToBytes(address.slice(2).toLowerCase().padStart(64, '0'));

/** A decimal string within uint256, or null. */
function uint(value: unknown): bigint | null {
  if (typeof value !== 'string' || DECIMAL.exec(value) === null) return null;
  const n = BigInt(value);
  return n <= UINT256_MAX ? n : null;
}

const DOMAIN_SEPARATOR = keccak_256(
  concatBytes(
    keccak_256(utf8ToBytes(DOMAIN_TYPE)),
    keccak_256(utf8ToBytes(DOMAIN_NAME)),
    keccak_256(utf8ToBytes(DOMAIN_VERSION)),
    word(DOMAIN_CHAIN_ID),
    addressWord(DOMAIN_CONTRACT),
  ),
);
/** The domain separator of the one allowed domain, as 0x hex. */
export const TRANSFER_DOMAIN_SEPARATOR = hex(DOMAIN_SEPARATOR);
const TRANSFER_TYPE_HASH = keccak_256(utf8ToBytes(TRANSFER_TYPE));

/** Checks every field, then returns the EIP-712 digest and struct hash, or one fixed reason code. */
export function transferDigest(input: TransferInput): TransferDigest {
  const { from, to, nonce } = input ?? ({} as TransferInput);
  if (typeof from !== 'string' || ADDRESS.exec(from) === null) return { ok: false, reason: 'invalid-address' };
  if (typeof to !== 'string' || ADDRESS.exec(to) === null) return { ok: false, reason: 'invalid-address' };
  const value = uint(input?.value);
  const validAfter = uint(input?.validAfter);
  const validBefore = uint(input?.validBefore);
  if (value === null || validAfter === null || validBefore === null) return { ok: false, reason: 'invalid-uint' };
  if (typeof nonce !== 'string' || NONCE.exec(nonce) === null) return { ok: false, reason: 'invalid-nonce' };
  const structHash = keccak_256(
    concatBytes(
      TRANSFER_TYPE_HASH,
      addressWord(from),
      addressWord(to),
      word(value),
      word(validAfter),
      word(validBefore),
      hexToBytes(nonce.slice(2)),
    ),
  );
  const digest = keccak_256(concatBytes(new Uint8Array([0x19, 0x01]), DOMAIN_SEPARATOR, structHash));
  return { ok: true, digest, digestHex: hex(digest), structHashHex: hex(structHash) };
}
