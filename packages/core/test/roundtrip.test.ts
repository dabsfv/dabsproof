// Step 1.1 exit test: round trips on every fixture.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importDemoConfig, loadManifest, ManifestSchema, serialiseManifest } from '../src/index.js';
import { DEMO_FIXTURES, demoFixturePath, FIXTURES, fixturePath, readJson } from './fixtures.js';

describe('round trip: manifest fixtures', () => {
  for (const f of FIXTURES) {
    it(`${f}: parse then serialise gives back the file exactly`, () => {
      const text = readFileSync(fixturePath(f), 'utf8');
      const loaded = loadManifest(fixturePath(f));
      if (!loaded.ok) throw new Error(`${f} did not load`);
      expect(serialiseManifest(loaded.manifest)).toBe(text);
    });
  }
});

describe('round trip: demo-format fixtures', () => {
  for (const f of DEMO_FIXTURES) {
    it(`${f}: import, serialise and parse again gives the same manifest`, () => {
      const imported = importDemoConfig(readJson(demoFixturePath(f)), { decimals: 6 });
      if (!imported.ok) throw new Error(`${f} did not import`);
      const again = ManifestSchema.parse(JSON.parse(serialiseManifest(imported.manifest)));
      expect(again).toEqual(imported.manifest);
    });
  }

  it('the demo-format hd-per-resource fixture imports to the manifest fixture of the same name', () => {
    const imported = importDemoConfig(readJson(demoFixturePath('hd-per-resource')), { decimals: 6 });
    const file = loadManifest(fixturePath('hd-per-resource'));
    if (!imported.ok || !file.ok) throw new Error('did not load');
    const { $comment: _c, ...withoutComment } = file.manifest;
    expect(imported.manifest).toEqual(withoutComment);
  });
});
