// Write failures in the journal, provoked without a real disk fault: node:fs is replaced for this file
// only by the real module with writeSync and fsyncSync wrapped. The wrappers pass every call through
// unless a test sets a fault: an EBADF error from writeSync, a short write (one byte really written,
// one reported), or an error from fsyncSync. Each call is counted, so a test can show that no write is
// tried after a failure. Temporary folders only, removed by the test that made them.
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JOURNAL_FILE_NAME, openJournal } from '../src/journal.js';

const fault = vi.hoisted(() => ({ mode: 'none' as 'none' | 'ebadf' | 'short' | 'fsync', writes: 0, fsyncs: 0 }));

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();
  const writeSync = ((fd: number, data: Uint8Array, ...rest: unknown[]) => {
    fault.writes += 1;
    if (fault.mode === 'ebadf') {
      const e = new Error('EBADF: bad file descriptor, write') as Error & { code: string };
      e.code = 'EBADF';
      throw e;
    }
    if (fault.mode === 'short') return real.writeSync(fd, data.subarray(0, 1));
    return (real.writeSync as (...a: unknown[]) => number)(fd, data, ...rest);
  }) as typeof real.writeSync;
  const fsyncSync = (fd: number) => {
    fault.fsyncs += 1;
    if (fault.mode === 'fsync') {
      const e = new Error('EIO: i/o error, fsync') as Error & { code: string };
      e.code = 'EIO';
      throw e;
    }
    real.fsyncSync(fd);
  };
  return { ...real, default: { ...real, writeSync, fsyncSync }, writeSync, fsyncSync };
});

const PREFIX = 'journal-test-';
const REPO = realpathSync(fileURLToPath(new URL('../../../', import.meta.url))).replace(/\/$/, '');
const RUN = 'run-a';
const FP = `fp1:${'B'.repeat(43)}`;
const INTENT = {
  ev: 'intent',
  att: 0,
  t: 1_700_000_000,
  network: 'eip155:84532',
  asset: `0x${'3'.repeat(40)}`,
  payTo: `0x${'2'.repeat(40)}`,
  value: '1000',
  validBefore: '1700000300',
  route: '/api/paid',
  fp: FP,
};
const SIGNED = { ev: 'signed', att: 0, t: 1_700_000_001, fp: FP };

function withJournal(fn: (j: { file: string; dir: string; root: string }) => void) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), PREFIX)));
  try {
    const dir = join(root, 'state');
    mkdirSync(dir);
    chmodSync(dir, 0o700);
    fn({ file: join(dir, JOURNAL_FILE_NAME), dir, root });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

afterEach(() => {
  fault.mode = 'none';
  fault.writes = 0;
  fault.fsyncs = 0;
});

describe('journal: write failures', () => {
  it('the wrappers pass calls through when no fault is set', () => {
    withJournal(({ dir, file }) => {
      const r = openJournal({ dir, repoRoot: REPO, run: RUN });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.journal.append(INTENT)).toEqual({ ok: true });
      expect([fault.writes, fault.fsyncs]).toEqual([1, 1]);
      r.journal.close();
      expect(readFileSync(file, 'utf8').endsWith('}\n')).toBe(true);
    });
  });

  it('an EBADF from the write gives journal-write-failed, and a second append tries no write', () => {
    withJournal(({ dir, file, root }) => {
      const r = openJournal({ dir, repoRoot: REPO, run: RUN });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.journal.append(INTENT)).toEqual({ ok: true });
      const text = readFileSync(file, 'utf8');
      fault.mode = 'ebadf';
      const first = r.journal.append(SIGNED);
      expect(first).toEqual({ ok: false, reason: 'journal-write-failed' });
      expect(fault.writes).toBe(2);
      fault.mode = 'none';
      expect(r.journal.append(SIGNED)).toEqual({ ok: false, reason: 'journal-write-failed' });
      expect(fault.writes).toBe(2);
      expect(readFileSync(file, 'utf8')).toBe(text);
      const json = JSON.stringify(first);
      expect(json.includes(root) || /EBADF|Error/.test(json)).toBe(false);
      r.journal.close();
    });
  });

  it('a short write gives journal-write-failed, no fsync and no second try; the torn line is caught at the next open', () => {
    withJournal(({ dir, file }) => {
      const r = openJournal({ dir, repoRoot: REPO, run: RUN });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      fault.mode = 'short';
      expect(r.journal.append(INTENT)).toEqual({ ok: false, reason: 'journal-write-failed' });
      expect([fault.writes, fault.fsyncs]).toEqual([1, 0]);
      const torn = readFileSync(file, 'utf8');
      expect(torn).toBe('{');
      fault.mode = 'none';
      expect(r.journal.append(INTENT)).toEqual({ ok: false, reason: 'journal-write-failed' });
      expect(fault.writes).toBe(1);
      expect(readFileSync(file, 'utf8')).toBe(torn);
      const again = openJournal({ dir, repoRoot: REPO, run: RUN });
      expect(again).toEqual({ ok: false, reason: 'journal-corrupt' });
    });
  });

  it('an fsync failure gives journal-write-failed, and a second append tries no write', () => {
    withJournal(({ dir, file }) => {
      const r = openJournal({ dir, repoRoot: REPO, run: RUN });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      fault.mode = 'fsync';
      expect(r.journal.append(INTENT)).toEqual({ ok: false, reason: 'journal-write-failed' });
      expect([fault.writes, fault.fsyncs]).toEqual([1, 1]);
      const text = readFileSync(file, 'utf8');
      fault.mode = 'none';
      expect(r.journal.append(SIGNED)).toEqual({ ok: false, reason: 'journal-write-failed' });
      expect([fault.writes, fault.fsyncs]).toEqual([1, 1]);
      expect(readFileSync(file, 'utf8')).toBe(text);
    });
  });
});
