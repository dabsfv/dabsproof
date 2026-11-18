// Static analysis may read mainnet manifests; live runs stay on Base Sepolia only.
import { ALLOWED_NETWORKS, BASE_SEPOLIA as EVM_BASE_SEPOLIA, isAllowedNetwork } from '@dabsproof/evm';
import { BASE_SEPOLIA, checks, getCheck } from '@dabsproof/registry';
import { describe, expect, it } from 'vitest';
import { staticNetworkFilter } from '../src/index.js';

const full = checks.filter((c) => c.status === 'active' || c.status === 'experimental');

describe('live fields stay Base Sepolia only', () => {
  it('every check lists only Base Sepolia in appliesTo.networks, the field live runs read', () => {
    for (const c of full) {
      if (c.status !== 'active' && c.status !== 'experimental') continue;
      expect(c.appliesTo.networks, c.id).toEqual([BASE_SEPOLIA]);
    }
  });
  it("evm's allow-list holds Base Sepolia only and refuses Base mainnet", () => {
    expect(Object.keys(ALLOWED_NETWORKS)).toEqual([EVM_BASE_SEPOLIA]);
    expect(isAllowedNetwork('eip155:8453')).toBe(false);
  });
});

describe('static analysis reads any EVM network', () => {
  it('X402-03 sets staticNetworks to any-evm, and only X402-03 sets it', () => {
    for (const c of full) {
      if (c.status !== 'active' && c.status !== 'experimental') continue;
      expect(c.appliesTo.staticNetworks, c.id).toBe(c.id === 'X402-03' ? 'any-evm' : undefined);
    }
    expect(getCheck('X402-03')?.status).toBe('experimental');
  });
  it('the static filter accepts Base mainnet and Ethereum mainnet, and refuses non-EVM networks', () => {
    const reads = staticNetworkFilter();
    expect(reads('eip155:84532')).toBe(true);
    expect(reads('eip155:8453')).toBe(true);
    expect(reads('eip155:1')).toBe(true);
    expect(reads('solana:mainnet')).toBe(false);
  });
});
