import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadManifest, MAX_MANIFEST_BYTES, ManifestSchema } from '../src/index.js';
import { FIXTURES, fixturePath } from './fixtures.js';

const route = { route: '/api/a', price: '1000', asset: `0x${'0'.repeat(39)}1`, network: 'eip155:84532', index: 0 };
const manifest = (routes: unknown[]) => ({ manifestVersion: 1, routes });
const dir = mkdtempSync(join(tmpdir(), 'manifest-test-'));
const file = (name: string, text: string) => {
  const p = join(dir, name);
  writeFileSync(p, text);
  return p;
};

describe('manifest', () => {
  it('loads every fixture', () => {
    for (const f of FIXTURES) expect(loadManifest(fixturePath(f)).ok, f).toBe(true);
  });

  it('needs exactly one of address or index', () => {
    const { index: _i, ...noPayee } = route;
    expect(ManifestSchema.safeParse(manifest([noPayee])).success).toBe(false);
    expect(ManifestSchema.safeParse(manifest([{ ...route, address: route.asset }])).success).toBe(false);
  });

  it('refuses unknown fields, so no key or xpub field can appear', () => {
    expect(ManifestSchema.safeParse(manifest([{ ...route, xpub: 'x' }])).success).toBe(false);
    expect(ManifestSchema.safeParse({ ...manifest([route]), privateKey: 'x' }).success).toBe(false);
  });

  it('refuses a route listed twice, and routes with spaces or backticks', () => {
    expect(ManifestSchema.safeParse(manifest([route, { ...route, index: 1 }])).success).toBe(false);
    expect(ManifestSchema.safeParse(manifest([{ ...route, route: '/a b' }])).success).toBe(false);
    expect(ManifestSchema.safeParse(manifest([{ ...route, route: '/a`b' }])).success).toBe(false);
  });

  it('never reads an environment file', () => {
    const r = loadManifest(file('.env.local', JSON.stringify(manifest([route]))));
    expect(r.ok === false && r.kind).toBe('refused');
  });

  it('refuses a file over 1 MB', () => {
    const r = loadManifest(file('big.json', ' '.repeat(MAX_MANIFEST_BYTES + 1)));
    expect(r.ok === false && r.kind).toBe('refused');
  });

  it('describes problems by field path, never by the value found', () => {
    const secretLooking = `0x${'ab'.repeat(32)}`;
    const r = loadManifest(file('bad.json', JSON.stringify(manifest([{ ...route, price: secretLooking }]))));
    expect(r.ok === false && r.kind).toBe('invalid');
    const text = r.ok ? '' : JSON.stringify(r);
    expect(text).toContain('routes.0.price');
    expect(text).not.toContain('abab');
  });

  it('reports a file that is not JSON as invalid', () => {
    const r = loadManifest(file('broken.json', '{'));
    expect(r.ok === false && r.kind).toBe('invalid');
  });
});
