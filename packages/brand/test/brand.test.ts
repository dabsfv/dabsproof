import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { brand } from '../src/index.js';

const json = JSON.parse(readFileSync(new URL('../../../brand.config.json', import.meta.url), 'utf8'));

describe('brand', () => {
  it('matches brand.config.json exactly', () => {
    expect({ ...brand }).toEqual(json);
  });

  it('derives every slug-based value from the slug', () => {
    expect(brand.slug).toMatch(/^[a-z0-9-]+$/);
    expect(brand.cliName).toBe(brand.slug);
    expect(brand.npmScope).toBe(`@${brand.slug}`);
    expect(brand.dnsLabel).toBe(`_${brand.slug}`);
    expect(brand.wellKnownFile).toBe(`${brand.slug}.txt`);
    expect(brand.configDir).toBe(`~/.config/${brand.slug}`);
  });

  it('cannot be changed at run time', () => {
    expect(Object.isFrozen(brand)).toBe(true);
  });
});
