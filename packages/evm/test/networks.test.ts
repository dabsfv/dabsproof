import { describe, expect, it } from 'vitest';
import { ALLOWED_NETWORKS, allowedAsset, BASE_SEPOLIA, decimalsFor, EVM_TEXT, isAllowedNetwork } from '../src/index.js';

const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

describe('network and asset allow-list', () => {
  it('holds Base Sepolia only', () => {
    expect(Object.keys(ALLOWED_NETWORKS)).toEqual([BASE_SEPOLIA]);
    expect(isAllowedNetwork(BASE_SEPOLIA)).toBe(true);
    for (const n of ['eip155:8453', 'eip155:1', 'solana:mainnet', '', '__proto__', 'constructor']) {
      expect(isAllowedNetwork(n), n).toBe(false);
    }
  });
  it('gives USDC on Base Sepolia 6 decimals, matching any letter case of the address', () => {
    expect(decimalsFor(BASE_SEPOLIA, USDC)).toBe(6);
    expect(decimalsFor(BASE_SEPOLIA, USDC.toLowerCase())).toBe(6);
    expect(allowedAsset(BASE_SEPOLIA, USDC).symbol).toBe('USDC');
  });
  it('refuses another network or an unknown asset', () => {
    expect(() => decimalsFor('eip155:8453', USDC)).toThrow(EVM_TEXT.networkNotAllowed);
    expect(() => decimalsFor('constructor', USDC)).toThrow(EVM_TEXT.networkNotAllowed);
    expect(() => decimalsFor(BASE_SEPOLIA, `0x${'0'.repeat(39)}1`)).toThrow(EVM_TEXT.assetNotAllowed);
  });
  it('cannot be changed at run time', () => {
    expect(Object.isFrozen(ALLOWED_NETWORKS)).toBe(true);
    expect(Object.isFrozen(ALLOWED_NETWORKS[BASE_SEPOLIA]?.assets)).toBe(true);
  });
});
