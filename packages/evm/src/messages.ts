// Every message the evm package can show. pnpm lint:wording checks them all. No message ever
// includes the input it refers to.
export const EVM_TEXT = Object.freeze({
  notExtendedKey: 'this is not a valid extended public key in the xpub format',
  privateKeyRefused:
    'this is a private extended key; only an account-level public key (xpub) is accepted, and the key was not kept',
  wrongDepth: "the key must be an account-level key (depth 3), such as the key for m/44'/60'/0'",
  notHardened: 'the key must come from a hardened account step',
  indexRange: 'an address index is a whole number from 0 to 2147483647',
  wrongLength: 'a public key must be 33 bytes (compressed) or 65 bytes (uncompressed)',
  notPoint: 'these bytes are not a public key on the secp256k1 curve',
  addressFormat: 'an address is 0x followed by 40 hex characters',
  networkNotAllowed: 'this network is not on the allow-list; only Base Sepolia (eip155:84532) is used',
  assetNotAllowed: 'this asset is not on the allow-list for this network',
});

export type EvmErrorCode =
  | 'not-extended-key'
  | 'private-key'
  | 'wrong-depth'
  | 'not-hardened'
  | 'index-range'
  | 'wrong-length'
  | 'not-a-point'
  | 'address-format'
  | 'network-not-allowed'
  | 'asset-not-allowed';

/** Thrown for bad input. The message comes from EVM_TEXT and never contains the input. */
export class EvmInputError extends Error {
  readonly code: EvmErrorCode;
  constructor(code: EvmErrorCode, message: string) {
    super(message);
    this.name = 'EvmInputError';
    this.code = code;
  }
}
