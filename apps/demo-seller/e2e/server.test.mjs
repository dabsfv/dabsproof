// T4 to T8 and T10 to T12: `next start` on 127.0.0.1:4319. Every expected address comes from evm's
// source, and every expected code and log line from the fix kit's source, run in this process.
// Captured output and bodies are only ever checked as true or false; none is printed.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  APP_DIR,
  captured,
  mappingDir,
  portOpen,
  removeOnExit,
  requestCounts,
  startServer,
  writeMapping,
} from './harness.mjs';
import {
  allowListedFixture,
  expectedAt,
  FIXKIT_TEXT,
  fake64Hex,
  fakeServerKey,
  managerRefusal,
  shows,
  startUpFromSource,
  TEST_XPRV,
  TEST_XPUB,
  XPUB_VARIABLE,
} from './helpers.mjs';

const XPUB = { [XPUB_VARIABLE]: TEST_XPUB };
const MAPPING = join(APP_DIR, 'payto-map.json');
const ENV_FILE = join(APP_DIR, '.env.production.local');
const fakes = { publicKey: fake64Hex(), serverKey: fakeServerKey() };
const git = (...args) => execFileSync('git', args, { cwd: APP_DIR, encoding: 'utf8' });
const codeFor = (request) => managerRefusal(MAPPING, request)?.code;

/** A body is only { payTo: <address> } or only { refused: <code> }. Checked as a boolean before any comparison. */
const plain = (b) =>
  !!b &&
  ((Object.keys(b).join() === 'payTo' && /^0x[0-9a-fA-F]{40}$/.test(b.payTo)) ||
    (Object.keys(b).join() === 'refused' && /^[a-z][a-z-]{2,40}$/.test(b.refused)));
const expectPlain = (r, status, body) => {
  expect(plain(r.body)).toBe(true);
  expect(r.status).toBe(status);
  expect(r.body).toEqual(body);
};
const refusesAll = async (server, code) => {
  expectPlain(await server.get('alpha', '/api/alpha'), 503, { refused: code });
  expectPlain(await server.get('item', '/api/item/5'), 503, { refused: code });
  expectPlain(await server.get('tiered', '/api/tiered', { 'x-demo-tier': 'pro' }), 503, { refused: code });
};
/** Every line the fix kit's source logs for this case is in the server's output (true or false only). */
const expectLines = async (server, lines) => {
  expect(lines.length > 0).toBe(true);
  for (const line of lines) expect(await server.waitFor(line)).toBe(true);
};

let server;
let gitBefore;
let dir;
let dup;
const stops = [];
beforeAll(() => {
  gitBefore = git('status', '--porcelain');
  dir = mappingDir();
  dup = writeMapping(dir, 'hd-dup-index', allowListedFixture('hd-dup-index'));
});
afterEach(async () => {
  if (server) stops.push(await server.stop());
  server = undefined;
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  if (existsSync(ENV_FILE)) unlinkSync(ENV_FILE);
});

describe('T4 good start-up', () => {
  it('addresses match evm source; a missing tier is refused; id text forms as observed', async () => {
    server = await startServer(XPUB);
    expectPlain(await server.get('alpha', '/api/alpha'), 200, { payTo: expectedAt(0) });
    expectPlain(await server.get('item', '/api/item/5'), 200, { payTo: expectedAt(1005) });
    expectPlain(await server.get('tiered', '/api/tiered', { 'x-demo-tier': 'pro' }), 200, { payTo: expectedAt(4) });
    expectPlain(await server.get('tiered', '/api/tiered', { 'x-demo-tier': 'basic' }), 200, { payTo: expectedAt(4) });
    expectPlain(await server.get('tiered', '/api/tiered'), 503, { refused: codeFor({ route: '/api/tiered' }) });
    // Observed behaviour, not a claim that it is right: "05" is accepted as the same item as "5".
    expectPlain(await server.get('item', '/api/item/05'), 200, { payTo: expectedAt(1005) });
    for (const text of ['1e3', '0x10', ' 5', '5.0', '+5', '5abc', '1'.repeat(40)]) {
      const code = codeFor({ route: '/api/item/[id]', id: text });
      expectPlain(await server.get('item', `/api/item/${encodeURIComponent(text)}`), 503, { refused: code });
    }
  });
});

describe('T5 a duplicate index at start-up', () => {
  it('the start-up sentence and the report are written; every route refuses', async () => {
    const source = startUpFromSource(XPUB, dup);
    expect(source.lines[0] === FIXKIT_TEXT.startupStopped).toBe(true);
    server = await startServer({ ...XPUB, DEMO_MAPPING: dup });
    await refusesAll(server, source.refusal.code);
    await expectLines(server, source.lines);
    expect(await server.waitFor('X402-03.dup-index')).toBe(true);
  });
});

describe('T6 key material in a NEXT_PUBLIC_ variable', () => {
  it('the name and type label are written, never the value; every route refuses', async () => {
    const env = { ...XPUB, NEXT_PUBLIC_DEMO_KEY: fakes.publicKey };
    const source = startUpFromSource(env, MAPPING);
    expect(source.lines.includes(FIXKIT_TEXT.envPublicKeyShaped)).toBe(true);
    server = await startServer(env);
    await refusesAll(server, source.refusal.code);
    await expectLines(server, source.lines);
    expect(shows(server.output(), fakes.publicKey)).toBe(false);
  });
});

describe('T7 no start-up check: the fallback runs the checks', () => {
  it('right addresses; out-of-range ids and an unknown tier are refused', async () => {
    server = await startServer({ ...XPUB, DEMO_SKIP_REGISTER: '1' });
    expectPlain(await server.get('alpha', '/api/alpha'), 200, { payTo: expectedAt(0) });
    expectPlain(await server.get('item', '/api/item/5'), 200, { payTo: expectedAt(1005) });
    for (const id of ['0', '10000']) {
      const code = codeFor({ route: '/api/item/[id]', id });
      expect(code === 'id-out-of-range').toBe(true);
      expectPlain(await server.get('item', `/api/item/${id}`), 503, { refused: code });
    }
    const gold = codeFor({ route: '/api/tiered', tier: 'gold' });
    expect(gold === 'tier-not-given').toBe(true);
    expectPlain(await server.get('tiered', '/api/tiered', { 'x-demo-tier': 'gold' }), 503, { refused: gold });
  });
});

describe('T8 fallback refusals', () => {
  it('a failing mapping gives the fallback refusal (sentence j as the message, its code in the body)', async () => {
    const source = startUpFromSource(XPUB, dup, { register: false });
    expect(source.refusal.message === FIXKIT_TEXT.fallbackRefused).toBe(true);
    server = await startServer({ ...XPUB, DEMO_SKIP_REGISTER: '1', DEMO_MAPPING: dup });
    expectPlain(await server.get('alpha', '/api/alpha'), 503, { refused: source.refusal.code });
    await expectLines(server, source.lines);
  });
  it('no options gives not-configured (sentence p as the message)', async () => {
    const source = startUpFromSource(XPUB, MAPPING, { register: false, options: false });
    expect(source.refusal.message === FIXKIT_TEXT.notConfigured).toBe(true);
    server = await startServer({ ...XPUB, DEMO_SKIP_REGISTER: '1', DEMO_FALLBACK_OPTIONS: '0' });
    expectPlain(await server.get('alpha', '/api/alpha'), 503, { refused: source.refusal.code });
  });
});

describe('T10 values Next.js loaded into the server environment are reported by the guard', () => {
  it('names and type labels are written, never the values; every route refuses', async () => {
    const ignored = spawnSync('git', ['check-ignore', '-q', ENV_FILE], { cwd: APP_DIR }).status === 0;
    expect(ignored).toBe(true);
    if (!ignored) return; // never write a file git would track
    const source = startUpFromSource(
      { ...XPUB, NEXT_PUBLIC_DEMO_KEY: fakes.publicKey, SERVER_FAKE_KEY: fakes.serverKey },
      MAPPING,
    );
    removeOnExit(ENV_FILE);
    try {
      writeFileSync(ENV_FILE, `NEXT_PUBLIC_DEMO_KEY=${fakes.publicKey}\nSERVER_FAKE_KEY=${fakes.serverKey}\n`, {
        mode: 0o600,
      });
      server = await startServer(XPUB);
      await refusesAll(server, source.refusal.code);
      await expectLines(server, source.lines);
    } finally {
      if (existsSync(ENV_FILE)) unlinkSync(ENV_FILE);
    }
  });
});

describe('T11 and T12', () => {
  it('T11 no fake value, xpub or xprv in any output or body', () => {
    const all = captured.join('\n');
    for (const [name, value] of Object.entries({ ...fakes, xpub: TEST_XPUB, xprv: TEST_XPRV })) {
      expect(shows(all, value), name).toBe(false);
    }
  });
  it('T12 clean-up: no process left, port closed, no env file, git status unchanged', async () => {
    expect(stops.length).toBe(7);
    expect(requestCounts.every((c) => Object.values(c).every((n) => n <= 10))).toBe(true);
    expect(stops.every((s) => !s.processesLeft && !s.portOpen)).toBe(true);
    expect(await portOpen()).toBe(false);
    expect(existsSync(ENV_FILE)).toBe(false);
    expect(git('status', '--porcelain') === gitBefore).toBe(true);
  });
});
