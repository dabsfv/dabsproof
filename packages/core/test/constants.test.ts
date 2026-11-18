// evm and registry each define BASE_SEPOLIA (neither depends on the other). This test stops the
// two copies drifting apart silently.
import { BASE_SEPOLIA as EVM_BASE_SEPOLIA } from '@dabsproof/evm';
import { BASE_SEPOLIA as REGISTRY_BASE_SEPOLIA } from '@dabsproof/registry';
import { describe, expect, it } from 'vitest';

describe('shared constants', () => {
  it("evm's BASE_SEPOLIA equals registry's BASE_SEPOLIA", () => {
    expect(EVM_BASE_SEPOLIA).toBe(REGISTRY_BASE_SEPOLIA);
    expect(EVM_BASE_SEPOLIA).toBe('eip155:84532');
  });
});
