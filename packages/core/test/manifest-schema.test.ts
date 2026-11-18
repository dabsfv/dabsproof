// Step 1.1 schema rules, in both directions.
import { describe, expect, it } from 'vitest';
import { describeIssues, MANIFEST_TEXT, ManifestSchema } from '../src/index.js';
import { fake } from './fixtures.js';

const base = { route: '/api/a', price: '1000', asset: fake(1), network: 'eip155:84532' };
const parse = (routes: unknown[], extra: object = {}) =>
  ManifestSchema.safeParse({ manifestVersion: 1, routes, ...extra });
const ok = (routes: unknown[], extra?: object) => parse(routes, extra).success;
const lines = (routes: unknown[], extra?: object) => {
  const r = parse(routes, extra);
  return r.success ? [] : describeIssues(r.error.issues);
};

describe('scheme and tier', () => {
  it('accepts exact and upto, and nothing else', () => {
    expect(ok([{ ...base, address: fake(10), scheme: 'exact' }])).toBe(true);
    expect(ok([{ ...base, address: fake(10), scheme: 'upto' }])).toBe(true);
    expect(ok([{ ...base, address: fake(10), scheme: 'deferred' }])).toBe(false);
    expect(lines([{ ...base, address: fake(10), scheme: 'deferred' }])).toEqual([
      `routes.0.scheme: ${MANIFEST_TEXT.scheme}`,
    ]);
  });
  it('accepts tier labels of letters, numbers and hyphens only', () => {
    expect(ok([{ ...base, address: fake(10), tier: 'pro-2' }])).toBe(true);
    expect(ok([{ ...base, address: fake(10), tier: 'pro tier' }])).toBe(false);
  });
});

describe('who gets paid', () => {
  it('needs exactly one of address, index or perResource', () => {
    expect(ok([{ ...base }])).toBe(false);
    expect(ok([{ ...base, address: fake(10), index: 1 }])).toBe(false);
    expect(ok([{ ...base, route: '/api/i/[id]', index: 1, perResource: { baseIndex: 5 } }])).toBe(false);
    expect(ok([{ ...base, route: '/api/i/[id]', perResource: { baseIndex: 5 } }])).toBe(true);
  });
  it('allows perResource only on a route with a [param] part', () => {
    expect(ok([{ ...base, perResource: { baseIndex: 5 } }])).toBe(false);
    expect(lines([{ ...base, perResource: { baseIndex: 5 } }])).toContain(
      `routes.0.perResource: ${MANIFEST_TEXT.perResourceDynamic}`,
    );
  });
});

describe('uniqueness', () => {
  it('allows one route several times when tier, scheme, network or asset differ', () => {
    expect(
      ok([
        { ...base, address: fake(10), tier: 'basic' },
        { ...base, address: fake(10), tier: 'pro' },
        { ...base, address: fake(10), scheme: 'upto' },
        { ...base, address: fake(10), asset: fake(2) },
      ]),
    ).toBe(true);
  });
  it('refuses the same route twice with the same tier, scheme, network and asset', () => {
    expect(
      ok([
        { ...base, address: fake(10) },
        { ...base, address: fake(11), scheme: 'exact' },
      ]),
    ).toBe(false);
  });
});

describe('notExported', () => {
  it('takes only the fixed reason codes', () => {
    expect(ok([], { notExported: [{ route: '/api/x', reason: 'price-function' }] })).toBe(true);
    expect(ok([], { notExported: [{ route: '/api/x', reason: 'it was $5' }] })).toBe(false);
  });
  it('refuses a manifest with no routes and nothing in notExported', () => {
    expect(lines([])).toEqual([`routes: ${MANIFEST_TEXT.emptyManifest}`]);
  });
});

describe('messages a seller sees', () => {
  it('never name an unknown field, and never show a value', () => {
    const secretName = `0x${'ab'.repeat(32)}`;
    const out = lines([{ ...base, address: fake(10), [secretName]: 'zq-hidden-value' }]).join('\n');
    expect(out).toBe(`routes.0: ${MANIFEST_TEXT.unknownField}`);
  });
  it("replace zod's own messages with linted ones", () => {
    expect(lines([{ ...base, address: fake(10), index: 'one' }])).toEqual([
      `routes.0.index: ${MANIFEST_TEXT.fieldInvalid}`,
    ]);
  });
});
