// Networks and assets the live checks may use. Base Sepolia only. The USDC address and decimals
// were checked against the default asset that @x402/evm 2.31.0 defines for eip155:84532.
import { EvmInputError, EVM_TEXT as T } from './messages.js';

export const BASE_SEPOLIA = 'eip155:84532';

export interface AllowedAsset {
  readonly symbol: string;
  readonly address: string;
  readonly decimals: number;
}

export const ALLOWED_NETWORKS: Readonly<
  Record<string, { readonly name: string; readonly assets: readonly AllowedAsset[] }>
> = Object.freeze({
  [BASE_SEPOLIA]: Object.freeze({
    name: 'Base Sepolia',
    assets: Object.freeze([
      Object.freeze({ symbol: 'USDC', address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', decimals: 6 }),
    ]),
  }),
});

export const isAllowedNetwork = (network: string): boolean => Object.hasOwn(ALLOWED_NETWORKS, network);

export function allowedAsset(network: string, address: string): AllowedAsset {
  const n = Object.hasOwn(ALLOWED_NETWORKS, network) ? ALLOWED_NETWORKS[network] : undefined;
  if (!n) throw new EvmInputError('network-not-allowed', T.networkNotAllowed);
  const a =
    typeof address === 'string' ? n.assets.find((x) => x.address.toLowerCase() === address.toLowerCase()) : undefined;
  if (!a) throw new EvmInputError('asset-not-allowed', T.assetNotAllowed);
  return a;
}

/** Decimals for an allowed asset, for core's dollarsToUnits(). There is no second price converter. */
export const decimalsFor = (network: string, address: string): number => allowedAsset(network, address).decimals;
