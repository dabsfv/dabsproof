// The pure rules for the payment journal's lines: which keys a line may hold, the shape of each value,
// which keys each event must and may have, the order of events, and which attempts were left
// unfinished. No file, no clock, no randomness and no Node built-in. A line holds only the keys listed
// here; anything else, a signature, nonce, digest, header, key, salt, from or validAfter included, is
// refused rather than dropped, so a mistake is loud. No string value may hold a run of 64 or more hex
// characters (secret-shaped). A journal that does not parse cleanly, a line torn by a crash included,
// is refused as a whole: it is never skipped over. Nothing in the runner uses this file yet.
import { BASE_SEPOLIA } from '@dabsproof/registry';

export const JOURNAL_VERSION = 1;
export const MAX_LINE_BYTES = 1024;
export const JOURNAL_EVENTS = ['intent', 'signed', 'send-begin', 'outcome', 'refused'] as const;
export type JournalEvent = (typeof JOURNAL_EVENTS)[number];
export const JOURNAL_RESULTS = ['paid', 'payment-refused', 'send-failed', 'could-not-verify'] as const;
export type JournalReason =
  | 'key-not-allowed'
  | 'value-not-allowed'
  | 'event-invalid'
  | 'line-too-long'
  | 'line-corrupt'
  | 'order-invalid';

/** Every key a line may ever hold, in the order it is written. */
const KEY_ORDER = [
  'v',
  'run',
  'att',
  'seq',
  't',
  'ev',
  'network',
  'asset',
  'payTo',
  'value',
  'validBefore',
  'route',
  'fp',
  'result',
  'reason',
  'status',
] as const;
type JournalKey = (typeof KEY_ORDER)[number];
const BASE_KEYS: readonly JournalKey[] = ['v', 'run', 'att', 'seq', 't', 'ev'];

/** Which keys each event must have, and which it may have as well. */
const EVENT_KEYS: Readonly<Record<JournalEvent, { required: readonly JournalKey[]; optional: readonly JournalKey[] }>> =
  Object.freeze({
    intent: { required: ['network', 'asset', 'payTo', 'value', 'validBefore', 'route', 'fp'], optional: [] },
    signed: { required: ['fp'], optional: [] },
    'send-begin': { required: ['fp'], optional: [] },
    outcome: { required: ['fp', 'result'], optional: ['status', 'reason'] },
    refused: { required: ['reason'], optional: ['route'] },
  });

export type JournalEntry = Readonly<Partial<Record<JournalKey, string | number>>>;
export type BuildResult = { ok: true; line: string } | { ok: false; reason: JournalReason };

const SECRET_SHAPED = /[0-9a-fA-F]{64}/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const DECIMAL = /^(?:0|[1-9][0-9]{0,77})$/;
const FP1 = /^fp1:[A-Za-z0-9_-]{43}$/;
const isCount = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const isRoute = (v: unknown) =>
  typeof v === 'string' && /^\/[!-~]{0,127}$/.test(v) && !v.startsWith('//') && !v.includes('?') && !v.includes('#');
const isReason = (v: unknown) =>
  typeof v === 'string' && /^[a-z0-9-]{3,64}$/.test(v) && !/^[0-9a-f]+$/.test(v.replaceAll('-', ''));

/** One shape check per key. */
const VALUE_OK: Readonly<Record<JournalKey, (v: unknown) => boolean>> = Object.freeze({
  v: (v) => v === JOURNAL_VERSION,
  run: (v) => typeof v === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(v),
  att: isCount,
  seq: isCount,
  t: isCount,
  ev: (v) => typeof v === 'string' && (JOURNAL_EVENTS as readonly string[]).includes(v),
  network: (v) => v === BASE_SEPOLIA,
  asset: (v) => typeof v === 'string' && ADDRESS.test(v),
  payTo: (v) => typeof v === 'string' && ADDRESS.test(v),
  value: (v) => typeof v === 'string' && DECIMAL.test(v),
  validBefore: (v) => typeof v === 'string' && DECIMAL.test(v),
  route: isRoute,
  fp: (v) => typeof v === 'string' && FP1.test(v),
  result: (v) => typeof v === 'string' && (JOURNAL_RESULTS as readonly string[]).includes(v),
  reason: isReason,
  status: (v) => typeof v === 'number' && Number.isInteger(v) && v >= 100 && v <= 599,
});

const isKey = (k: string): k is JournalKey => (KEY_ORDER as readonly string[]).includes(k);

/** Checks one entry (v given or not) and returns it in key order, or a reason code. */
function check(
  entry: unknown,
): { ok: true; ordered: Record<string, string | number> } | { ok: false; reason: JournalReason } {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry))
    return { ok: false, reason: 'value-not-allowed' };
  // Each value is read once, into a copy, so it cannot change between its check and its use.
  const copy: Record<string, unknown> = {};
  for (const k of Object.keys(entry)) copy[k] = (entry as Record<string, unknown>)[k];
  for (const k of Object.keys(copy)) if (!isKey(k)) return { ok: false, reason: 'key-not-allowed' };
  if (!('v' in copy)) copy.v = JOURNAL_VERSION;
  const ev = copy.ev;
  if (typeof ev !== 'string' || !(JOURNAL_EVENTS as readonly string[]).includes(ev)) {
    return { ok: false, reason: 'event-invalid' };
  }
  const rule = EVENT_KEYS[ev as JournalEvent];
  const allowed = new Set<string>([...BASE_KEYS, ...rule.required, ...rule.optional]);
  for (const k of [...BASE_KEYS, ...rule.required]) if (!(k in copy)) return { ok: false, reason: 'key-not-allowed' };
  for (const k of Object.keys(copy)) if (!allowed.has(k)) return { ok: false, reason: 'key-not-allowed' };
  const ordered: Record<string, string | number> = {};
  for (const k of KEY_ORDER) {
    if (!(k in copy)) continue;
    const v = copy[k];
    if (!VALUE_OK[k](v)) return { ok: false, reason: 'value-not-allowed' };
    if (typeof v === 'string' && SECRET_SHAPED.test(v)) return { ok: false, reason: 'value-not-allowed' };
    ordered[k] = v as string | number;
  }
  return { ok: true, ordered };
}

/** One journal line: JSON text plus a newline, keys in a fixed order, at most MAX_LINE_BYTES bytes. */
export function buildLine(entry: unknown): BuildResult {
  try {
    const c = check(entry);
    if (!c.ok) return c;
    const line = `${JSON.stringify(c.ordered)}\n`;
    if (new TextEncoder().encode(line).length > MAX_LINE_BYTES) return { ok: false, reason: 'line-too-long' };
    return { ok: true, line };
  } catch {
    return { ok: false, reason: 'value-not-allowed' };
  }
}

/**
 * Reads a whole journal. Every line must be exactly what buildLine would write for it; a line that
 * does not parse, fails a check, is blank, or is torn (no newline at the end) makes the whole journal
 * line-corrupt. An empty text is an empty journal.
 */
export function parseJournal(
  text: unknown,
): { ok: true; entries: JournalEntry[] } | { ok: false; reason: 'line-corrupt' } {
  if (typeof text !== 'string') return { ok: false, reason: 'line-corrupt' };
  if (text === '') return { ok: true, entries: [] };
  if (!text.endsWith('\n')) return { ok: false, reason: 'line-corrupt' };
  const entries: JournalEntry[] = [];
  for (const raw of text.slice(0, -1).split('\n')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, reason: 'line-corrupt' };
    }
    const rebuilt = buildLine(parsed);
    if (!rebuilt.ok || rebuilt.line !== `${raw}\n`) return { ok: false, reason: 'line-corrupt' };
    entries.push(Object.freeze(JSON.parse(raw) as JournalEntry));
  }
  return { ok: true, entries };
}

type AttemptState = 'none' | 'intent' | 'signed' | 'send-begin' | 'closed';
/** The events allowed after each state, and the state each one leads to. */
const NEXT: Readonly<Record<AttemptState, Partial<Record<JournalEvent, AttemptState>>>> = Object.freeze({
  none: { intent: 'intent', refused: 'closed' },
  intent: { signed: 'signed', refused: 'closed' },
  signed: { 'send-begin': 'send-begin', refused: 'closed' },
  'send-begin': { outcome: 'closed' },
  closed: {},
});
const attemptKey = (e: JournalEntry) => `${String(e.run)}/${String(e.att)}`;

/**
 * Within each run, seq starts at 0 and rises by 1. Each attempt goes intent, signed, send-begin,
 * outcome; refused may close it from no line, intent or signed, never after send-begin; nothing
 * follows a closing line. For entries that came from parseJournal.
 */
export function checkOrder(entries: readonly JournalEntry[]): { ok: true } | { ok: false; reason: 'order-invalid' } {
  const nextSeq = new Map<string, number>();
  const state = new Map<string, AttemptState>();
  for (const e of entries) {
    const run = String(e.run);
    if (e.seq !== (nextSeq.get(run) ?? 0)) return { ok: false, reason: 'order-invalid' };
    nextSeq.set(run, (e.seq as number) + 1);
    const key = attemptKey(e);
    const to = NEXT[state.get(key) ?? 'none'][e.ev as JournalEvent];
    if (to === undefined) return { ok: false, reason: 'order-invalid' };
    state.set(key, to);
  }
  return { ok: true };
}

/** Every attempt that has an intent but no closing line (outcome or refused), with its last event. */
export function findUnfinished(entries: readonly JournalEntry[]): { run: string; att: number; last: JournalEvent }[] {
  const open = new Map<string, { run: string; att: number; last: JournalEvent }>();
  for (const e of entries) {
    const key = attemptKey(e);
    const ev = e.ev as JournalEvent;
    if (ev === 'intent') open.set(key, { run: String(e.run), att: e.att as number, last: ev });
    else if (ev === 'outcome' || ev === 'refused') open.delete(key);
    else {
      const o = open.get(key);
      if (o) o.last = ev;
    }
  }
  return [...open.values()].map((o) => ({ run: o.run, att: o.att, last: o.last }));
}
