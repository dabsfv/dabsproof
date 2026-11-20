// T1, T2 and T3: the build. T3 reads build output and counts only; nothing from it is printed.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { brand } from '../../../packages/brand/src/index.ts';
import { REPORT_TEXT } from '../../../packages/core/src/index.ts';
import { EVM_TEXT } from '../../../packages/evm/src/index.ts';
import { APP_DIR, mappingDir, runBuildScript, writeMapping } from './harness.mjs';
import { allowListedFixture, FIXKIT_TEXT } from './helpers.mjs';

const dir = mappingDir();
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const SERVER = join(APP_DIR, '.next', 'server');
const ROUTES = ['api/alpha', 'api/item/[id]', 'api/tiered'];

describe('T1 a duplicate index stops the build before next build', () => {
  it('build script with a duplicate-index mapping', () => {
    const r = runBuildScript({ DEMO_MAPPING: writeMapping(dir, 'hd-dup-index', allowListedFixture('hd-dup-index')) });
    expect(r.status).toBe(1);
    expect(r.output.includes('X402-03.dup-index')).toBe(true);
    expect(r.output.includes('Creating an optimized production build')).toBe(false);
  });
  it('a mapping path outside the allowed folders', () => {
    const r = runBuildScript({ DEMO_MAPPING: '../../fixtures/manifests/hd.json' });
    expect(r.status).toBe(1);
    expect(r.output === 'refused: mapping-path\n').toBe(true);
  });
});

describe('T2 the good build exists (built by the turbo build step before this test)', () => {
  it('build output for the three routes', () => {
    expect(existsSync(join(APP_DIR, '.next', 'BUILD_ID'))).toBe(true);
    for (const r of ROUTES) expect(existsSync(join(SERVER, 'app', r, 'route.js'))).toBe(true);
  });
});

const NAMES = String.raw`(?:@noble/|@scure/|@dabsproof/)[^"'\x60]*|zod(?:/[^"'\x60]*)?`;
const SPECIFIER_FORMS = [
  new RegExp(String.raw`require\(\s*["'\x60](?:${NAMES})["'\x60]`, 'g'),
  new RegExp(String.raw`import\(\s*["'\x60](?:${NAMES})["'\x60]`, 'g'),
  new RegExp(String.raw`from\s*["'\x60](?:${NAMES})["'\x60]`, 'g'),
  new RegExp(String.raw`\.[A-Za-z]\(\s*["'\x60](?:${NAMES})["'\x60]`, 'g'), // a one-letter method call naming the package (a guessed form for externals; not verified)
  /["'\x60]@(?:noble|scure|dabsproof)\//g, // any scoped specifier in any form
];
const chunksOf = (route) => {
  const loader = readFileSync(join(SERVER, 'app', route, 'route.js'), 'utf8');
  return [...new Set(loader.match(/server\/chunks\/[^"']+\.js/g) ?? [])].map((c) =>
    readFileSync(join(APP_DIR, '.next', c), 'utf8'),
  );
};
const count = (texts, s) => texts.reduce((n, t) => n + t.split(s).length - 1, 0);

describe('T3 none of the packages is loaded from node_modules; markers show our code, @scure/bip32, @noble/curves and zod inside the chunks', () => {
  for (const route of ROUTES) {
    it(`${route}: trace lists none of them`, () => {
      const entries = JSON.parse(readFileSync(join(SERVER, 'app', route, 'route.js.nft.json'), 'utf8')).files;
      expect(entries.filter((f) => /@noble|@scure|zod|dabsproof|packages\//.test(f)).length).toBe(0);
    });
    it(`${route}: no module specifier for them in any form in its chunks`, () => {
      const chunks = chunksOf(route);
      expect(chunks.length > 0).toBe(true);
      for (const form of SPECIFIER_FORMS) expect(chunks.reduce((n, t) => n + (t.match(form)?.length ?? 0), 0)).toBe(0);
    });
    it(`${route}: our code and third-party code are inside its chunks`, () => {
      const chunks = chunksOf(route);
      const ours = [
        FIXKIT_TEXT.checkNotRun,
        EVM_TEXT.notExtendedKey,
        REPORT_TEXT.perResourceLeftOut,
        brand.productName,
      ];
      for (const s of ours) expect(count(chunks, s) >= 1).toBe(true);
      for (const s of ['Bitcoin seed', 'bad point', 'ZodError']) expect(count(chunks, s) >= 1).toBe(true);
    });
  }
});
