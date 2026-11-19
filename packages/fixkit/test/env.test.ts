// The environment guard: names and types only, decision 4(a), allowNames, and the own setting.
import { describe, expect, it } from 'vitest';
import { FIXKIT_TEXT, guardEnvironment, KEY_TYPE_LABEL, shapeOf, XPUB_VARIABLE } from '../src/index.js';
import { expectNotShown, makeCanaries, TEST_XPRV, TEST_XPUB } from './helpers.js';

describe('shapes', () => {
  it('recognises each kind of key material, and nothing ordinary', () => {
    const c = makeCanaries();
    expect(shapeOf(c.privateKey)).toBe('private-key');
    expect(shapeOf(c.privateKey0x)).toBe('private-key');
    expect(shapeOf(c.xprv)).toBe('extended-private-key');
    expect(shapeOf(TEST_XPRV)).toBe('extended-private-key');
    expect(shapeOf(TEST_XPUB)).toBe('extended-public-key');
    expect(shapeOf(c.pem)).toBe('pem-private-key');
    expect(shapeOf(c.mnemonic)).toBe('mnemonic-like');
    for (const ordinary of [
      'production',
      '3000',
      'https://seller.test',
      `0x${'a'.repeat(40)}`,
      'eip155:84532',
      'one two three',
    ]) {
      expect(shapeOf(ordinary)).toBeNull();
    }
    expect(shapeOf(c.mnemonic.split(' ').slice(0, 11).join(' '))).toBeNull();
  });
});

describe('NEXT_PUBLIC_ variables', () => {
  it('key material refuses, with sentence d and the name and type only', () => {
    const c = makeCanaries();
    for (const [value, type] of [
      [c.privateKey, 'private-key'],
      [c.xprv, 'extended-private-key'],
      [c.mnemonic, 'mnemonic-like'],
      [c.pem, 'pem-private-key'],
    ] as const) {
      const g = guardEnvironment({ NEXT_PUBLIC_WALLET: value });
      expect(g.refuse).toBe(true);
      expect(g.lines).toEqual([FIXKIT_TEXT.envPublicKeyShaped, `  NEXT_PUBLIC_WALLET: ${KEY_TYPE_LABEL[type]}`]);
      expectNotShown(g.lines, { value: value === c.pem ? c.pemBody : value });
    }
  });
  it('an xpub refuses, with its own sentence d2 and the name only', () => {
    const g = guardEnvironment({ NEXT_PUBLIC_XPUB: TEST_XPUB });
    expect(g.refuse).toBe(true);
    expect(g.lines).toEqual([FIXKIT_TEXT.envPublicXpub, '  NEXT_PUBLIC_XPUB']);
    expectNotShown(g.lines, { xpub: TEST_XPUB });
  });
  it('allowNames excuses a harmless 64-hex build hash by exact name, and prints the name', () => {
    const hash = makeCanaries().privateKey;
    const blocked = guardEnvironment({ NEXT_PUBLIC_BUILD_HASH: hash });
    expect(blocked.refuse).toBe(true);
    const g = guardEnvironment({ NEXT_PUBLIC_BUILD_HASH: hash }, { allowNames: ['NEXT_PUBLIC_BUILD_HASH'] });
    expect(g.refuse).toBe(false);
    expect(g.allowed).toEqual(['NEXT_PUBLIC_BUILD_HASH']);
    expect(g.lines).toEqual(['allowNames: NEXT_PUBLIC_BUILD_HASH']);
    expect(guardEnvironment({ NEXT_PUBLIC_BUILD_HASH: hash }, { allowNames: ['next_public_build_hash'] }).refuse).toBe(
      true,
    );
  });
});

describe('server variables (decision 4a)', () => {
  it('a key-shaped value is reported by name and type, and refuses only with strict', () => {
    const c = makeCanaries();
    const env = { FACILITATOR_KEY: c.privateKey0x, NODE_ENV: 'production' };
    const g = guardEnvironment(env);
    expect(g.refuse).toBe(false);
    expect(g.lines).toEqual([FIXKIT_TEXT.envKeyShaped, '  FACILITATOR_KEY: private key']);
    expect(guardEnvironment(env, { strict: true }).refuse).toBe(true);
    expectNotShown(g.lines, { key: c.privateKey0x });
  });
  it('a name that suggests key material is reported by name only (sentence m), refusing only with strict', () => {
    const g = guardEnvironment({ WALLET_MNEMONIC: 'not set yet', SEED_FILE: '' });
    expect(g.refuse).toBe(false);
    expect(g.lines).toEqual([FIXKIT_TEXT.envKeyName, '  SEED_FILE', '  WALLET_MNEMONIC']);
    expect(guardEnvironment({ WALLET_MNEMONIC: 'x' }, { strict: true }).refuse).toBe(true);
  });
  it('a server-side xpub is not reported', () => {
    expect(guardEnvironment({ SOME_XPUB: TEST_XPUB }).findings).toEqual([]);
  });
  it('an ordinary environment has no findings', () => {
    const g = guardEnvironment({
      PATH: '/usr/bin',
      NODE_ENV: 'production',
      PORT: '3000',
      NEXT_PUBLIC_SITE: 'https://seller.test',
    });
    expect(g).toEqual({ refuse: false, findings: [], allowed: [], lines: [] });
  });
});

describe("the fix kit's own setting", () => {
  it('an account xpub passes and is never printed', () => {
    const g = guardEnvironment({ [XPUB_VARIABLE]: TEST_XPUB });
    expect(g.refuse).toBe(false);
    expect(g.lines).toEqual([]);
  });
  it('anything else refuses, and allowNames can never excuse it', () => {
    const c = makeCanaries();
    for (const value of [TEST_XPRV, c.privateKey, c.mnemonic, 'not a key']) {
      const g = guardEnvironment({ [XPUB_VARIABLE]: value }, { allowNames: [XPUB_VARIABLE] });
      expect(g.refuse).toBe(true);
      expect(g.allowed).toEqual([]);
      expect(g.lines.join('\n')).toContain(XPUB_VARIABLE);
      expectNotShown(g.lines, { value });
    }
  });
});
