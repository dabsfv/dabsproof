// Golden-file tests: every report case, in every format, must equal its file under test/golden
// exactly. Files are written only when UPDATE_GOLDEN=1 is set, and never in CI.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderJson, renderMarkdown, renderTerminal } from '../src/index.js';
import { CASES, withoutName } from './golden-cases.js';

const FORMATS = [
  { dir: 'terminal', ext: 'txt', render: renderTerminal },
  { dir: 'markdown', ext: 'md', render: renderMarkdown },
  { dir: 'json', ext: 'json', render: renderJson },
] as const;

const UPDATE = process.env.UPDATE_GOLDEN === '1';
const IN_CI = Boolean(process.env.CI);
if (UPDATE && IN_CI) throw new Error('UPDATE_GOLDEN is refused in CI: golden files are never written there.');

const goldenPath = (dir: string, name: string, ext: string) =>
  fileURLToPath(new URL(`./golden/${dir}/${name}.${ext}`, import.meta.url));

describe('golden files', () => {
  for (const f of FORMATS) {
    for (const c of CASES) {
      it(`${f.dir}/${c.name}.${f.ext}`, () => {
        const actual = withoutName(f.render(c.doc()));
        const path = goldenPath(f.dir, c.name, f.ext);
        if (UPDATE) {
          mkdirSync(fileURLToPath(new URL(`./golden/${f.dir}/`, import.meta.url)), { recursive: true });
          writeFileSync(path, actual);
        }
        expect(existsSync(path), `missing golden file ${f.dir}/${c.name}.${f.ext}`).toBe(true);
        expect(actual).toBe(readFileSync(path, 'utf8'));
      });
    }
  }
});
