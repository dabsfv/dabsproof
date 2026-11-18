import type { RetiredInput } from '../schema.js';
import { FIRST_DATE } from '../shared.js';

export const x402_08 = {
  id: 'X402-08',
  version: 1,
  status: 'retired',
  title: 'Retired check',
  retiredReason: 'Retired before release. Key handling is not part of these checks. This ID is never reused.',
  changelog: [{ version: 1, date: FIRST_DATE, change: 'Retired before release.' }],
} satisfies RetiredInput;
