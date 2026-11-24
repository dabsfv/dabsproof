// T4 to T8 and T10 to T15: `next start` on 127.0.0.1:4319. Every expected address comes from evm's
// source, and every expected code and log line from the fix kit's source, run in this process.
// T11 checks captured output and bodies only as true or false and prints none of them; a failing
// comparison in another test prints the reply it compares.
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodePaymentRequiredHeader } from '@x402/core/http';
import { parsePaymentRequired } from '@x402/core/schemas';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createRunContext, inspectPaymentRequired } from '../../../packages/core/src/index.ts';
import { ALLOWED_NETWORKS, BASE_SEPOLIA } from '../../../packages/evm/src/index.ts';
import {
  APP_DIR,
  captured,
  HOST,
  mappingDir,
  PORT,
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
/** Fakes T11 checks as whole values only (their fixed parts may match a normal reply in 8-character windows). */
const verbatim = {};
const git = (...args) => execFileSync('git', args, { cwd: APP_DIR, encoding: 'utf8' });
const codeFor = (request) => managerRefusal(MAPPING, request)?.code;
const ORIGIN = `http://${HOST}:${PORT}`;
const USDC = ALLOWED_NETWORKS[BASE_SEPOLIA].assets[0].address;
const MAPPED = JSON.parse(readFileSync(MAPPING, 'utf8')).routes;
const priceOf = (route, tier) => MAPPED.find((r) => r.route === route && r.tier === tier).price;
const ALPHA_PRICE = priceOf('/api/alpha');
const ITEM_PRICE = priceOf('/api/item/[id]');
/** Every key at any depth of a decoded value. */
const keysOf = (v, out = []) => {
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) out.push(k, ...keysOf(x));
  return out;
};

/** Every refusal: a body is only { refused: <code> }. Checked as a boolean before any comparison. */
const plain = (b) => !!b && Object.keys(b).join() === 'refused' && /^[a-z][a-z-]{2,40}$/.test(b.refused);
const expectPlain = (r, status, body) => {
  expect(plain(r.body)).toBe(true);
  expect(r.status).toBe(status);
  expect(r.body).toEqual(body);
};
/** A 402 whose header decodes (by @x402/core, test-only) to one accepts entry with this payTo and amount, for this path; the body is the same object. */
const expectRequired = (r, { payTo, path, amount }) => {
  expect(r.status).toBe(402);
  const d = decodePaymentRequiredHeader(r.headers['payment-required']);
  expect(d.resource).toEqual({ url: `${ORIGIN}${path}` });
  expect(d.accepts.length).toBe(1);
  expect(d.accepts[0].payTo).toBe(payTo);
  expect(d.accepts[0].amount).toBe(amount);
  expect(r.body).toEqual(d);
};
const refusesAll = async (server, code) => {
  expectPlain(await server.get('alpha', '/api/alpha'), 503, { refused: code });
  expectPlain(await server.get('item', '/api/item/5'), 503, { refused: code });
  expectPlain(await server.get('tiered', '/api/tiered', { 'x-demo-tier': 'pro' }), 503, { refused: code });
  expectPlain(await server.get('paid', '/api/paid'), 503, { refused: code });
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

describe('T4, T13, T14 and T15 good start-up (one server start for all four)', () => {
  let good;
  /** T4's replies without a payment header, compared by T14. */
  const noHeader = {};
  beforeAll(async () => {
    good = await startServer(XPUB);
  });
  afterAll(async () => {
    if (good) stops.push(await good.stop());
  });

  it('T4 addresses match evm source; a missing tier is refused; id text forms as observed', async () => {
    noHeader.alpha = await good.get('alpha', '/api/alpha');
    expectRequired(noHeader.alpha, {
      payTo: expectedAt(0),
      path: '/api/alpha',
      amount: ALPHA_PRICE,
    });
    noHeader.item = await good.get('item', '/api/item/5');
    expectRequired(noHeader.item, {
      payTo: expectedAt(1005),
      path: '/api/item/5',
      amount: ITEM_PRICE,
    });
    // The two tiers must have different prices, or this test could not tell them apart.
    expect(priceOf('/api/tiered', 'pro') === priceOf('/api/tiered', 'basic')).toBe(false);
    noHeader.pro = await good.get('tiered', '/api/tiered', { 'x-demo-tier': 'pro' });
    expectRequired(noHeader.pro, {
      payTo: expectedAt(4),
      path: '/api/tiered',
      amount: priceOf('/api/tiered', 'pro'),
    });
    const basic = await good.get('tiered', '/api/tiered', { 'x-demo-tier': 'basic' });
    expectRequired(basic, { payTo: expectedAt(4), path: '/api/tiered', amount: priceOf('/api/tiered', 'basic') });
    expectPlain(await good.get('tiered', '/api/tiered'), 503, { refused: codeFor({ route: '/api/tiered' }) });
    // Observed behaviour, not a claim that it is right: "05" is accepted as the same item as "5",
    // and resource.url keeps the id text as given.
    expectRequired(await good.get('item', '/api/item/05'), {
      payTo: expectedAt(1005),
      path: '/api/item/05',
      amount: ITEM_PRICE,
    });
    for (const text of ['1e3', '0x10', ' 5', '5.0', '+5', '5abc', '1'.repeat(40)]) {
      const code = codeFor({ route: '/api/item/[id]', id: text });
      expectPlain(await good.get('item', `/api/item/${encodeURIComponent(text)}`), 503, { refused: code });
    }
  });

  it('T13 alpha reply: a 402 whose header and body decode to one exact Base Sepolia USDC entry and nothing else', async () => {
    // Shows only that @x402/core 2.31.0's decoder and schema and our own inspector accept this reply,
    // not what any buyer accepts. extra is what @x402/evm 2.31.0 declares; the token contract is not
    // checked. The origin is the configured one (DEMO_ORIGIN); nothing here shows what Next.js reports
    // for request.url under other settings.
    const r = await good.get('alpha', '/api/alpha');
    expect(r.status).toBe(402);
    const header = r.headers['payment-required'];
    expect(typeof header).toBe('string');

    const d = decodePaymentRequiredHeader(header);
    expect(parsePaymentRequired(d).success).toBe(true);

    const o = inspectPaymentRequired(createRunContext(), 'PAYMENT-REQUIRED', header);
    expect(o.decoded).toBe(true);
    expect(o.acceptsOverCap).toBe(0);
    expect(o.errorLength).toBe(null);
    expect(o.dropped).toBe(0);
    const terms = {
      scheme: 'exact',
      network: BASE_SEPOLIA,
      asset: USDC,
      amount: ALPHA_PRICE,
      payTo: expectedAt(0),
      maxTimeoutSeconds: 300,
    };
    expect(o.accepts).toEqual([terms]);
    expect(o.resource).toEqual({ origin: ORIGIN, path: '/api/alpha', queryNames: [], dropped: 0 });

    expect(d.x402Version).toBe(2);
    expect(d.resource).toEqual({ url: `${ORIGIN}/api/alpha` });
    expect(d.accepts).toEqual([{ ...terms, extra: { name: 'USDC', version: '2' } }]);

    // The body is the same object and nothing more: no content from the route.
    expect(r.body).toEqual(d);
    expect(Object.keys(r.body).sort()).toEqual(['accepts', 'resource', 'x402Version']);

    // The only addresses anywhere are the asset and payTo of that one entry.
    const text = JSON.stringify(r.body);
    expect((text.match(/0x[0-9a-fA-F]{40}/g) ?? []).sort()).toEqual([USDC, expectedAt(0)].sort());
    const elsewhere = Object.entries(r.headers).filter(
      ([k, v]) => k !== 'payment-required' && /0x[0-9a-fA-F]{40}/.test(v),
    );
    expect(elsewhere.length).toBe(0);

    // Never key material or payment-signing fields.
    const all = [header, text].join('\n');
    expect(shows(all, TEST_XPUB)).toBe(false);
    expect(shows(all, TEST_XPRV)).toBe(false);
    expect(/(?<![0-9a-fA-F])[0-9a-fA-F]{64}(?![0-9a-fA-F])/.test(all)).toBe(false);
    const keys = keysOf(d).map((k) => k.toLowerCase());
    for (const k of ['signature', 'nonce', 'authorization', 'payload', 'xpub', 'xprv', 'key']) {
      expect(keys.includes(k)).toBe(false);
    }
  });

  it('T13 with a query string: resource.url carries no query', async () => {
    // Shows only that the request's query does not reach resource.url: the route builds the URL from
    // DEMO_ORIGIN and its own path. It says nothing about how buyers or servers treat query strings.
    const r = await good.get('alpha', '/api/alpha?a=1');
    expect(r.status).toBe(402);
    const d = decodePaymentRequiredHeader(r.headers['payment-required']);
    expect(d.resource).toEqual({ url: `${ORIGIN}/api/alpha` });
    expect(r.body).toEqual(d);
  });

  it('T14 a request carrying fake payment headers gets the same reply as one without', async () => {
    // The header names PAYMENT-SIGNATURE and X-PAYMENT come from earlier reads and are not confirmed
    // from code here. This shows only that our routes do not change their reply when they are present.
    // It covers alpha, item and tiered only; it does not cover /api/paid, which reads payment-signature
    // (T15 here, and the runner's end-to-end tests).
    expect(Object.keys(noHeader).sort()).toEqual(['alpha', 'item', 'pro']);
    // 48 random bytes as 64 base64 characters, made at run time. Never printed or logged. Added to
    // fakes so that T11 also checks every captured output and body for it.
    const fake = randomBytes(48).toString('base64');
    fakes.payment = fake;
    const pay = { 'PAYMENT-SIGNATURE': fake, 'X-PAYMENT': fake };
    const withHeader = {
      alpha: await good.get('alpha', '/api/alpha', pay),
      item: await good.get('item', '/api/item/5', pay),
      pro: await good.get('tiered', '/api/tiered', { ...pay, 'x-demo-tier': 'pro' }),
    };
    for (const k of ['alpha', 'item', 'pro']) {
      const a = withHeader[k];
      const b = noHeader[k];
      // First checks that cannot print the fake; the shows checks next; only then the comparisons,
      // whose failure output prints both sides.
      expect(a.status).toBe(402);
      expect(typeof a.headers['payment-required']).toBe('string');
      const all = [...Object.values(a.headers), JSON.stringify(a.body), atob(a.headers['payment-required'])].join('\n');
      expect(shows(all, fake)).toBe(false);
      expect(shows(all, btoa(fake))).toBe(false);
      expect(a.status).toBe(b.status);
      expect(a.headers['payment-required']).toBe(b.headers['payment-required']);
      expect(a.body).toEqual(b.body);
      expect(Object.keys(a.headers).sort()).toEqual(Object.keys(b.headers).sort());
    }
  });

  it('T15 /api/paid: no header gives the 402; a payment header with no facilitator set gives 503', async () => {
    // This start has no DEMO_FACILITATOR_URL, so the paid path cannot run here; the runner's
    // end-to-end tests drive it against the stand-in. The fake payment is base64 of a JSON text made
    // at run time: a fixed prefix, a random signature, a fixed suffix. It is not a payment. Its fixed
    // prefix encodes like the start of every PAYMENT-REQUIRED header, so only its random parts are
    // checked in 8-character windows; the whole header is checked as one value. T11 checks all three.
    const prefix = '{"x402Version":2,"payload":{"signature":"';
    const signature = randomBytes(48).toString('base64');
    const header = Buffer.from(`${prefix}${signature}"}}`).toString('base64');
    // From the first base64 group lying wholly inside the signature; the last 8 characters (the
    // closing text and any padding) are left out.
    const randomPart = header.slice(Math.ceil(prefix.length / 3) * 4, header.length - 8);
    fakes.paidSignature = signature;
    fakes.paidRandomPart = randomPart;
    verbatim.paidHeader = header;
    const plainReply = await good.get('paid', '/api/paid');
    expectRequired(plainReply, { payTo: expectedAt(2), path: '/api/paid', amount: priceOf('/api/paid') });
    expect(randomPart.length >= 16).toBe(true);
    expect(shows(plainReply.headers['payment-required'], randomPart)).toBe(false);
    const withPayment = await good.get('paid', '/api/paid', { 'payment-signature': header });
    // Checks that cannot print the fake come first; only then the comparison.
    const all = [
      ...Object.values(plainReply.headers),
      JSON.stringify(plainReply.body),
      ...Object.values(withPayment.headers),
      JSON.stringify(withPayment.body),
    ].join('\n');
    expect(shows(all, signature)).toBe(false);
    expect(shows(all, randomPart)).toBe(false);
    expect(all.includes(header)).toBe(false);
    expect(shows(all, TEST_XPUB)).toBe(false);
    expect(shows(all, TEST_XPRV)).toBe(false);
    expect(/(?<![0-9a-fA-F])[0-9a-fA-F]{64}(?![0-9a-fA-F])/.test(all)).toBe(false);
    expectPlain(withPayment, 503, { refused: 'facilitator-not-given' });
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
    expectRequired(await server.get('alpha', '/api/alpha'), {
      payTo: expectedAt(0),
      path: '/api/alpha',
      amount: ALPHA_PRICE,
    });
    expectRequired(await server.get('item', '/api/item/5'), {
      payTo: expectedAt(1005),
      path: '/api/item/5',
      amount: ITEM_PRICE,
    });
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
    for (const [name, value] of Object.entries(verbatim)) expect(all.includes(value), name).toBe(false);
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
