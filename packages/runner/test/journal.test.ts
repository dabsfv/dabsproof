// The journal on disk, in temporary folders only: each test makes its own folder under the OS temp
// folder and removes only that folder afterwards. Values are clearly fake: repeated-digit addresses
// and a fingerprint of 43 letters B. No key, signature or real nonce.
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brand } from '@dabsproof/brand';
import { describe, expect, it } from 'vitest';
import { JOURNAL_FILE_NAME, MAX_JOURNAL_BYTES, openJournal } from '../src/journal.js';
import { buildLine } from '../src/journal-format.js';

const PREFIX = 'journal-test-';
const REPO = realpathSync(fileURLToPath(new URL('../../../', import.meta.url))).replace(/\/$/, '');
const RUN = 'run-a';
const FP = `fp1:${'B'.repeat(43)}`;
const ADDR = `0x${'2'.repeat(40)}`;
const TOKEN = `0x${'3'.repeat(40)}`;
const T0 = 1_700_000_000;

/** The four events of one attempt, as a caller gives them (no v, run or seq). */
const attempt = (att: number, t = T0): Record<string, unknown>[] => [
  {
    ev: 'intent',
    att,
    t,
    network: 'eip155:84532',
    asset: TOKEN,
    payTo: ADDR,
    value: '1000',
    validBefore: String(t + 300),
    route: '/api/paid',
    fp: FP,
  },
  { ev: 'signed', att, t: t + 1, fp: FP },
  { ev: 'send-begin', att, t: t + 2, fp: FP },
  { ev: 'outcome', att, t: t + 3, fp: FP, result: 'paid', status: 200 },
];
/** The exact text the journal should write for these caller entries, seq counted from `from`. */
const expected = (entries: Record<string, unknown>[], run = RUN, from = 0) =>
  entries
    .map((x, i) => {
      const r = buildLine({ ...x, v: 1, run, seq: from + i });
      if (!r.ok) throw new Error(r.reason);
      return r.line;
    })
    .join('');

/** A temp root, a journal folder in it (mode 0700), and a fake repo path; the root is removed after. */
function withTemp(fn: (t: { root: string; dir: string; file: string; repo: string }) => void) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), PREFIX)));
  try {
    const dir = join(root, 'state');
    mkdirSync(dir);
    chmodSync(dir, 0o700);
    fn({ root, dir, file: join(dir, JOURNAL_FILE_NAME), repo: REPO });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
/** Writes a journal file the test owns, with mode exactly 0600. */
function seed(file: string, text: string) {
  writeFileSync(file, text);
  chmodSync(file, 0o600);
}
const reasonOf = (r: { ok: boolean; reason?: string }) => (r.ok ? 'ok' : r.reason);
const openFds = () => readdirSync('/dev/fd').length;

describe('journal: opening and appending', () => {
  it('opens a new journal (file made with mode 0600), appends a whole attempt, and re-opens it as finished', () => {
    withTemp(({ dir, file, repo }) => {
      const r = openJournal({ dir, repoRoot: repo, run: RUN });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(lstatSync(file).mode & 0o777).toBe(0o600);
      expect(readFileSync(file).length).toBe(0);
      const a = attempt(0);
      for (const x of a) expect(r.journal.append(x)).toEqual({ ok: true });
      expect(r.journal.unfinished()).toEqual([]);
      r.journal.close();
      expect(readFileSync(file, 'utf8')).toBe(expected(a));

      const again = openJournal({ dir, repoRoot: repo, run: RUN });
      expect(again.ok).toBe(true);
      if (!again.ok) return;
      expect(again.journal.unfinished()).toEqual([]);
      // seq continues from the file for the same run.
      const next = attempt(1, T0 + 10)[0] as Record<string, unknown>;
      expect(again.journal.append(next)).toEqual({ ok: true });
      again.journal.close();
      expect(readFileSync(file, 'utf8')).toBe(expected(a) + expected([next], RUN, 4));
    });
  });

  it('another run in the same journal starts its own seq at 0', () => {
    withTemp(({ dir, file, repo }) => {
      seed(file, expected(attempt(0), 'run-old'));
      const r = openJournal({ dir, repoRoot: repo, run: RUN });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.journal.append(attempt(0)[0])).toEqual({ ok: true });
      r.journal.close();
      expect(readFileSync(file, 'utf8')).toBe(expected(attempt(0), 'run-old') + expected([attempt(0)[0] ?? {}]));
    });
  });
});

describe('journal: the folder', () => {
  it('a folder path that is not absolute is journal-dir-invalid', () => {
    withTemp(({ repo }) => {
      expect(reasonOf(openJournal({ dir: 'state', repoRoot: repo, run: RUN }))).toBe('journal-dir-invalid');
      expect(reasonOf(openJournal({ dir: './state', repoRoot: repo, run: RUN }))).toBe('journal-dir-invalid');
      expect(reasonOf(openJournal({ dir: 42, repoRoot: repo, run: RUN }))).toBe('journal-dir-invalid');
    });
  });

  it('a folder path with a .. segment is journal-dir-invalid, and nothing is made', () => {
    withTemp(({ root, dir, file, repo }) => {
      expect(reasonOf(openJournal({ dir: `${root}/x/../state`, repoRoot: repo, run: RUN }))).toBe(
        'journal-dir-invalid',
      );
      expect(reasonOf(openJournal({ dir: `${dir}/..`, repoRoot: repo, run: RUN }))).toBe('journal-dir-invalid');
      expect(existsSync(file)).toBe(false);
    });
  });

  it('a folder path with a NUL is journal-dir-invalid', () => {
    withTemp(({ dir, repo }) => {
      expect(reasonOf(openJournal({ dir: `${dir}\0x`, repoRoot: repo, run: RUN }))).toBe('journal-dir-invalid');
    });
  });

  it('a folder in the repo, or the repo folder itself, is journal-in-repo, before anything on disk is looked at', () => {
    withTemp(({ root, dir, file }) => {
      const inRepo = join(REPO, 'journal-test-never-made');
      expect(reasonOf(openJournal({ dir: inRepo, repoRoot: REPO, run: RUN }))).toBe('journal-in-repo');
      expect(existsSync(inRepo)).toBe(false);
      expect(reasonOf(openJournal({ dir: REPO, repoRoot: REPO, run: RUN }))).toBe('journal-in-repo');
      // A real 0700 folder is still refused when it lies in the repo, here a fake repo in the temp root.
      expect(reasonOf(openJournal({ dir, repoRoot: root, run: RUN }))).toBe('journal-in-repo');
      expect(reasonOf(openJournal({ dir, repoRoot: root.toUpperCase(), run: RUN }))).toBe('journal-in-repo');
      expect(existsSync(file)).toBe(false);
      // A sibling whose name only starts with the repo's name is not inside it.
      const sibling = `${root}-other`;
      const ok = openJournal({ dir: join(root, 'state'), repoRoot: sibling, run: RUN });
      expect(reasonOf(ok)).toBe('ok');
      if (ok.ok) ok.journal.close();
      // A repo path that is not a plain absolute path is refused too.
      expect(reasonOf(openJournal({ dir, repoRoot: 'repo', run: RUN }))).toBe('journal-dir-invalid');
    });
  });

  it('a folder inside the config folder is journal-dir-invalid', () => {
    withTemp(({ root, repo }) => {
      const name = brand.configDir.split('/').pop() ?? '';
      expect(name.length > 0).toBe(true);
      const inConfig = join(root, '.config', name, 'journals');
      mkdirSync(inConfig, { recursive: true });
      chmodSync(inConfig, 0o700);
      expect(reasonOf(openJournal({ dir: inConfig, repoRoot: repo, run: RUN }))).toBe('journal-dir-invalid');
      expect(reasonOf(openJournal({ dir: join(root, '.Config', name.toUpperCase()), repoRoot: repo, run: RUN }))).toBe(
        'journal-dir-invalid',
      );
      expect(existsSync(join(inConfig, JOURNAL_FILE_NAME))).toBe(false);
    });
  });

  it('a missing folder is journal-dir-invalid, and is not made', () => {
    withTemp(({ root, repo }) => {
      const missing = join(root, 'missing');
      expect(reasonOf(openJournal({ dir: missing, repoRoot: repo, run: RUN }))).toBe('journal-dir-invalid');
      expect(existsSync(missing)).toBe(false);
    });
  });

  it('a folder that is a link is journal-dir-invalid', () => {
    withTemp(({ root, dir, file, repo }) => {
      const link = join(root, 'state-link');
      symlinkSync(dir, link);
      expect(reasonOf(openJournal({ dir: link, repoRoot: repo, run: RUN }))).toBe('journal-dir-invalid');
      expect(existsSync(file)).toBe(false);
    });
  });

  it('a folder with mode 0755 is journal-dir-invalid', () => {
    withTemp(({ dir, file, repo }) => {
      chmodSync(dir, 0o755);
      expect(reasonOf(openJournal({ dir, repoRoot: repo, run: RUN }))).toBe('journal-dir-invalid');
      chmodSync(dir, 0o750);
      expect(reasonOf(openJournal({ dir, repoRoot: repo, run: RUN }))).toBe('journal-dir-invalid');
      expect(existsSync(file)).toBe(false);
    });
  });

  it('a plain file where the folder should be is journal-dir-invalid', () => {
    withTemp(({ root, repo }) => {
      const notDir = join(root, 'plain');
      writeFileSync(notDir, '');
      chmodSync(notDir, 0o700);
      expect(reasonOf(openJournal({ dir: notDir, repoRoot: repo, run: RUN }))).toBe('journal-dir-invalid');
    });
  });
});

describe('journal: the file', () => {
  it('a journal file with mode 0644 is journal-unwritable, and its mode is left as it was', () => {
    withTemp(({ dir, file, repo }) => {
      seed(file, '');
      chmodSync(file, 0o644);
      expect(reasonOf(openJournal({ dir, repoRoot: repo, run: RUN }))).toBe('journal-unwritable');
      expect(lstatSync(file).mode & 0o777).toBe(0o644);
    });
  });

  it('a journal file that is a link is journal-unwritable (the open does not follow it), and its target is unchanged', () => {
    withTemp(({ root, dir, file, repo }) => {
      const target = join(root, 'target.jsonl');
      seed(target, 'target text\n');
      symlinkSync(target, file);
      expect(reasonOf(openJournal({ dir, repoRoot: repo, run: RUN }))).toBe('journal-unwritable');
      expect(readFileSync(target, 'utf8')).toBe('target text\n');
      expect(lstatSync(file).isSymbolicLink()).toBe(true);
    });
  });

  it('a journal file with a second hard link is journal-unwritable', () => {
    withTemp(({ root, dir, file, repo }) => {
      seed(file, '');
      linkSync(file, join(root, 'second-name'));
      expect(reasonOf(openJournal({ dir, repoRoot: repo, run: RUN }))).toBe('journal-unwritable');
    });
  });

  it('a journal file larger than the cap is journal-full', () => {
    withTemp(({ dir, file, repo }) => {
      const text = expected(attempt(0));
      seed(file, text);
      expect(reasonOf(openJournal({ dir, repoRoot: repo, run: RUN, maxBytes: text.length - 1 }))).toBe('journal-full');
      const r = openJournal({ dir, repoRoot: repo, run: RUN, maxBytes: text.length });
      expect(reasonOf(r)).toBe('ok');
      if (r.ok) r.journal.close();
    });
  });

  it('a maxBytes above 1 MiB does not raise the cap', () => {
    withTemp(({ dir, file, repo }) => {
      seed(file, 'x'.repeat(MAX_JOURNAL_BYTES + 1));
      expect(reasonOf(openJournal({ dir, repoRoot: repo, run: RUN, maxBytes: 2 * MAX_JOURNAL_BYTES }))).toBe(
        'journal-full',
      );
      // At exactly the cap the size passes, and the text is then read and refused for its content.
      seed(file, 'x'.repeat(MAX_JOURNAL_BYTES));
      expect(reasonOf(openJournal({ dir, repoRoot: repo, run: RUN, maxBytes: 2 * MAX_JOURNAL_BYTES }))).toBe(
        'journal-corrupt',
      );
    });
  });

  it('a maxBytes or run id that is not usable is refused before anything on disk is looked at', () => {
    withTemp(({ dir, file, repo }) => {
      for (const maxBytes of [0, -1, 1.5, Number.NaN, '100', null]) {
        expect(reasonOf(openJournal({ dir, repoRoot: repo, run: RUN, maxBytes })), String(maxBytes)).toBe(
          'journal-dir-invalid',
        );
      }
      for (const run of [undefined, '', 'has space', 'a/b', 7, 'a'.repeat(65)]) {
        expect(reasonOf(openJournal({ dir, repoRoot: repo, run })), String(run)).toBe('value-not-allowed');
      }
      expect(existsSync(file)).toBe(false);
    });
  });
});

describe('journal: what is read back', () => {
  it('a torn last line is journal-corrupt', () => {
    withTemp(({ dir, file, repo }) => {
      const good = expected(attempt(0));
      seed(file, `${good}{"v":1,"run":"run-a"`);
      expect(reasonOf(openJournal({ dir, repoRoot: repo, run: RUN }))).toBe('journal-corrupt');
      seed(file, good.slice(0, -1));
      expect(reasonOf(openJournal({ dir, repoRoot: repo, run: RUN }))).toBe('journal-corrupt');
      // A byte order mark in front is not dropped: it makes the first line fail.
      seed(file, `﻿${good}`);
      expect(reasonOf(openJournal({ dir, repoRoot: repo, run: RUN }))).toBe('journal-corrupt');
    });
  });

  it('a line with a banned key is journal-corrupt', () => {
    withTemp(({ dir, file, repo }) => {
      const line =
        '{"v":1,"run":"run-a","att":0,"seq":0,"t":1700000000,"ev":"refused","reason":"no-go","nonce":"0x1"}\n';
      seed(file, line);
      expect(reasonOf(openJournal({ dir, repoRoot: repo, run: RUN }))).toBe('journal-corrupt');
      expect(readFileSync(file, 'utf8')).toBe(line);
    });
  });

  it('a seq gap is journal-corrupt', () => {
    withTemp(({ dir, file, repo }) => {
      const [a, b] = attempt(0);
      const lines = expected([a ?? {}]) + expected([b ?? {}], RUN, 2);
      seed(file, lines);
      expect(reasonOf(openJournal({ dir, repoRoot: repo, run: RUN }))).toBe('journal-corrupt');
    });
  });

  it('an unfinished intent is journal-unfinished-entry, listing it with last intent', () => {
    withTemp(({ dir, file, repo }) => {
      seed(file, expected(attempt(0)) + expected(attempt(1).slice(0, 1), RUN, 4));
      const r = openJournal({ dir, repoRoot: repo, run: RUN });
      expect(r).toEqual({
        ok: false,
        reason: 'journal-unfinished-entry',
        unfinished: [{ run: RUN, att: 1, last: 'intent' }],
      });
    });
  });

  it('an unfinished send-begin is journal-unfinished-entry, listing it with last send-begin', () => {
    withTemp(({ dir, file, repo }) => {
      seed(file, expected(attempt(0).slice(0, 3), 'run-old'));
      const r = openJournal({ dir, repoRoot: repo, run: RUN });
      expect(r).toEqual({
        ok: false,
        reason: 'journal-unfinished-entry',
        unfinished: [{ run: 'run-old', att: 0, last: 'send-begin' }],
      });
    });
  });

  it('the unfinished list holds only run, att and last, at open and from the handle', () => {
    withTemp(({ dir, file, repo }) => {
      seed(file, expected(attempt(0).slice(0, 2)));
      const r = openJournal({ dir, repoRoot: repo, run: RUN });
      expect(r.ok).toBe(false);
      if (r.ok || r.reason !== 'journal-unfinished-entry') return;
      for (const u of r.unfinished) expect(Object.keys(u)).toEqual(['run', 'att', 'last']);

      seed(file, '');
      const h = openJournal({ dir, repoRoot: repo, run: RUN });
      expect(h.ok).toBe(true);
      if (!h.ok) return;
      const [intent, signed] = attempt(0);
      expect(h.journal.append(intent)).toEqual({ ok: true });
      expect(h.journal.unfinished()).toEqual([{ run: RUN, att: 0, last: 'intent' }]);
      expect(h.journal.append(signed)).toEqual({ ok: true });
      const list = h.journal.unfinished();
      expect(list).toEqual([{ run: RUN, att: 0, last: 'signed' }]);
      for (const u of list) expect(Object.keys(u)).toEqual(['run', 'att', 'last']);
      h.journal.close();
    });
  });

  it('every refusal after the file is open closes it', () => {
    withTemp(({ dir, file, repo }) => {
      const before = openFds();
      seed(file, '');
      chmodSync(file, 0o644);
      expect(reasonOf(openJournal({ dir, repoRoot: repo, run: RUN }))).toBe('journal-unwritable');
      seed(file, expected(attempt(0)));
      expect(reasonOf(openJournal({ dir, repoRoot: repo, run: RUN, maxBytes: 10 }))).toBe('journal-full');
      seed(file, 'not a line\n');
      expect(reasonOf(openJournal({ dir, repoRoot: repo, run: RUN }))).toBe('journal-corrupt');
      seed(file, expected(attempt(0).slice(0, 1)));
      expect(reasonOf(openJournal({ dir, repoRoot: repo, run: RUN }))).toBe('journal-unfinished-entry');
      expect(openFds()).toBe(before);
      seed(file, '');
      const r = openJournal({ dir, repoRoot: repo, run: RUN });
      expect(r.ok).toBe(true);
      expect(openFds()).toBe(before + 1);
      if (r.ok) r.journal.close();
      expect(openFds()).toBe(before);
    });
  });
});

describe('journal: append', () => {
  it('journal-full on append writes nothing', () => {
    withTemp(({ dir, file, repo }) => {
      const [intent, signed] = attempt(0);
      const first = expected([intent ?? {}]);
      const r = openJournal({ dir, repoRoot: repo, run: RUN, maxBytes: first.length + 10 });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.journal.append(intent)).toEqual({ ok: true });
      expect(r.journal.append(signed)).toEqual({ ok: false, reason: 'journal-full' });
      expect(readFileSync(file, 'utf8')).toBe(first);
      r.journal.close();
    });
  });

  it('refuses before writing when the line rules or the order fail, and the handle still works after', () => {
    withTemp(({ dir, file, repo }) => {
      const r = openJournal({ dir, repoRoot: repo, run: RUN });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const [intent, signed, , outcome] = attempt(0);
      const bad: [unknown, string][] = [
        [{ ...signed, nonce: '0x1' }, 'key-not-allowed'],
        [{ ...signed, seq: 0 }, 'key-not-allowed'],
        [{ ...signed, run: RUN }, 'key-not-allowed'],
        [{ ...signed, v: 1 }, 'key-not-allowed'],
        [{ ...signed, fp: 'fp1:short' }, 'value-not-allowed'],
        [{ ...signed, ev: 'paid' }, 'event-invalid'],
        [null, 'value-not-allowed'],
        [[1], 'value-not-allowed'],
        [signed, 'order-invalid'],
        [outcome, 'order-invalid'],
      ];
      for (const [entry, want] of bad) {
        expect(r.journal.append(entry), JSON.stringify(entry)).toEqual({ ok: false, reason: want });
        expect(readFileSync(file).length).toBe(0);
      }
      // Nothing refused used up a seq: the first good line is seq 0.
      expect(r.journal.append(intent)).toEqual({ ok: true });
      expect(r.journal.append(intent)).toEqual({ ok: false, reason: 'order-invalid' });
      r.journal.close();
      expect(readFileSync(file, 'utf8')).toBe(expected([intent ?? {}]));
    });
  });

  it('is append-only: after many appends the earlier bytes are unchanged and the size only grows', () => {
    withTemp(({ dir, file, repo }) => {
      const r = openJournal({ dir, repoRoot: repo, run: RUN });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      let previous = Buffer.alloc(0);
      const all: Record<string, unknown>[] = [];
      for (let att = 0; att < 10; att++) {
        for (const x of attempt(att, T0 + att * 10)) {
          expect(r.journal.append(x)).toEqual({ ok: true });
          all.push(x);
          const now = readFileSync(file);
          expect(now.length > previous.length).toBe(true);
          expect(now.subarray(0, previous.length).equals(previous)).toBe(true);
          previous = now;
        }
      }
      r.journal.close();
      expect(readFileSync(file, 'utf8')).toBe(expected(all));
    });
  });

  it('after close, append returns journal-write-failed and writes nothing', () => {
    withTemp(({ dir, file, repo }) => {
      const r = openJournal({ dir, repoRoot: repo, run: RUN });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const [intent, signed] = attempt(0);
      expect(r.journal.append(intent)).toEqual({ ok: true });
      r.journal.close();
      r.journal.close();
      const text = readFileSync(file, 'utf8');
      expect(r.journal.append(signed)).toEqual({ ok: false, reason: 'journal-write-failed' });
      expect(r.journal.append(signed)).toEqual({ ok: false, reason: 'journal-write-failed' });
      expect(readFileSync(file, 'utf8')).toBe(text);
    });
  });
});

describe('journal: results', () => {
  it('no result holds the temp path or any error text', () => {
    withTemp(({ root, dir, file, repo }) => {
      const results: unknown[] = [];
      const add = (x: unknown) => results.push(x);
      add(openJournal({ dir: `${root}/missing`, repoRoot: repo, run: RUN }));
      add(openJournal({ dir: `${dir}/..`, repoRoot: repo, run: RUN }));
      add(openJournal({ dir, repoRoot: root, run: RUN }));
      const link = join(root, 'state-link');
      symlinkSync(dir, link);
      add(openJournal({ dir: link, repoRoot: repo, run: RUN }));
      seed(join(root, 'target'), '');
      symlinkSync(join(root, 'target'), file);
      add(openJournal({ dir, repoRoot: repo, run: RUN }));
      rmSync(file);
      seed(file, 'torn');
      add(openJournal({ dir, repoRoot: repo, run: RUN }));
      seed(file, expected(attempt(0).slice(0, 2)));
      add(openJournal({ dir, repoRoot: repo, run: RUN }));
      seed(file, '');
      const h = openJournal({ dir, repoRoot: repo, run: RUN });
      add(h);
      if (h.ok) {
        add(h.journal.append({ nonsense: true }));
        add(h.journal.append(attempt(0)[1]));
        add(h.journal.append(attempt(0)[0]));
        add(h.journal.unfinished());
        h.journal.close();
        add(h.journal.append(attempt(0)[1]));
      }
      expect(results.length).toBe(13);
      const text = JSON.stringify(results);
      expect(text.includes(root)).toBe(false);
      expect(text.includes(tmpdir())).toBe(false);
      expect(text.includes('/')).toBe(false);
      expect(/Error|errno|syscall|E[A-Z]{3,}|ENOENT|ELOOP|EACCES|EBADF/.test(text)).toBe(false);
    });
  });
});
