// Test helpers. The public Hardhat test mnemonic is built at run time so it never appears as a
// literal in a tracked file; every key derived from it here is a public test key.
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';

export const TEST_MNEMONIC = [...Array(11).fill('test'), 'junk'].join(' ');
export const testRoot = (): HDKey => HDKey.fromMasterSeed(mnemonicToSeedSync(TEST_MNEMONIC));

/** True if the message contains any 6 characters in a row from the input. */
export function echoes(message: string, input: string): boolean {
  for (let i = 0; i + 6 <= input.length; i++) if (message.includes(input.slice(i, i + 6))) return true;
  return false;
}
