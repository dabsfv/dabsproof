// Unit tests for lib/entry.js. No server is started.
import { describe, expect, it } from 'vitest';
import { entryFor, idText } from '../lib/entry.js';

const m = (...routes) => ({ routes });
const a = { route: '/a', price: '1' };

describe('entryFor', () => {
  it('one untiered entry is found', () => expect(entryFor(m(a), '/a')).toBe(a));
  it('the tier must match exactly', () => {
    const basic = { route: '/t', tier: 'basic', price: '1' };
    const pro = { route: '/t', tier: 'pro', price: '2' };
    expect(entryFor(m(basic, pro), '/t', 'pro')).toBe(pro);
    expect(entryFor(m(basic, pro), '/t')).toBe(null);
    expect(entryFor(m(basic, pro), '/t', 'gold')).toBe(null);
  });
  it('no match gives null', () => expect(entryFor(m(a), '/b')).toBe(null));
  it('two matches give null', () => expect(entryFor(m(a, { ...a }), '/a')).toBe(null));
  it('a scheme other than exact is left out; a missing manifest gives null', () => {
    expect(entryFor(m({ ...a, scheme: 'upto' }), '/a')).toBe(null);
    expect(entryFor(undefined, '/a')).toBe(null);
  });
});

describe('idText', () => {
  it('accepts one to ten ASCII digits, text kept as given', () => {
    for (const s of ['5', '05', '1234567890']) expect(idText(s)).toEqual({ ok: true, id: s });
  });
  const refused = [
    ['empty', ''],
    ['eleven digits', '12345678901'],
    ['a leading space', ' 5'],
    ['a trailing letter', '5a'],
    ['a minus sign', '-1'],
    ['an exponent', '1e3'],
    ['a non-ASCII digit', '٥'],
    ['a number', 5],
    ['missing', undefined],
  ];
  for (const [name, value] of refused) {
    it(`refuses ${name} with a code only`, () => {
      const r = idText(value);
      expect(r).toEqual({ ok: false, code: 'bad-item-id' });
      if (typeof value === 'string' && value !== '') expect(JSON.stringify(r).includes(value)).toBe(false);
    });
  }
});
