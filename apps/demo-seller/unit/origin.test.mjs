// Unit tests for lib/origin.js. No server is started.
import { describe, expect, it } from 'vitest';
import { configuredOrigin } from '../lib/origin.js';

const CODE = /^[a-z][a-z-]{2,40}$/;

describe('configuredOrigin', () => {
  it('accepts the literal http://127.0.0.1:4319', () => {
    expect(configuredOrigin('http://127.0.0.1:4319')).toEqual({ ok: true, origin: 'http://127.0.0.1:4319' });
  });
  it('accepts the end ports 1 and 65535', () => {
    expect(configuredOrigin('http://127.0.0.1:1').ok).toBe(true);
    expect(configuredOrigin('http://127.0.0.1:65535').ok).toBe(true);
  });
  const refused = [
    ['missing', undefined],
    ['empty', ''],
    ['localhost', 'http://localhost:4319'],
    ['https', 'https://127.0.0.1:4319'],
    ['a path', 'http://127.0.0.1:4319/api'],
    ['a query', 'http://127.0.0.1:4319?a=1'],
    ['a trailing slash', 'http://127.0.0.1:4319/'],
    ['credentials', 'http://' + 'a' + ':' + 'b' + '@127.0.0.1:4319'],
    ['port 0', 'http://127.0.0.1:0'],
    ['port 65536', 'http://127.0.0.1:65536'],
    ['a non-string', 4319],
  ];
  for (const [name, value] of refused) {
    it(`refuses ${name} with a code only`, () => {
      const r = configuredOrigin(value);
      expect(r).toEqual({ ok: false, code: 'origin-not-given' });
      expect(CODE.test(r.code)).toBe(true);
      if (typeof value === 'string' && value !== '') expect(JSON.stringify(r).includes(value)).toBe(false);
    });
  }
});
