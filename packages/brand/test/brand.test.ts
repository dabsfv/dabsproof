import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { brand, parseBrand } from '../src/index.js';

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

describe('parseBrand', () => {
  it('accepts the real config', () => {
    expect(parseBrand(json)).toEqual(json);
  });
  it('refuses an unknown field, naming the field but not its value', () => {
    expect(() => parseBrand({ ...json, extra: 'zq-value' })).toThrow(/unknown field: extra$/);
    expect(() => parseBrand({ ...json, extra: 'zq-value' })).not.toThrow(/zq-value/);
  });
  it('refuses a missing or empty text field, and a domain that is not text or null', () => {
    const { slug: _s, ...noSlug } = json;
    expect(() => parseBrand(noSlug)).toThrow(/slug/);
    expect(() => parseBrand({ ...json, cliName: '' })).toThrow(/cliName/);
    expect(() => parseBrand({ ...json, domain: 3 })).toThrow(/domain/);
  });
  it('refuses something that is not an object', () => {
    expect(() => parseBrand(null)).toThrow();
    expect(() => parseBrand('x')).toThrow();
  });
});
