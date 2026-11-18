// One source of wording for terminal, Markdown and JSON: no sentence can differ between them, the
// renderers add no words, and the JSON holds nothing the report does not already show.
import { OUTCOMES } from '@dabsproof/registry';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { type Block, ReportJsonSchema, renderJson, renderMarkdown, renderTerminal } from '../src/index.js';
import { CASES } from './golden-cases.js';

/** Every piece of text in the document: segments, table cells. */
function texts(blocks: Block[]): string[] {
  const out: string[] = [];
  for (const b of blocks) {
    if (b.type === 'rule') continue;
    if (b.type === 'table') {
      out.push(...b.head, ...b.rows.flat());
      continue;
    }
    if (b.type === 'list') {
      for (const s of b.lead ?? []) out.push(s.t);
      for (const item of b.items) for (const s of item) out.push(s.t);
      continue;
    }
    if (b.type === 'numbered') {
      for (const item of b.items) for (const s of item) out.push(s.t);
      continue;
    }
    for (const s of b.text) out.push(s.t);
  }
  return out;
}

/** What is left of an output once every document text is removed (longest first). */
function leftOver(output: string, docTexts: string[]): string {
  let rest = output;
  for (const t of [...new Set(docTexts)].sort((a, b) => b.length - a.length)) if (t) rest = rest.split(t).join('');
  return rest;
}

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) strings(v, out);
  return out;
}

/** JSON values that are codes rather than report text. */
const CODES = new Set<string>([...OUTCOMES, 'report', 'invalid-manifest']);

describe('one source of wording', () => {
  for (const c of CASES) {
    const doc = c.doc();
    const docTexts = texts(doc.blocks);
    const terminal = renderTerminal(doc);
    const markdown = renderMarkdown(doc);
    const jsonText = renderJson(doc);

    it(`${c.name}: every sentence appears unchanged in the terminal and Markdown output`, () => {
      for (const t of docTexts.filter((x) => /[A-Za-z]/.test(x))) {
        expect(terminal, t).toContain(t);
        expect(markdown, t).toContain(t);
      }
    });
    it(`${c.name}: the terminal and Markdown renderers add no words`, () => {
      expect(leftOver(terminal, docTexts)).not.toMatch(/[A-Za-z]/);
      expect(leftOver(markdown, docTexts)).not.toMatch(/[A-Za-z]/);
    });
    it(`${c.name}: the JSON matches its schema and says nothing the report does not`, () => {
      const json = JSON.parse(jsonText);
      expect(ReportJsonSchema.safeParse(json).success).toBe(true);
      for (const s of strings(json)) if (!CODES.has(s)) expect(terminal, s).toContain(s);
    });
    it(`${c.name}: no output holds a full address or a 64-character hex string`, () => {
      for (const out of [terminal, markdown, jsonText]) {
        expect(out).not.toMatch(/0x[0-9a-fA-F]{40}/);
        expect(out).not.toMatch(/[0-9a-fA-F]{64}/);
      }
    });
    it(`${c.name}: the terminal output holds no Markdown markers`, () => {
      expect(terminal).not.toMatch(/`|\*\*|^#|^\|/m);
    });
  }

  it('the per-item sentence is word for word the same in all three formats', () => {
    const c = CASES.find((x) => x.name === 'hd-per-resource');
    if (!c) throw new Error('no hd-per-resource case');
    const sentence =
      'These routes give each item its own address. X402-03.cross-route and X402-03.dup-index did not compare them with any other route; X402-03.index-range-overlap below says whether their address ranges could be compared:';
    expect(renderTerminal(c.doc())).toContain(sentence);
    expect(renderMarkdown(c.doc())).toContain(sentence);
    expect(JSON.parse(renderJson(c.doc())).information.map((i: { text: string }) => i.text)).toContain(sentence);
  });
});

describe('JSON format', () => {
  it('has formatVersion 1', () => {
    for (const c of CASES) expect(JSON.parse(renderJson(c.doc())).formatVersion).toBe(1);
  });
  it('JSON Schema', () => {
    expect(z.toJSONSchema(ReportJsonSchema)).toMatchSnapshot();
  });
});

describe('manifests are named by file name only, in every format', () => {
  it('a long directory path shows only the file name, for the main and every earlier manifest', async () => {
    const { brand } = await import('@dabsproof/brand');
    const { analyse, buildStaticReportDocument, buildInvalidManifestDocument, loadManifest } = await import(
      '../src/index.js'
    );
    const { fixturePath } = await import('./fixtures.js');
    const now = loadManifest(fixturePath('stale-reuse'));
    const prev = loadManifest(fixturePath('stale-previous'));
    if (!now.ok || !prev.ok) throw new Error('did not load');
    const long = '/Users/zq-someone/projects/very/long/folder/zq-private/stale-reuse.json';
    const windows = 'C:\\Users\\zq-someone\\shop\\stale-previous.json';
    const unreadable = '/home/zq-someone/old/zq-folder/missing.json';
    const docs = [
      buildStaticReportDocument(brand.productName, long, analyse(now.manifest, { previous: [prev.manifest] }), {
        read: [windows],
        unreadable: [{ path: unreadable, reason: 'The manifest file could not be opened.' }],
      }),
      buildInvalidManifestDocument(brand.productName, long, 'The manifest is not valid JSON.', []),
    ];
    for (const doc of docs) {
      for (const out of [renderTerminal(doc), renderMarkdown(doc), renderJson(doc)]) {
        expect(out).toContain('stale-reuse.json');
        expect(out).not.toMatch(/zq-|Users|projects|folder|home/);
      }
    }
    const json = JSON.parse(renderJson(docs[0] as (typeof docs)[0]));
    expect(json.manifest).toBe('stale-reuse.json');
    expect(json.information.flatMap((i: { items: string[] }) => i.items)).toEqual(
      expect.arrayContaining(['stale-previous.json', 'missing.json: The manifest file could not be opened.']),
    );
  });
});
