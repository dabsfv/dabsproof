// The validator has no checks of its own: its results are core's analyse() results, unchanged.
import { readdirSync } from 'node:fs';
import { analyse, ManifestSchema } from '@dabsproof/core';
import { describe, expect, it } from 'vitest';
import { validateMapping } from '../src/index.js';
import { allowListed, fixturePath, readFixture } from './helpers.js';

const FIXTURES = readdirSync(new URL('../../../fixtures/manifests/', import.meta.url))
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''));

describe('validateMapping is analyse(), with no checks of its own', () => {
  it('covers every fixture', () => {
    expect(FIXTURES.length).toBeGreaterThanOrEqual(15);
  });
  for (const name of FIXTURES) {
    it(`${name}: results and exit code identical to analyse()`, () => {
      const parsed = ManifestSchema.parse(readFixture(name));
      const fromObject = validateMapping(readFixture(name));
      const fromPath = validateMapping(fixturePath(name));
      const direct = analyse(parsed);
      expect(fromObject.results).toEqual(direct.results);
      expect(fromPath.results).toEqual(direct.results);
      expect(fromObject.exitCode).toBe(direct.exitCode);
      expect(fromObject.decision).toBe(direct.exitCode === 1 ? 'refuse' : 'start');
    });
  }
  it('with earlier mappings, the results are still analyse() with the same history', () => {
    const now = readFixture('stale-reuse');
    const prev = ManifestSchema.parse(readFixture('stale-previous'));
    const v = validateMapping(now, { previous: [prev] });
    expect(v.results).toEqual(analyse(ManifestSchema.parse(now), { previous: [prev] }).results);
  });
});

describe('decisions', () => {
  it('hd-dup-index is refused (the step exit test)', () => {
    const v = validateMapping(readFixture('hd-dup-index'));
    expect(v.decision).toBe('refuse');
    expect(v.text).toContain('X402-03.dup-index');
  });
  it('hd-per-resource starts (the passing fixture); hd exits 1 by design', () => {
    expect(validateMapping(readFixture('hd-per-resource')).decision).toBe('start');
    expect(validateMapping(readFixture('hd')).exitCode).toBe(1);
  });
  it('could not verify starts by default and is refused with strict', () => {
    const m = allowListed('range-unknown');
    expect(validateMapping(m).exitCode).toBe(2);
    expect(validateMapping(m).decision).toBe('start');
    expect(validateMapping(m, { strict: true }).decision).toBe('refuse');
  });
  it('an invalid mapping is refused with the existing invalid-manifest report, naming no value', () => {
    const v = validateMapping({ manifestVersion: 1, routes: [{ route: '/a', price: 'one' }] });
    expect(v.decision).toBe('refuse');
    expect(v.manifest).toBeNull();
    expect(v.text).not.toContain('one');
    expect(validateMapping('/no/such/file.json').decision).toBe('refuse');
  });
  it('the text is the existing terminal report', () => {
    const v = validateMapping(readFixture('hd-per-resource'), { name: 'payto-map.json' });
    expect(v.text).toContain('payto-map.json');
    expect(v.text).toContain('found no problem');
  });
});
