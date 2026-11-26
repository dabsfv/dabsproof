// The payment journal on disk: one append-only file, journal.jsonl, in a folder the caller names. It is
// opened, read back through the line rules in journal-format.ts, and added to one whole line at a time,
// each line written once and flushed to disk (fsync) before append returns. Nothing here signs, holds
// a key, sends anything, or reads the environment. This code never creates the folder, and never
// deletes, shortens, renames or changes the mode of the file: the only file calls are open, fstat,
// lstat, read, write, fsync and close.
//
// Before anything is written, the folder must be a plain absolute path outside the repo folder and
// outside the product's own config folder, and must already exist as a real folder (not a link), owned
// by the current user, with mode exactly 0700. The file is opened without following a link, and the
// open file must be a plain file owned by the current user, with mode exactly 0600, one hard link, and
// the same device and inode as the path right after the open. A journal larger than the cap (1 MiB, or
// a lower cap the caller sets), one that does not parse cleanly, one whose order is broken, or one
// with an attempt that has no closing line is refused, and the file is closed again. No result holds
// a path, an error message or a line's values; only reason codes, and for unfinished attempts their
// run, att and last event.
//
// Known limits. There is no lock: two processes could open the same journal at once (Node has no
// flock, and a lock file would need a delete). A second writer's lines would break the order and be
// caught as journal-corrupt at the next open, so a later run fails closed, but runs already open do
// not see them. Folders above the journal folder are not looked at, so whether one of them is a link
// could not be verified here. The folder is checked again after the open, by device and inode, but a
// folder swapped and swapped back between the two looks could not be seen. Nothing in the runner uses
// this file yet.
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, readSync, writeSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { brand } from '@dabsproof/brand';
import {
  buildLine,
  checkOrder,
  findUnfinished,
  JOURNAL_VERSION,
  type JournalEntry,
  type JournalEvent,
  type JournalReason,
  parseJournal,
} from './journal-format.js';

export const JOURNAL_FILE_NAME = 'journal.jsonl';
/** The largest journal this code opens or grows: a caller may lower it, never raise it. */
export const MAX_JOURNAL_BYTES = 1024 * 1024;
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

export type JournalOpenReason =
  | 'journal-dir-invalid'
  | 'journal-in-repo'
  | 'journal-unwritable'
  | 'journal-full'
  | 'journal-corrupt'
  | 'value-not-allowed';
type FormatReason = 'key-not-allowed' | 'value-not-allowed' | 'event-invalid' | 'line-too-long';
export type JournalAppendReason = FormatReason | 'order-invalid' | 'journal-full' | 'journal-write-failed';
export type UnfinishedAttempt = { run: string; att: number; last: JournalEvent };

export interface JournalOptions {
  /** The folder the journal lives in: absolute, already there, mode 0700, outside repoRoot. */
  dir: unknown;
  /** The repo folder, so that dir can be kept out of it. */
  repoRoot: unknown;
  /** This run's id, written on every line it appends. */
  run: unknown;
  /** A lower cap than MAX_JOURNAL_BYTES; a higher one is cut down to MAX_JOURNAL_BYTES. */
  maxBytes?: unknown;
}

export interface JournalHandle {
  /** The caller gives ev, att, t and the event's own keys; v, run and seq are added here. */
  append: (entry: unknown) => { ok: true } | { ok: false; reason: JournalAppendReason };
  /** Attempts with no closing line: none at open (the open is refused otherwise), plus any since. */
  unfinished: () => UnfinishedAttempt[];
  /** Closes the file; every later append returns journal-write-failed. */
  close: () => void;
}

export type JournalOpenResult =
  | { ok: true; journal: JournalHandle }
  | { ok: false; reason: JournalOpenReason }
  | { ok: false; reason: 'journal-unfinished-entry'; unfinished: UnfinishedAttempt[] };

/**
 * A plain absolute path as text: starts with /, no backslash or NUL, and no empty, "." or ".."
 * segment (so no doubled or trailing slash). Says nothing about where the path really leads.
 */
function isPlainAbsolute(p: unknown): p is string {
  if (typeof p !== 'string' || p === '' || p.includes('\0') || p.includes('\\') || !isAbsolute(p)) return false;
  if (!p.startsWith('/')) return false;
  return p
    .slice(1)
    .split('/')
    .every((s) => s !== '' && s !== '.' && s !== '..');
}

/** True if dir is the repo folder or lies inside it, compared as text and ignoring case. */
function insideRepo(dir: string, repoRoot: string): boolean {
  const x = dir.toLowerCase();
  const y = repoRoot.toLowerCase();
  return x === y || x.startsWith(`${y}/`);
}

/** The product's own config folder name: the last part of brand.configDir, as text, in lower case. */
const CONFIG_FOLDER = (brand.configDir.split('/').pop() ?? '').toLowerCase();

/** True if the path holds a ".config" segment followed at once by the config folder name, ignoring case. */
function namesOwnConfigDir(p: string): boolean {
  if (CONFIG_FOLDER === '') return true;
  const s = p.toLowerCase().split('/');
  return s.some((seg, i) => seg === '.config' && s[i + 1] === CONFIG_FOLDER);
}

const FORMAT_REASONS: readonly string[] = ['key-not-allowed', 'value-not-allowed', 'event-invalid', 'line-too-long'];
/** buildLine gives only format reasons; anything else is reported as value-not-allowed. */
const formatReason = (r: JournalReason): FormatReason =>
  FORMAT_REASONS.includes(r) ? (r as FormatReason) : 'value-not-allowed';

const unfinishedOf = (entries: readonly JournalEntry[]): UnfinishedAttempt[] =>
  findUnfinished(entries).map((u) => ({ run: u.run, att: u.att, last: u.last }));

/** Runs every check in order; the first that fails gives its reason, and no handle is returned. */
export function openJournal(options: JournalOptions): JournalOpenResult {
  // Each option is read once, so a value cannot change between its check and its use.
  let dir: unknown;
  let repoRoot: unknown;
  let run: unknown;
  let maxGiven: unknown;
  try {
    ({ dir, repoRoot, run, maxBytes: maxGiven } = options);
  } catch {
    return { ok: false, reason: 'journal-dir-invalid' };
  }

  // 1 to 3: the folder's text, before anything on disk is looked at.
  if (!isPlainAbsolute(dir)) return { ok: false, reason: 'journal-dir-invalid' };
  if (!isPlainAbsolute(repoRoot)) return { ok: false, reason: 'journal-dir-invalid' };
  if (insideRepo(dir, repoRoot)) return { ok: false, reason: 'journal-in-repo' };
  if (namesOwnConfigDir(dir)) return { ok: false, reason: 'journal-dir-invalid' };

  // The run id must pass the line rules; a refused line of this run is built and thrown away.
  const probe = buildLine({ run, att: 0, seq: 0, t: 0, ev: 'refused', reason: 'run-check' });
  if (!probe.ok) return { ok: false, reason: 'value-not-allowed' };
  const runId = run as string;
  let maxBytes = MAX_JOURNAL_BYTES;
  if (maxGiven !== undefined) {
    if (typeof maxGiven !== 'number' || !Number.isSafeInteger(maxGiven) || maxGiven < 1) {
      return { ok: false, reason: 'journal-dir-invalid' };
    }
    maxBytes = Math.min(maxGiven, MAX_JOURNAL_BYTES);
  }

  const uid = typeof process.getuid === 'function' ? process.getuid() : -1;
  const NOFOLLOW = constants.O_NOFOLLOW;
  if (uid < 0 || typeof NOFOLLOW !== 'number' || NOFOLLOW === 0) return { ok: false, reason: 'journal-dir-invalid' };

  // 4: the folder, by metadata only.
  let folder: ReturnType<typeof lstatSync>;
  try {
    folder = lstatSync(dir, { throwIfNoEntry: false });
  } catch {
    return { ok: false, reason: 'journal-dir-invalid' };
  }
  if (
    folder === undefined ||
    folder.isSymbolicLink() ||
    !folder.isDirectory() ||
    folder.uid !== uid ||
    (folder.mode & 0o7777) !== DIR_MODE
  ) {
    return { ok: false, reason: 'journal-dir-invalid' };
  }

  // 5: the file. A link at the file's own name makes the open fail (no link is followed).
  const file = join(dir, JOURNAL_FILE_NAME);
  let fd: number;
  try {
    fd = openSync(file, constants.O_RDWR | constants.O_APPEND | constants.O_CREAT | NOFOLLOW, FILE_MODE);
  } catch {
    return { ok: false, reason: 'journal-unwritable' };
  }
  // 8: every refusal from here on closes the file first.
  const closeQuietly = () => {
    try {
      closeSync(fd);
    } catch {
      // Nothing more can be done with it; the refusal stands.
    }
  };
  const refuse = <R extends JournalOpenReason>(reason: R): { ok: false; reason: R } => {
    closeQuietly();
    return { ok: false, reason };
  };

  let total = 0;
  let bytes: Uint8Array;
  try {
    const open = fstatSync(fd);
    if (!open.isFile() || open.uid !== uid || (open.mode & 0o7777) !== FILE_MODE || open.nlink !== 1) {
      return refuse('journal-unwritable');
    }
    // The path must still lead to the file that was opened, and the folder must be the one checked.
    const atPath = lstatSync(file, { throwIfNoEntry: false });
    if (atPath === undefined || atPath.isSymbolicLink() || atPath.dev !== open.dev || atPath.ino !== open.ino) {
      return refuse('journal-unwritable');
    }
    const again = lstatSync(dir, { throwIfNoEntry: false });
    if (
      again === undefined ||
      again.isSymbolicLink() ||
      !again.isDirectory() ||
      again.dev !== folder.dev ||
      again.ino !== folder.ino
    ) {
      return refuse('journal-dir-invalid');
    }
    // 6: the size, before anything is read.
    if (open.size > maxBytes) return refuse('journal-full');
    // 7: the whole file, from position 0, through the same descriptor; one byte more than the cap at most.
    bytes = new Uint8Array(maxBytes + 1);
    for (;;) {
      const n = readSync(fd, bytes, total, bytes.length - total, total);
      if (n === 0) break;
      total += n;
      if (total >= bytes.length) break;
    }
  } catch {
    return refuse('journal-unwritable');
  }
  if (total > maxBytes) return refuse('journal-full');

  let text: string;
  try {
    // A byte order mark is kept, so that it fails the line rules rather than being dropped.
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, total));
  } catch {
    return refuse('journal-corrupt');
  }
  const parsed = parseJournal(text);
  if (!parsed.ok) return refuse('journal-corrupt');
  if (!checkOrder(parsed.entries).ok) return refuse('journal-corrupt');
  const left = unfinishedOf(parsed.entries);
  if (left.length > 0) {
    closeQuietly();
    return { ok: false, reason: 'journal-unfinished-entry', unfinished: left };
  }

  const entries: JournalEntry[] = [...parsed.entries];
  let size = total;
  // After checkOrder, this run's seq values are 0, 1, 2 and so on, so the next one is their count.
  let seq = entries.filter((e) => e.run === runId).length;
  let usable = true;
  let fdOpen = true;
  const shut = () => {
    usable = false;
    if (!fdOpen) return;
    fdOpen = false;
    try {
      closeSync(fd);
    } catch {
      // Already unusable; nothing more to do.
    }
  };
  const writeFailed = () => {
    shut();
    return { ok: false as const, reason: 'journal-write-failed' as const };
  };

  const append: JournalHandle['append'] = (entry) => {
    if (!usable) return { ok: false, reason: 'journal-write-failed' };
    const copy: Record<string, unknown> = {};
    try {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        return { ok: false, reason: 'value-not-allowed' };
      }
      for (const k of Object.keys(entry)) copy[k] = (entry as Record<string, unknown>)[k];
    } catch {
      return { ok: false, reason: 'value-not-allowed' };
    }
    // v, run and seq are this file's to give.
    if ('v' in copy || 'run' in copy || 'seq' in copy) return { ok: false, reason: 'key-not-allowed' };
    const built = buildLine({ ...copy, v: JOURNAL_VERSION, run: runId, seq });
    if (!built.ok) return { ok: false, reason: formatReason(built.reason) };
    const next = Object.freeze(JSON.parse(built.line) as JournalEntry);
    if (!checkOrder([...entries, next]).ok) return { ok: false, reason: 'order-invalid' };
    const line = new TextEncoder().encode(built.line);
    if (size + line.length > maxBytes) return { ok: false, reason: 'journal-full' };
    // One write of the whole line, then fsync. Any error or short write leaves the handle unusable,
    // with no second try.
    try {
      if (writeSync(fd, line) !== line.length) return writeFailed();
      fsyncSync(fd);
    } catch {
      return writeFailed();
    }
    entries.push(next);
    size += line.length;
    seq += 1;
    return { ok: true };
  };

  const journal: JournalHandle = Object.freeze({
    append,
    unfinished: () => unfinishedOf(entries),
    close: shut,
  });
  return { ok: true, journal };
}
