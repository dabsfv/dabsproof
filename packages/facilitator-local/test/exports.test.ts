// Checks only that the export names the local facilitator plans to use exist in the pinned packages:
// the x402 EVM scheme package (@x402/evm 2.31.0) and viem 2.58.0. Import only: nothing is called,
// started or sent, and no key is used. That a name exists says nothing about how it behaves, and
// nothing here says how any real facilitator behaves.
import { toFacilitatorEvmSigner } from '@x402/evm';
import { ExactEvmScheme, registerExactEvmScheme } from '@x402/evm/exact/facilitator';
import { UptoEvmScheme } from '@x402/evm/upto/facilitator';
import { createPublicClient, createWalletClient, http } from 'viem';
import { describe, expect, it } from 'vitest';

describe('the pinned packages export the names the local facilitator plans to use', () => {
  it('@x402/evm: ExactEvmScheme, registerExactEvmScheme, UptoEvmScheme and toFacilitatorEvmSigner', () => {
    expect(typeof ExactEvmScheme).toBe('function');
    expect(typeof registerExactEvmScheme).toBe('function');
    expect(typeof UptoEvmScheme).toBe('function');
    expect(typeof toFacilitatorEvmSigner).toBe('function');
  });
  it('viem: createPublicClient, createWalletClient and http', () => {
    expect(typeof createPublicClient).toBe('function');
    expect(typeof createWalletClient).toBe('function');
    expect(typeof http).toBe('function');
  });
});
