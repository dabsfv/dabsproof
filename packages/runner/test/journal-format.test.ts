// The journal's line rules. Values are clearly fake: repeated-digit addresses, a fingerprint of 43
// letters A, and secret-shaped hex built at run time from repeats. No key, signature or real nonce.
import { describe, expect, it } from 'vitest';
import {
  buildLine,
  checkOrder,
  findUnfinished,
  type JournalEntry,
  MAX_LINE_BYTES,
  parseJournal,
} from '../src/journal-format.js';

const FP = `fp1:${'A'.repeat(43)}`;
const ADDR = `0x${'2'.repeat(40)}`;
const TOKEN = `0x${'3'.repeat(40)}`;
// Spaces make it invalid for every field and as a key name, so no line can hold it.
const MARK = 'zz input marker zz';
const INTENT = {
  network: 'eip155:84532',
  asset: TOKEN,
  payTo: ADDR,
  value: '1000',
  validBefore: '1700000300',
  route: '/api/paid',
  fp: FP,
};
const PER_EVENT: Record<string, Record<string, unknown>> = {
  intent: INTENT,
  signed: { fp: FP },
  'send-begin': { fp: FP },
  outcome: { fp: FP, result: 'paid', status: 200 },
  refused: { reason: 'amount-over-run-cap' },
};
const e = (
  ev: string,
  seq: number,
  att = 0,
  run = 'run-1',
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  run,
  att,
  seq,
  t: 1_700_000_000 + seq,
  ev,
  ...PER_EVENT[ev],
  ...extra,
});
const reasonOf = (r: { ok: boolean; reason?: string }) => (r.ok ? 'ok' : r.reason);
const journal = (...entries: Record<string, unknown>[]) =>
  entries
    .map((x) => {
      const r = buildLine(x);
      if (!r.ok) throw new Error(r.reason);
      return r.line;
    })
    .join('');
const parsed = (...entries: Record<string, unknown>[]): JournalEntry[] => {
  const r = parseJournal(journal(...entries));
  if (!r.ok) throw new Error(r.reason);
  return r.entries;
};

describe('journal lines: building', () => {
  it('builds a good line for each event', () => {
    for (const ev of ['intent', 'signed', 'send-begin', 'outcome', 'refused']) {
      const r = buildLine(e(ev, 0));
      expect(r.ok, ev).toBe(true);
      if (r.ok) expect(r.line.endsWith('}\n')).toBe(true);
    }
    expect(reasonOf(buildLine(e('outcome', 0, 0, 'run-1', { status: undefined, reason: 'send-timed-out' })))).toBe(
      'value-not-allowed',
    );
    const { status: _s, ...noStatus } = e('outcome', 0, 0, 'run-1', { result: 'could-not-verify', reason: 'no-reply' });
    expect(reasonOf(buildLine(noStatus))).toBe('ok');
    expect(reasonOf(buildLine(e('refused', 0, 0, 'run-1', { route: '/api/alpha' })))).toBe('ok');
  });
  it('writes the exact text, keys in a fixed order, with v 1 added', () => {
    const r = buildLine({ fp: FP, ev: 'signed', t: 1700000001, seq: 1, att: 0, run: 'run-1' });
    expect(r).toEqual({
      ok: true,
      line: '{"v":1,"run":"run-1","att":0,"seq":1,"t":1700000001,"ev":"signed","fp":"fp1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}\n',
    });
  });
  it('key-not-allowed: an unknown key, a missing required key, or a key the event may not have', () => {
    expect(reasonOf(buildLine(e('signed', 0, 0, 'run-1', { extra: 1 })))).toBe('key-not-allowed');
    const { fp: _f, ...noFp } = e('signed', 0);
    expect(reasonOf(buildLine(noFp))).toBe('key-not-allowed');
    const { run: _r, ...noRun } = e('signed', 0);
    expect(reasonOf(buildLine(noRun))).toBe('key-not-allowed');
    expect(reasonOf(buildLine(e('signed', 0, 0, 'run-1', { payTo: ADDR })))).toBe('key-not-allowed');
    expect(reasonOf(buildLine(e('refused', 0, 0, 'run-1', { fp: FP })))).toBe('key-not-allowed');
  });
  it('refuses every banned key by name, never dropping it', () => {
    for (const k of ['signature', 'nonce', 'digest', 'header', 'key', 'salt', 'from', 'validAfter']) {
      expect(reasonOf(buildLine(e('intent', 0, 0, 'run-1', { [k]: 'x' }))), k).toBe('key-not-allowed');
    }
  });
  it('value-not-allowed: a bad value for each key', () => {
    const bad: [string, string, unknown][] = [
      ['signed', 'v', 2],
      ['signed', 'run', 'run 1'],
      ['signed', 'run', 'r'.repeat(65)],
      ['signed', 'att', -1],
      ['signed', 'seq', 1.5],
      ['signed', 't', '1'],
      ['intent', 'network', 'eip155:8453'],
      ['intent', 'asset', '0x12'],
      ['intent', 'payTo', ADDR.slice(0, 41)],
      ['intent', 'value', '01'],
      ['intent', 'validBefore', '-1'],
      ['intent', 'route', 'api/paid'],
      ['intent', 'route', '/api/paid?x=1'],
      ['intent', 'route', '/api#x'],
      ['intent', 'route', '//host.example/x'],
      ['intent', 'route', `/${'a'.repeat(128)}`],
      ['intent', 'route', '/a b'],
      ['signed', 'fp', 'fp2:abc'],
      ['signed', 'fp', `fp1:${'A'.repeat(42)}`],
      ['outcome', 'result', 'ok'],
      ['outcome', 'reason', 'AB'],
      ['outcome', 'reason', 'deadbeef'],
      ['outcome', 'reason', 'dead-beef-00'],
      ['outcome', 'status', 99],
      ['outcome', 'status', 600],
    ];
    for (const [ev, k, v] of bad)
      expect(reasonOf(buildLine(e(ev, 0, 0, 'run-1', { [k]: v }))), `${k}`).toBe('value-not-allowed');
  });
  it('v is filled in only when missing: a v that is present but undefined or null is refused', () => {
    expect(reasonOf(buildLine(e('signed', 0)))).toBe('ok');
    expect(reasonOf(buildLine(e('signed', 0, 0, 'run-1', { v: 1 })))).toBe('ok');
    expect(reasonOf(buildLine(e('signed', 0, 0, 'run-1', { v: undefined })))).toBe('value-not-allowed');
    expect(reasonOf(buildLine(e('signed', 0, 0, 'run-1', { v: null })))).toBe('value-not-allowed');
  });
  it('a secret-shaped value (64 or 130 hex characters) in any string field is refused', () => {
    const hex64 = 'ab'.repeat(32);
    const hex130 = 'cd'.repeat(65);
    const fields: [string, string, string][] = [
      ['signed', 'run', hex64],
      ['intent', 'value', '1'.repeat(64)],
      ['intent', 'validBefore', '7'.repeat(70)],
      ['intent', 'route', `/x/${hex64}`],
      ['intent', 'route', `/x/${hex130}`],
      ['outcome', 'reason', hex64],
      ['intent', 'network', hex64],
      ['intent', 'asset', `0x${hex64}`],
      ['intent', 'payTo', `0x${hex64}`],
      ['signed', 'fp', `fp1:${hex64}`],
      ['outcome', 'result', hex64],
    ];
    for (const [ev, k, v] of fields)
      expect(reasonOf(buildLine(e(ev, 0, 0, 'run-1', { [k]: v }))), k).toBe('value-not-allowed');
  });
  it('event-invalid: a missing or unknown event', () => {
    for (const ev of [undefined, 'start', 'INTENT', 3]) {
      expect(reasonOf(buildLine({ ...e('signed', 0), ev }))).toBe('event-invalid');
    }
  });
  it('line-too-long: the cap is 1024 bytes, and the longest line the value rules allow stays under it', () => {
    expect(MAX_LINE_BYTES).toBe(1024);
    const longest = buildLine({
      run: 'r'.repeat(64),
      att: Number.MAX_SAFE_INTEGER,
      seq: Number.MAX_SAFE_INTEGER,
      t: Number.MAX_SAFE_INTEGER,
      ev: 'intent',
      ...INTENT,
      value: '9'.repeat(63),
      validBefore: '9'.repeat(63),
      route: `/${'p'.repeat(127)}`,
    });
    expect(longest.ok && longest.line.length <= MAX_LINE_BYTES).toBe(true);
  });
  it('never throws, and no result holds any input text', () => {
    const throwing = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error(MARK);
        },
      },
    );
    const cases: unknown[] = [
      null,
      42,
      MARK,
      [],
      throwing,
      ...['run', 'ev', 'route', 'reason', MARK].map((k) => e('signed', 0, 0, 'run-1', { [k]: MARK })),
    ];
    for (const c of cases) {
      let r: unknown;
      expect(() => {
        r = buildLine(c);
      }).not.toThrow();
      expect((r as { ok: boolean }).ok).toBe(false);
      expect(JSON.stringify(r).includes(MARK)).toBe(false);
    }
  });
});

describe('journal lines: parsing', () => {
  const good = journal(e('intent', 0), e('signed', 1), e('send-begin', 2), e('outcome', 3));
  it('reads a good journal', () => {
    const r = parseJournal(good);
    expect(r.ok && r.entries.map((x) => x.ev)).toEqual(['intent', 'signed', 'send-begin', 'outcome']);
  });
  it('an empty text is an empty journal', () => {
    expect(parseJournal('')).toEqual({ ok: true, entries: [] });
  });
  it('line-corrupt: a last line torn in the middle', () => {
    expect(parseJournal(good.slice(0, good.length - 20))).toEqual({ ok: false, reason: 'line-corrupt' });
    expect(parseJournal(good.slice(0, -1))).toEqual({ ok: false, reason: 'line-corrupt' });
  });
  it('line-corrupt: a line with an extra key', () => {
    const extra = good.replace('"ev":"signed"', '"ev":"signed","nonce":"x"');
    expect(parseJournal(extra)).toEqual({ ok: false, reason: 'line-corrupt' });
  });
  it('line-corrupt: a blank line in the middle', () => {
    const lines = good.split('\n');
    expect(parseJournal([lines[0], '', ...lines.slice(1)].join('\n'))).toEqual({ ok: false, reason: 'line-corrupt' });
  });
  it('line-corrupt: a line over 1024 bytes, a line not in the written form, or text that is not a string', () => {
    const long = `{"v":1,"run":"run-1","att":0,"seq":0,"t":1,"ev":"refused","reason":"${'a'.repeat(1100)}"}\n`;
    expect(parseJournal(long)).toEqual({ ok: false, reason: 'line-corrupt' });
    const spaced = good.replace('"v":1,', '"v": 1,');
    expect(parseJournal(spaced)).toEqual({ ok: false, reason: 'line-corrupt' });
    expect(parseJournal(42)).toEqual({ ok: false, reason: 'line-corrupt' });
  });
});

describe('journal lines: order', () => {
  it('a good run, and a refused line on its own attempt', () => {
    expect(checkOrder(parsed(e('intent', 0), e('signed', 1), e('send-begin', 2), e('outcome', 3)))).toEqual({
      ok: true,
    });
    expect(checkOrder(parsed(e('refused', 0, 0), e('intent', 1, 1), e('refused', 2, 1)))).toEqual({ ok: true });
  });
  it('order-invalid: a gap in seq, or a seq that does not start at 0', () => {
    expect(checkOrder(parsed(e('intent', 0), e('signed', 2)))).toEqual({ ok: false, reason: 'order-invalid' });
    expect(checkOrder(parsed(e('intent', 1)))).toEqual({ ok: false, reason: 'order-invalid' });
  });
  it('order-invalid: events out of order', () => {
    expect(checkOrder(parsed(e('signed', 0)))).toEqual({ ok: false, reason: 'order-invalid' });
    expect(checkOrder(parsed(e('intent', 0), e('send-begin', 1)))).toEqual({ ok: false, reason: 'order-invalid' });
    expect(checkOrder(parsed(e('intent', 0), e('outcome', 1)))).toEqual({ ok: false, reason: 'order-invalid' });
  });
  it('order-invalid: refused after send-begin', () => {
    const lines = parsed(e('intent', 0), e('signed', 1), e('send-begin', 2), e('refused', 3));
    expect(checkOrder(lines)).toEqual({ ok: false, reason: 'order-invalid' });
  });
  it('order-invalid: any line after a closing line for the same attempt', () => {
    const afterOutcome = parsed(e('intent', 0), e('signed', 1), e('send-begin', 2), e('outcome', 3), e('intent', 4));
    expect(checkOrder(afterOutcome)).toEqual({ ok: false, reason: 'order-invalid' });
    expect(checkOrder(parsed(e('intent', 0), e('refused', 1), e('signed', 2)))).toEqual({
      ok: false,
      reason: 'order-invalid',
    });
  });
  it('two attempts interleaved in order, and two runs side by side', () => {
    const lines = parsed(
      e('intent', 0, 0),
      e('intent', 1, 1),
      e('signed', 2, 0),
      e('refused', 3, 1),
      e('send-begin', 4, 0),
      e('intent', 0, 0, 'run-2'),
      e('outcome', 5, 0),
    );
    expect(checkOrder(lines)).toEqual({ ok: true });
  });
});

describe('journal lines: unfinished attempts', () => {
  it('none in a finished journal or an empty one', () => {
    expect(findUnfinished(parsed(e('intent', 0), e('signed', 1), e('send-begin', 2), e('outcome', 3)))).toEqual([]);
    expect(findUnfinished([])).toEqual([]);
  });
  it('an intent only', () => {
    expect(findUnfinished(parsed(e('intent', 0)))).toEqual([{ run: 'run-1', att: 0, last: 'intent' }]);
  });
  it('an intent and signed', () => {
    expect(findUnfinished(parsed(e('intent', 0), e('signed', 1)))).toEqual([{ run: 'run-1', att: 0, last: 'signed' }]);
  });
  it('one that reached send-begin with no outcome is reported', () => {
    const lines = parsed(e('intent', 0), e('signed', 1), e('send-begin', 2));
    expect(findUnfinished(lines)).toEqual([{ run: 'run-1', att: 0, last: 'send-begin' }]);
  });
  it('closed by outcome', () => {
    expect(findUnfinished(parsed(e('intent', 0), e('signed', 1), e('send-begin', 2), e('outcome', 3)))).toEqual([]);
  });
  it('closed by refused', () => {
    expect(findUnfinished(parsed(e('intent', 0), e('signed', 1), e('refused', 2)))).toEqual([]);
  });
  it('two runs mixed', () => {
    const lines = parsed(
      e('intent', 0, 0, 'run-1'),
      e('intent', 0, 0, 'run-2'),
      e('signed', 1, 0, 'run-1'),
      e('refused', 1, 0, 'run-2'),
      e('send-begin', 2, 0, 'run-1'),
      e('intent', 2, 1, 'run-2'),
    );
    expect(findUnfinished(lines)).toEqual([
      { run: 'run-1', att: 0, last: 'send-begin' },
      { run: 'run-2', att: 1, last: 'intent' },
    ]);
  });
  it('each result holds only run, att and last', () => {
    for (const u of findUnfinished(parsed(e('intent', 0), e('signed', 1)))) {
      expect(Object.keys(u).sort()).toEqual(['att', 'last', 'run']);
    }
  });
});
