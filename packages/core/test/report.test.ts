import { brand } from '@dabsproof/brand';
import { getCheck } from '@dabsproof/registry';
import { describe, expect, it } from 'vitest';
import { analyse, loadManifest, REPORT_TEXT, renderInvalidManifest, renderStaticReport } from '../src/index.js';
import { FIXTURES, fixturePath, shownPath } from './fixtures.js';

const report = (name: string): string => {
  const r = loadManifest(fixturePath(name));
  if (!r.ok) throw new Error(`${name} did not load`);
  return renderStaticReport(brand.productName, shownPath(name), analyse(r.manifest));
};
const count = (text: string, part: string) => text.split(part).length - 1;
const x03 = getCheck('X402-03');
const liveSentence = x03?.status === 'experimental' ? x03.outcomes['found-a-problem'] : '';

describe('Markdown report', () => {
  for (const f of FIXTURES) {
    it(`${f}: matches its snapshot (product name replaced, so the name stays only in brand)`, () => {
      expect(report(f).split(brand.productName).join('<productName>')).toMatchSnapshot();
    });
    it(`${f}: says it came from the manifest, states its coverage, and prints no full address`, () => {
      const t = report(f);
      expect(t).toContain(REPORT_TEXT.fromManifest);
      expect(t).toContain(REPORT_TEXT.coverage);
      expect(t).not.toMatch(/0x[0-9a-fA-F]{40}/);
    });
  }

  it('never uses the live outcome sentence for a finding read from a manifest', () => {
    expect(liveSentence).not.toBe('');
    for (const f of FIXTURES) expect(report(f)).not.toContain(liveSentence);
  });

  it('shared.json: lists 7 routes with shortened addresses under one finding', () => {
    const t = report('shared');
    expect(count(t, '(`0x0000…0010`)')).toBe(7);
    expect(count(t, `### ${REPORT_TEXT.howToFix}`)).toBe(1);
  });

  it('hd-dup-index.json: reports the repeated index first, then "same mistake", with one fix', () => {
    const t = report('hd-dup-index');
    expect(t.indexOf('### X402-03.dup-index')).toBeLessThan(t.indexOf('### X402-03.cross-route'));
    expect(count(t, REPORT_TEXT.sameMistake)).toBe(1);
    expect(count(t, `### ${REPORT_TEXT.howToFix}`)).toBe(1);
  });

  it('mainnet.json: says nothing was checked and lists the skipped routes', () => {
    const t = report('mainnet');
    expect(t).toContain(REPORT_TEXT.nothingChecked);
    expect(t).toContain(REPORT_TEXT.skippedRoutes);
    expect(t).not.toContain(`### ${REPORT_TEXT.howToFix}`);
  });

  it('an invalid manifest reads as could not verify', () => {
    const t = renderInvalidManifest(brand.productName, 'x.json', 'The manifest is not valid JSON.', []);
    expect(t).toContain('**could not verify**');
  });
});
