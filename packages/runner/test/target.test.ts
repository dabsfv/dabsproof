import { describe, expect, it } from 'vitest';
import { checkTarget } from '../src/index.js';

const LOCAL = { local: true };
const CODE = /^[a-z][a-z-]{2,40}$/;
const codeOf = (target: unknown, options = LOCAL) => {
  const r = checkTarget(target, options);
  return r.ok ? 'accepted' : r.code;
};

const REFUSED: [string, unknown, string][] = [
  ['localhost', 'http://localhost:4319', 'host-not-loopback-literal'],
  ['a host name', 'http://example.test:4319', 'host-not-loopback-literal'],
  ['another loopback address', 'http://127.0.0.2:4319', 'host-not-loopback-literal'],
  ['a longer address', 'http://127.0.0.10:4319', 'host-not-loopback-literal'],
  ['a shorthand', 'http://127.1:4319', 'host-not-loopback-literal'],
  ['a private address', 'http://10.0.0.1:4319', 'host-not-loopback-literal'],
  ['a long IPv6 form', 'http://[0:0:0:0:0:0:0:1]:4319', 'host-not-loopback-literal'],
  ['a mapped IPv6 form', 'http://[::ffff:127.0.0.1]:4319', 'host-not-loopback-literal'],
  ['a zone id', 'http://[::1%1]:4319', 'host-not-loopback-literal'],
  ['unbracketed IPv6', 'http://::1:4319', 'host-not-loopback-literal'],
  ['userinfo', 'http://a@127.0.0.1:4319', 'userinfo-not-allowed'],
  ['no port', 'http://127.0.0.1', 'port-missing'],
  ['an empty port', 'http://127.0.0.1:', 'port-missing'],
  ['a non-numeric port', 'http://127.0.0.1:abc', 'port-invalid'],
  ['port 0', 'http://127.0.0.1:0', 'port-invalid'],
  ['a leading zero', 'http://127.0.0.1:04319', 'port-invalid'],
  ['port 65536', 'http://127.0.0.1:65536', 'port-invalid'],
  ['a trailing slash', 'http://127.0.0.1:4319/', 'target-has-path'],
  ['a path', 'http://127.0.0.1:4319/api', 'target-has-path'],
  ['a query', 'http://127.0.0.1:4319?a=1', 'target-has-path'],
  ['a fragment', 'http://[::1]:4319#x', 'target-has-path'],
  ['https', 'https://127.0.0.1:4319', 'unsupported-scheme'],
  ['another scheme', 'ftp://127.0.0.1:4319', 'unsupported-scheme'],
  ['upper-case scheme', 'HTTP://127.0.0.1:4319', 'unsupported-scheme'],
  ['no scheme', '127.0.0.1:4319', 'unsupported-scheme'],
];
const pick = (...names: string[]) => REFUSED.filter(([name]) => names.includes(name));

describe('checkTarget', () => {
  it('accepts http://127.0.0.1:4319 with the local flag', () => {
    expect(checkTarget('http://127.0.0.1:4319', LOCAL)).toEqual({
      ok: true,
      target: { origin: 'http://127.0.0.1:4319', host: '127.0.0.1', port: 4319 },
    });
  });
  it('accepts http://[::1]:4319 with the local flag', () => {
    expect(checkTarget('http://[::1]:4319', LOCAL)).toEqual({
      ok: true,
      target: { origin: 'http://[::1]:4319', host: '[::1]', port: 4319 },
    });
  });
  it('refuses any target without the local flag', () => {
    // checkTarget is called directly, so no helper default can replace a missing options object.
    for (const options of [undefined, { local: false }, {}, { local: 'true' }]) {
      const r = checkTarget('http://[::1]:4319', options as unknown as { local: boolean });
      expect(r.ok ? 'accepted' : r.code).toBe('local-flag-required');
    }
  });
  it('refuses localhost', () => {
    expect(codeOf('http://localhost:4319')).toBe('host-not-loopback-literal');
  });
  it('refuses a host name', () => {
    expect(codeOf('http://example.test:4319')).toBe('host-not-loopback-literal');
  });
  it('refuses other IPv4 addresses and shorthands', () => {
    for (const [, t, code] of pick(
      'another loopback address',
      'a longer address',
      'a shorthand',
      'a private address',
    )) {
      expect(codeOf(t)).toBe(code);
    }
  });
  it('refuses non-literal IPv6 forms', () => {
    for (const [, t, code] of pick('a long IPv6 form', 'a mapped IPv6 form', 'a zone id', 'unbracketed IPv6')) {
      expect(codeOf(t)).toBe(code);
    }
  });
  it('refuses userinfo', () => {
    expect(codeOf('http://a@127.0.0.1:4319')).toBe('userinfo-not-allowed');
  });
  it('refuses a missing, non-numeric, zero, leading-zero or too-large port', () => {
    for (const [, t, code] of pick(
      'no port',
      'an empty port',
      'a non-numeric port',
      'port 0',
      'a leading zero',
      'port 65536',
    )) {
      expect(codeOf(t)).toBe(code);
    }
    expect(codeOf('http://127.0.0.1:65535')).toBe('accepted');
  });
  it('refuses a path, query, fragment or trailing slash', () => {
    for (const [, t, code] of pick('a trailing slash', 'a path', 'a query', 'a fragment')) expect(codeOf(t)).toBe(code);
  });
  it('refuses https and other schemes', () => {
    for (const [, t, code] of pick('https', 'another scheme', 'upper-case scheme', 'no scheme'))
      expect(codeOf(t)).toBe(code);
  });
  it('refuses a non-string target', () => {
    for (const t of [4319, null, undefined, {}, ['http://127.0.0.1:4319']]) expect(codeOf(t)).toBe('target-not-text');
  });
  it('refusals never echo their input', () => {
    for (const [, t] of REFUSED) {
      const r = checkTarget(t, LOCAL);
      expect(Object.keys(r).sort()).toEqual(['code', 'ok']);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(CODE.test(r.code)).toBe(true);
      expect(JSON.stringify(r).includes(String(t))).toBe(false);
    }
  });
});
