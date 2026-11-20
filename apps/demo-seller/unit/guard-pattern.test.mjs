// The T3 guard's pattern must be able to fail: it matches @x402/ specifiers and not plain mentions.
import { describe, expect, it } from 'vitest';
import { X402_SPECIFIER } from '../e2e/patterns.mjs';

describe('the T3 guard pattern for @x402/ specifiers', () => {
  const matches = [
    "import x from '@x402/core'",
    'require("@x402/core/http")',
    "import('@x402/evm')",
    'import(`@x402/core`)',
  ];
  const plain = ['// see @x402/core 2.31.0', 'x402', 'the x402 protocol'];
  for (const s of matches) it(`matches: ${s}`, () => expect(X402_SPECIFIER.test(s)).toBe(true));
  for (const s of plain) it(`does not match: ${s}`, () => expect(X402_SPECIFIER.test(s)).toBe(false));
});
