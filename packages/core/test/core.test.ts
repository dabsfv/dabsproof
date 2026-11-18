import { brand } from '@dabsproof/brand';
import { describe, expect, it } from 'vitest';
import { summary } from '../src/index.js';

describe('core', () => {
  it('reads the product name from brand and the checks from registry', () => {
    expect(summary()).toBe(`${brand.productName}: 0 checks loaded`);
  });
});
