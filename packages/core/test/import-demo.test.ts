import { describe, expect, it } from 'vitest';
import { dollarsToUnits, importDemoConfig, MANIFEST_TEXT } from '../src/index.js';
import { demoFixturePath, fake, readJson } from './fixtures.js';

const config = (routes: Record<string, unknown>, extra: object = {}) => ({
  network: 'eip155:84532',
  asset: fake(1),
  routes,
  ...extra,
});

describe('dollarsToUnits (whole numbers only, never rounded)', () => {
  it('converts at 6 decimals', () => {
    expect(dollarsToUnits('$1', 6)).toEqual({ ok: true, units: '1000000' });
    expect(dollarsToUnits('$0.001', 6)).toEqual({ ok: true, units: '1000' });
    expect(dollarsToUnits('$0.000001', 6)).toEqual({ ok: true, units: '1' });
    expect(dollarsToUnits('$12.5', 6)).toEqual({ ok: true, units: '12500000' });
  });
  it('refuses more decimal places than the asset has', () => {
    expect(dollarsToUnits('$0.0000001', 6)).toEqual({ ok: false, reason: 'price-too-precise' });
  });
  it('refuses anything not written like "$0.001"', () => {
    for (const t of ['0.001', '$.5', '$1e-3', '€1', '$1.', ' $1', '$-1'])
      expect(dollarsToUnits(t, 6).ok, t).toBe(false);
  });
  it('handles prices far beyond floating-point precision exactly', () => {
    expect(dollarsToUnits('$123456789012345678.123456789012345678', 18)).toEqual({
      ok: true,
      units: '123456789012345678123456789012345678',
    });
  });
});

describe('importDemoConfig', () => {
  it('needs decimals', () => {
    expect(importDemoConfig(config({ '/a': { price: '$1', index: 0 } }), {} as { decimals: number })).toEqual({
      ok: false,
      issues: [`decimals: ${MANIFEST_TEXT.decimals}`],
    });
  });
  it('turns a tier map into one entry per tier, sorted', () => {
    const r = importDemoConfig(config({ '/t': { price: { pro: '$0.002', basic: '$0.001' }, index: 4 } }), {
      decimals: 6,
    });
    expect(r.ok && r.manifest.routes.map((x) => [x.tier, x.price])).toEqual([
      ['basic', '1000'],
      ['pro', '2000'],
    ]);
  });
  it('keeps payTo as address, index as index, and perResource as is', () => {
    const r = importDemoConfig(
      config({
        '/a': { price: '$1', payTo: fake(10) },
        '/b': { price: '$1', index: 3 },
        '/c/[id]': { price: '$1', perResource: { baseIndex: 1000 } },
      }),
      { decimals: 6 },
    );
    expect(r.ok && r.manifest.routes.map((x) => [x.route, x.address, x.index, x.perResource?.baseIndex])).toEqual([
      ['/a', fake(10), undefined, undefined],
      ['/b', undefined, 3, undefined],
      ['/c/[id]', undefined, undefined, 1000],
    ]);
  });
  it('drops the note and refuses any other unknown field, never naming it', () => {
    expect(importDemoConfig(config({ '/a': { price: '$1', index: 0 } }, { _note: 'x' }), { decimals: 6 }).ok).toBe(
      true,
    );
    const r = importDemoConfig(config({ '/a': { price: '$1', index: 0, xpubLike: 'zq-hidden' } }), { decimals: 6 });
    expect(r).toEqual({ ok: false, issues: [`routes./a: ${MANIFEST_TEXT.unknownField}`] });
  });
  it('refuses a price with too many decimals, naming the field only', () => {
    const r = importDemoConfig(config({ '/a': { price: '$0.0000001', index: 0 } }), { decimals: 6 });
    expect(r).toEqual({ ok: false, issues: [`routes./a.price: ${MANIFEST_TEXT.tooPrecise}`] });
  });
  it('hides a route key that is not a valid path', () => {
    const r = importDemoConfig(config({ 'zq secret key': { price: '$1', index: 0 } }), { decimals: 6 });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain('zq secret');
  });
  it('reads every demo-format fixture', () => {
    for (const f of ['shared', 'hd', 'hd-dup-index', 'hd-per-resource', 'hd-moved']) {
      expect(importDemoConfig(readJson(demoFixturePath(f)), { decimals: 6 }).ok, f).toBe(true);
    }
  });
});
