// Check definitions (data). Every entry is checked against the schema when this module loads.
import { x402_01 } from './checks/x402-01.js';
import { x402_02 } from './checks/x402-02.js';
import { x402_03 } from './checks/x402-03.js';
import { x402_03_upstream_binding } from './checks/x402-03-upstream-binding.js';
import { x402_04 } from './checks/x402-04.js';
import { x402_05 } from './checks/x402-05.js';
import { x402_06 } from './checks/x402-06.js';
import { x402_07 } from './checks/x402-07.js';
import { x402_08 } from './checks/x402-08.js';
import { type RegistryEntry, RegistryEntrySchema } from './schema.js';

export * from './schema.js';
export * from './shared.js';

export const checks: readonly RegistryEntry[] = Object.freeze(
  [x402_01, x402_02, x402_03, x402_04, x402_05, x402_06, x402_07, x402_08, x402_03_upstream_binding].map((e) =>
    Object.freeze(RegistryEntrySchema.parse(e)),
  ),
);

export function getCheck(id: string): RegistryEntry | undefined {
  return checks.find((c) => c.id === id);
}
