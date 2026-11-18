// Every sentence the evm package can show passes the wording lint.
import { EVM_TEXT } from '@dabsproof/evm';
import { describe, expect, it } from 'vitest';
import { lintWording } from '../src/index.js';

describe('evm wording', () => {
  for (const [key, text] of Object.entries(EVM_TEXT)) {
    it(key, () => {
      expect(lintWording(text)).toEqual([]);
    });
  }
});
