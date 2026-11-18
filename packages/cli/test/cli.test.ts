import { brand } from '@dabsproof/brand';
import { describe, expect, it } from 'vitest';
import { main } from '../src/index.js';

describe('cli', () => {
  it('reaches core through the package import', () => {
    expect(main()).toContain(brand.productName);
  });
});
