import { brand } from '@dabsproof/brand';
import { getCheck } from '@dabsproof/registry';
import { describe, expect, it } from 'vitest';
import {
  analyse,
  lintWording,
  loadManifest,
  NOT_EXPORTED_TEXT,
  REPORT_TEXT,
  renderInvalidManifest,
  renderStaticReport,
  reportSentences,
} from '../src/index.js';
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

describe('step 1.1 report lines', () => {
  it('schemes: says plainly that schemes were compared separately, and claims nothing either way', () => {
    const t = report('schemes');
    expect(t).toContain(REPORT_TEXT.schemesSeparate);
    expect(t).not.toMatch(/\bsafe\b|cannot be used|can be used together/i);
  });
  it('a report with one scheme does not mention schemes', () => {
    for (const f of ['shared', 'hd', 'tiers']) expect(report(f)).not.toContain(REPORT_TEXT.schemesSeparate);
  });
  it('not-exported: lists each route with its reason sentence and the overall result', () => {
    const t = report('not-exported');
    expect(t).toContain(REPORT_TEXT.notExportedHeading);
    expect(t).toContain(`- \`/api/item/[id]\`: ${NOT_EXPORTED_TEXT['payto-function']}`);
    expect(t).toContain(`- \`/api/tiered\`: ${NOT_EXPORTED_TEXT['price-function']}`);
    expect(t).toContain(REPORT_TEXT.notExportedOverall);
  });
  it('hd-per-resource: lists the per-item route as left out', () => {
    const t = report('hd-per-resource');
    expect(t).toContain(REPORT_TEXT.perResourceLeftOut);
    expect(t).toContain('- `/api/item/[id]` (base address index 1000)');
  });
  it('tiers: labels the tier in the route line', () => {
    expect(report('tiers')).toContain('- `/api/tiered` (tier basic, `0x0000…0010`)');
  });
  it('every fixed sentence passes the wording lint', () => {
    for (const s of reportSentences()) expect(lintWording(s), s).toEqual([]);
  });
});

describe('X402-03 version 3 texts in every static report', () => {
  const sub = (id: string) => {
    const c = getCheck('X402-03');
    const s = c?.status === 'experimental' || c?.status === 'active' ? c.subChecks.find((x) => x.id === id) : undefined;
    if (!s?.static) throw new Error(`${id} has no static text`);
    return s.static;
  };
  const cross = sub('X402-03.cross-route');
  const dup = sub('X402-03.dup-index');
  it('uses the within-scheme "found no problem" texts, even when only one scheme is used', () => {
    const t = report('hd');
    expect(t).toContain(cross['found-no-problem-within-scheme']);
    expect(t).toContain(dup['found-no-problem-within-scheme']);
  });
  it('never prints the earlier "found no problem" texts or the live not-applicable sentence', () => {
    for (const f of FIXTURES) {
      const t = report(f);
      expect(t).not.toContain(cross['found-no-problem']);
      expect(t).not.toContain(dup['found-no-problem']);
      expect(t).not.toContain('a payment cannot be moved between them');
    }
  });
  it('uses the static not-applicable text for cross-route', () => {
    expect(report('not-exported')).toContain(cross['not-applicable']);
  });
  it('per-item routes: the line says plainly that this check did not compare them', () => {
    const t = report('hd-per-resource');
    expect(t).toContain(
      'These routes give each item its own address. This check did not compare them with any other route, and did not check whether their address ranges overlap:',
    );
  });
});
