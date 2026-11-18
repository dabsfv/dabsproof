// Evidence capture: allow-lists, the salted fingerprint, caps on untrusted input, the error-code
// rule, URLs, and the guarded logger. The canary suite is in canary.test.ts.
import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  bodyDigest,
  capOutcome,
  checkEvidence,
  createLogger,
  createRunContext,
  EVIDENCE_TEXT,
  EvidenceSchema,
  inspectPaymentHeader,
  inspectPaymentRequired,
  inspectPaymentResponse,
  keepErrorCode,
  keepUrl,
  LIMITS,
  NO_FINGERPRINT_REASONS,
  PaymentObservationSchema,
  RequestRecordSchema,
  recordRequest,
  serialiseEvidence,
  summariseFingerprints,
  WITHHELD_LINE,
} from '../src/index.js';
import { address, b64, hex, paymentHeader, permit2Header, txHash } from './evidence-helpers.js';

const payment = () => ({ from: address(), to: address(), nonce: `0x${hex(32)}`, signature: `0x${hex(65)}` });

describe('limits', () => {
  it('states the minimum secret length and the window size', () => {
    expect(LIMITS.minSecretLength).toBe(8);
    expect(LIMITS.secretWindow).toBe(8);
    const ctx = createRunContext();
    expect(ctx.registerSecret('1234567')).toBe(false);
    expect(ctx.registerSecret('12345678')).toBe(true);
    expect(ctx.registerSecret(12345678)).toBe(false);
  });
});

describe('the run context hides its salt and its register', () => {
  const ctx = createRunContext();
  const secret = `0x${hex(32)}`;
  ctx.registerSecret(secret);
  it('prints and serialises as a fixed label only', () => {
    expect(JSON.stringify(ctx)).toBe('"[RunContext]"');
    expect(String(ctx)).toBe('[RunContext]');
    expect(`${ctx}`).toBe('[RunContext]');
    expect(inspect(ctx)).toBe('[RunContext]');
    expect(inspect(ctx, { showHidden: true, depth: null, getters: true })).toBe('[RunContext]');
    expect(inspect({ nested: { ctx } }, { depth: null })).toContain('[RunContext]');
  });
  it('has no enumerable or visible field other than runId', () => {
    expect(Object.keys(ctx)).toEqual(['runId']);
    expect(Reflect.ownKeys(ctx)).toEqual(['runId']);
    expect({ ...ctx }).toEqual({ runId: ctx.runId });
    expect(Object.keys(structuredClone(ctx))).toEqual(['runId']);
  });
  it('the register still works', () => {
    expect(ctx.holdsSecret(`x${secret}x`)).toBe(true);
    expect(ctx.holdsSecret(secret.toUpperCase())).toBe(true);
    expect(ctx.holdsSecret(secret.slice(20, 28))).toBe(true);
    expect(ctx.holdsSecret(Buffer.from(secret).toString('base64'))).toBe(true);
    expect(ctx.holdsSecret(Buffer.from(secret).toString('hex'))).toBe(true);
    expect(ctx.holdsSecret('nothing private here')).toBe(false);
  });
});

describe('fingerprint', () => {
  it('is fp1: and 43 base64url characters', () => {
    const fp = createRunContext().fingerprint(address(), `0x${hex(32)}`, '1763400600');
    expect(fp).toMatch(/^fp1:[A-Za-z0-9_-]{43}$/);
  });
  it('is the same for the same payment within a run, whatever the header text', () => {
    const ctx = createRunContext();
    const p = payment();
    const a = inspectPaymentHeader(ctx, 'PAYMENT-SIGNATURE', paymentHeader(p));
    const b = inspectPaymentHeader(ctx, 'payment-signature', paymentHeader(p, { extensions: { other: 1 } }));
    const c = inspectPaymentHeader(
      ctx,
      'Payment-Signature',
      paymentHeader({ ...p, from: p.from.toUpperCase().replace('0X', '0x') }),
    );
    expect(a.fingerprint).not.toBeNull();
    expect(b.fingerprint).toBe(a.fingerprint);
    expect(c.fingerprint).toBe(a.fingerprint);
  });
  it('differs across runs and for a different nonce or validBefore', () => {
    const p = payment();
    const one = inspectPaymentHeader(createRunContext(), 'payment-signature', paymentHeader(p));
    const two = inspectPaymentHeader(createRunContext(), 'payment-signature', paymentHeader(p));
    expect(one.fingerprint).not.toBe(two.fingerprint);
    const ctx = createRunContext();
    const base = inspectPaymentHeader(ctx, 'payment-signature', paymentHeader(p)).fingerprint;
    expect(
      inspectPaymentHeader(ctx, 'payment-signature', paymentHeader({ ...p, nonce: `0x${hex(32)}` })).fingerprint,
    ).not.toBe(base);
    expect(
      inspectPaymentHeader(ctx, 'payment-signature', paymentHeader({ ...p, validBefore: '1763400601' })).fingerprint,
    ).not.toBe(base);
  });
});

describe('payment header', () => {
  it('keeps only the name, length, public terms and fingerprint', () => {
    const ctx = createRunContext();
    const p = payment();
    const value = paymentHeader(p);
    const o = inspectPaymentHeader(ctx, 'payment-signature', value);
    expect(o).toEqual({
      headerName: 'payment-signature',
      length: value.length,
      decoded: true,
      terms: {
        scheme: 'exact',
        network: 'eip155:84532',
        asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        amount: '10000',
        payTo: p.to,
        validAfter: '1763400000',
        validBefore: '1763400600',
        resource: { origin: 'https://seller.test', path: '/api/report', queryNames: [], dropped: 0 },
      },
      fingerprint: expect.stringMatching(/^fp1:/),
      noFingerprintReason: null,
      dropped: 0,
    });
    expect(PaymentObservationSchema.safeParse(o).success).toBe(true);
  });
  it('matches the header name in any letter case', () => {
    for (const name of ['payment-signature', 'PAYMENT-SIGNATURE', 'Payment-Signature']) {
      const o = inspectPaymentHeader(createRunContext(), name, paymentHeader(payment()));
      expect(o.headerName).toBe('payment-signature');
      expect(o.decoded).toBe(true);
    }
    const ctx = createRunContext();
    const r = recordRequest(ctx, {
      method: 'GET',
      url: 'https://seller.test/a',
      requestHeaders: [['payment-signature', paymentHeader(payment())]],
    });
    expect(r.payment?.fingerprint).toMatch(/^fp1:/);
  });
});

describe('a payment with no fingerprint always says why', () => {
  const cases: [string, () => [string, unknown], string][] = [
    [
      'Permit2',
      () => ['payment-signature', permit2Header(address(), address(), `0x${hex(65)}`, `${BigInt(`0x${hex(32)}`)}`)],
      'unsupported-payload',
    ],
    ['upto', () => ['payment-signature', paymentHeader({ ...payment(), scheme: 'upto' })], 'unsupported-scheme'],
    [
      'version 1 X-PAYMENT',
      () => ['X-PAYMENT', b64({ x402Version: 1, scheme: 'exact', network: 'base-sepolia', payload: {} })],
      'unsupported-version',
    ],
    [
      'version 1 inside PAYMENT-SIGNATURE',
      () => ['payment-signature', b64({ x402Version: 1, scheme: 'exact', payload: {} })],
      'unsupported-version',
    ],
    ['not base64 JSON', () => ['payment-signature', 'not a header at all'], 'undecodable'],
    ['not text', () => ['payment-signature', 42], 'undecodable'],
    ['no nonce', () => ['payment-signature', paymentHeader({ ...payment(), nonce: '' })], 'missing-fields'],
    [
      'payer not an address',
      () => ['payment-signature', paymentHeader({ ...payment(), from: 'someone' })],
      'missing-fields',
    ],
    ['JSON but not an object', () => ['payment-signature', b64([1, 2, 3])], 'unsupported-payload'],
  ];
  for (const [label, make, reason] of cases) {
    it(`${label}: ${reason}`, () => {
      const [name, value] = make();
      const o = inspectPaymentHeader(createRunContext(), name, value);
      expect(o.fingerprint).toBeNull();
      expect(o.terms).toBeNull();
      expect(o.noFingerprintReason).toBe(reason);
      expect(NO_FINGERPRINT_REASONS).toContain(o.noFingerprintReason);
      expect(PaymentObservationSchema.safeParse(o).success).toBe(true);
    });
  }
  it('the schema refuses a missing fingerprint without a reason', () => {
    const o = {
      headerName: 'payment-signature',
      length: 1,
      decoded: false,
      terms: null,
      fingerprint: null,
      noFingerprintReason: null,
      dropped: 0,
    };
    expect(PaymentObservationSchema.safeParse(o).success).toBe(false);
  });
  it('payments without a fingerprint are never counted as compared', () => {
    const ctx = createRunContext();
    const none = cases.map(([, make]) => {
      const [name, value] = make();
      return inspectPaymentHeader(ctx, name, value);
    });
    const s = summariseFingerprints(none);
    expect(s.compared).toBe(0);
    expect(s.reusedGroups).toBe(0);
    expect(Object.values(s.notCompared).reduce((a, b) => a + b, 0)).toBe(cases.length);
    expect(Object.keys(s).sort()).toEqual(['compared', 'notCompared', 'reusedGroups']);
  });
  it('a reused payment is counted once as a reused group, beside the ones not compared', () => {
    const ctx = createRunContext();
    const p = payment();
    const obs = [
      inspectPaymentHeader(ctx, 'payment-signature', paymentHeader(p)),
      inspectPaymentHeader(ctx, 'payment-signature', paymentHeader(p)),
      inspectPaymentHeader(ctx, 'payment-signature', paymentHeader(payment())),
      inspectPaymentHeader(ctx, 'x-payment', 'abc'),
    ];
    expect(summariseFingerprints(obs)).toMatchObject({ compared: 3, reusedGroups: 1 });
    expect(summariseFingerprints(obs).notCompared['unsupported-version']).toBe(1);
  });
});

describe('JSON that is not an EIP-3009 payment: signature and nonce fields are registered at any depth', () => {
  it('Permit2', () => {
    const ctx = createRunContext();
    const sig = `0x${hex(65)}`;
    const nonce = `${BigInt(`0x${hex(32)}`)}`;
    inspectPaymentHeader(ctx, 'payment-signature', permit2Header(address(), address(), sig, nonce));
    expect(ctx.holdsSecret(sig)).toBe(true);
    expect(ctx.holdsSecret(nonce)).toBe(true);
  });
  it('X-PAYMENT and deeply nested fields, any letter case', () => {
    const ctx = createRunContext();
    const a = `0x${hex(32)}`;
    const b = `0x${hex(32)}`;
    const c = `0x${hex(65)}`;
    inspectPaymentHeader(
      ctx,
      'x-payment',
      b64({ x402Version: 1, payload: { deep: [{ nonce: a }, { more: { Signature: c } }] }, NONCE: b }),
    );
    for (const v of [a, b, c]) expect(ctx.holdsSecret(v)).toBe(true);
  });
});

describe('caps on untrusted input', () => {
  const required = (accepts: unknown[], extra: Record<string, unknown> = {}) =>
    b64({ x402Version: 2, resource: { url: 'https://seller.test/a' }, accepts, ...extra });
  const entry = () => ({
    scheme: 'exact',
    network: 'eip155:84532',
    asset: address(),
    amount: '10000',
    payTo: address(),
    maxTimeoutSeconds: 60,
    extra: { name: 'USDC' },
  });
  it(`keeps at most ${LIMITS.maxAccepts} accepts entries and counts the rest`, () => {
    const o = inspectPaymentRequired(
      createRunContext(),
      'PAYMENT-REQUIRED',
      required(Array.from({ length: 25 }, entry)),
    );
    expect(o.accepts).toHaveLength(20);
    expect(o.acceptsOverCap).toBe(5);
    expect(o.accepts[0]).not.toHaveProperty('extra');
  });
  it('drops and counts a network over the cap, an amount over the cap and a non-digit amount', () => {
    const o = inspectPaymentRequired(
      createRunContext(),
      'payment-required',
      required([
        { ...entry(), network: `eip155:${'1'.repeat(LIMITS.maxNetwork)}` },
        { ...entry(), amount: '1'.repeat(LIMITS.maxAmountDigits + 1) },
        { ...entry(), amount: '1e6' },
      ]),
    );
    expect(o.accepts[0]).not.toHaveProperty('network');
    expect(o.accepts[1]).not.toHaveProperty('amount');
    expect(o.accepts[2]).not.toHaveProperty('amount');
    expect(o.dropped).toBe(3);
    const ok = inspectPaymentRequired(
      createRunContext(),
      'payment-required',
      required([{ ...entry(), amount: '1'.repeat(LIMITS.maxAmountDigits) }]),
    );
    expect(ok.accepts[0]?.amount).toHaveLength(LIMITS.maxAmountDigits);
  });
  it('keeps only the length of the free-text error', () => {
    const o = inspectPaymentRequired(
      createRunContext(),
      'payment-required',
      required([entry()], { error: 'Payment required for this route' }),
    );
    expect(o.errorLength).toBe(31);
    expect(JSON.stringify(o)).not.toContain('Payment required for');
  });
  it('keeps the settled amount only if it is digits only and within the cap', () => {
    const settle = (amount: unknown) =>
      inspectPaymentResponse(
        createRunContext(),
        'payment-response',
        b64({ success: true, transaction: txHash(), network: 'eip155:84532', amount }),
      );
    expect(settle('10000').amount).toBe('10000');
    expect(settle('1'.repeat(LIMITS.maxAmountDigits)).amount).toHaveLength(LIMITS.maxAmountDigits);
    for (const bad of ['1'.repeat(LIMITS.maxAmountDigits + 1), '-5', '1.5', ' 10', 10000]) {
      const o = settle(bad);
      expect(o.amount).toBeUndefined();
      expect(o.dropped).toBe(1);
    }
  });
  it(`keeps a URL path only up to ${LIMITS.maxText} characters, and at most ${LIMITS.maxQueryNames} query names`, () => {
    const ctx = createRunContext();
    const long = keepUrl(ctx, `https://seller.test/${'a'.repeat(LIMITS.maxText)}`);
    expect(long?.path).toBe('');
    expect(long?.dropped).toBe(1);
    const q = Array.from({ length: 40 }, (_, i) => `n${i}=v`).join('&');
    const many = keepUrl(ctx, `https://seller.test/a?${q}`);
    expect(many?.queryNames).toHaveLength(LIMITS.maxQueryNames);
    expect(many?.dropped).toBe(8);
  });
  it(`keeps an allow-listed header value only up to ${LIMITS.maxText} characters`, () => {
    const r = recordRequest(createRunContext(), {
      method: 'GET',
      url: 'https://seller.test/a',
      responseHeaders: { 'content-type': `text/plain; x=${'a'.repeat(LIMITS.maxText)}`, 'cache-control': 'no-store' },
    });
    expect(r.responseHeaders[0]).toEqual({ name: 'content-type', length: LIMITS.maxText + 14 });
    expect(r.responseHeaders[1]).toEqual({ name: 'cache-control', value: 'no-store', length: 8 });
    expect(r.dropped).toBe(1);
  });
  it(`does not decode a header longer than ${LIMITS.maxDecodedHeader} characters`, () => {
    const o = inspectPaymentHeader(
      createRunContext(),
      'payment-signature',
      paymentHeader({ ...payment(), url: `https://seller.test/${'a'.repeat(LIMITS.maxDecodedHeader)}` }),
    );
    expect(o.noFingerprintReason).toBe('undecodable');
  });
});

describe('the error-code rule', () => {
  const ctx = createRunContext();
  it('is lower-case letters, digits and underscores, 3 to 64 characters, starting with a letter', () => {
    for (const ok of ['invalid_exact_evm_recipient_mismatch', 'xyz', 'insufficient_funds', `x${'y'.repeat(63)}`]) {
      expect(keepErrorCode(ctx, ok)).toEqual({ code: ok });
    }
    for (const bad of ['abc', 'ab', `x${'y'.repeat(64)}`, 'Invalid_payment', '1abc', 'has space', 'dash-code', '']) {
      expect(keepErrorCode(ctx, bad)).toEqual({ codeLength: bad.length });
    }
  });
  it('refuses a 64-character hex string, even one that starts with a letter', () => {
    const h = `a${hex(32).slice(1)}`;
    expect(h).toHaveLength(64);
    expect(keepErrorCode(ctx, h)).toEqual({ codeLength: 64 });
    expect(keepErrorCode(ctx, 'deadbeef')).toEqual({ codeLength: 8 });
  });
  it('refuses a code holding a registered secret', () => {
    const c = createRunContext();
    const s = `zz${hex(8)}`;
    c.registerSecret(s);
    expect(keepErrorCode(c, `bad_${s}`)).toEqual({ codeLength: s.length + 4 });
  });
  it('keeps only the length of errorMessage, and the code rule for errorReason', () => {
    const o = inspectPaymentResponse(
      createRunContext(),
      'payment-response',
      b64({
        success: false,
        transaction: '',
        network: 'eip155:84532',
        errorReason: 'invalid_exact_evm_payload_signature',
        errorMessage: 'The signature did not match',
      }),
    );
    expect(o.errorReason).toEqual({ code: 'invalid_exact_evm_payload_signature' });
    expect(o.errorMessageLength).toBe(27);
    expect(o.transactionLength).toBe(0);
    expect(JSON.stringify(o)).not.toContain('did not match');
  });
});

describe('URLs', () => {
  it('drop user:password@, the #fragment and every query value; register them; keep query names', () => {
    const ctx = createRunContext();
    const pw = `pw${hex(8)}`;
    const qv = `qv${hex(8)}`;
    const frag = `fr${hex(8)}`;
    const u = keepUrl(ctx, `https://someone:${pw}@seller.test:8443/api/a?token=${qv}&b=1#${frag}`);
    expect(u).toEqual({ origin: 'https://seller.test:8443', path: '/api/a', queryNames: ['token', 'b'], dropped: 0 });
    for (const v of [pw, qv, frag]) expect(ctx.holdsSecret(v)).toBe(true);
    expect(JSON.stringify(u)).not.toMatch(/someone|#/);
  });
  it('a value that is not a URL keeps nothing', () => {
    expect(keepUrl(createRunContext(), 'not a url')).toBeNull();
    expect(keepUrl(createRunContext(), 42)).toBeNull();
  });
});

describe('request records', () => {
  it('keep allow-listed request headers only; every other value is name and length, and registered', () => {
    const ctx = createRunContext();
    const auth = `Bearer ${hex(16)}`;
    const r = recordRequest(ctx, {
      method: 'get',
      url: 'https://seller.test/a',
      requestHeaders: {
        Accept: 'application/json',
        Authorization: auth,
        'User-Agent': 'probe-agent/1.0',
        Host: 'seller.test',
      },
      status: 402,
    });
    expect(r.method).toBe('GET');
    expect(r.requestHeaders).toEqual([
      { name: 'accept', value: 'application/json', length: 16 },
      { name: 'authorization', length: auth.length },
      { name: 'user-agent', length: 15 },
      { name: 'host', length: 11 },
    ]);
    expect(ctx.holdsSecret(auth)).toBe(true);
    expect(RequestRecordSchema.safeParse(r).success).toBe(true);
  });
  it('register each item of a list value, and record it as not text', () => {
    const ctx = createRunContext();
    const a = `sid=${hex(8)}`;
    const r = recordRequest(ctx, {
      method: 'GET',
      url: 'https://seller.test/a',
      responseHeaders: [['set-cookie', [a, 'b=2']]],
    });
    expect(r.responseHeaders).toEqual([{ name: 'set-cookie', length: null, note: 'not-text' }]);
    expect(ctx.holdsSecret(a)).toBe(true);
  });
  it('store the body as SHA-256 and length only', () => {
    const r = recordRequest(createRunContext(), { method: 'GET', url: 'https://seller.test/a', body: 'hello' });
    expect(r.body).toEqual(bodyDigest('hello'));
    expect(r.body?.length).toBe(5);
    expect(r.body?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(bodyDigest(new Uint8Array([104, 101, 108, 108, 111]))).toEqual(r.body);
  });
});

describe('normal records and events are never withheld', () => {
  // Repeated with fresh random values, so a chance overlap would show up as a failure here.
  for (let run = 0; run < 25; run++) {
    it(`run ${run + 1}`, () => {
      const ctx = createRunContext();
      const p = payment();
      const tx = txHash();
      const lines: string[] = [];
      const log = createLogger(ctx, (l) => lines.push(l));
      const r = recordRequest(ctx, {
        method: 'GET',
        url: 'https://seller.test/api/report?id=7',
        requestHeaders: {
          Accept: 'application/json',
          'User-Agent': 'probe-agent/1.0',
          'PAYMENT-SIGNATURE': paymentHeader(p),
        },
        status: 200,
        responseHeaders: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          'Access-Control-Expose-Headers': 'PAYMENT-REQUIRED, PAYMENT-RESPONSE',
          Date: 'Wed, 18 Nov 2026 10:00:00 GMT',
          ETag: `W/"${hex(6)}"`,
          'PAYMENT-RESPONSE': b64({ success: true, transaction: tx, network: 'eip155:84532', payer: p.from }),
        },
        body: '{"ok":true}',
      });
      log.log({ event: 'run-started', runId: ctx.runId });
      log.log({ event: 'request-recorded', method: r.method, path: r.url?.path ?? null, status: r.status });
      log.log({
        event: 'payment-observed',
        headerName: 'payment-signature',
        length: r.payment?.length ?? null,
        decoded: true,
        fingerprint: r.payment?.fingerprint ?? null,
        noFingerprintReason: null,
      });
      log.log({ event: 'settlement-observed', success: true, network: 'eip155:84532', transactionHash: tx });
      log.log({ event: 'run-finished', withheld: ctx.withheld });
      expect(lines).not.toContain(WITHHELD_LINE);
      expect(ctx.withheld).toBe(0);
      expect(r.payment?.terms).toMatchObject({ scheme: 'exact', network: 'eip155:84532', payTo: p.to });
      expect(r.settlement).toMatchObject({ success: true, network: 'eip155:84532', transactionHash: tx });
      expect(r.dropped).toBe(0);
      const s = lines.join('\n');
      for (const t of ['"success":true', '"exact"', 'eip155:84532', '"transactionHash"'])
        expect(s + JSON.stringify(r)).toContain(t);
      expect(JSON.stringify(r)).toContain(p.to);
      expect(checkEvidence(ctx, r).ok).toBe(true);
      expect(ctx.withheld).toBe(0);
    });
  }
});

describe('logger', () => {
  it('counts what it withholds, and a run that withheld anything cannot read as found no problem', () => {
    const ctx = createRunContext();
    const lines: string[] = [];
    const log = createLogger(ctx, (l) => lines.push(l));
    const s = `0x${hex(32)}`;
    ctx.registerSecret(s);
    log.log({ event: 'run-started', runId: s });
    log.log({ event: 'free-text', text: 'anything' } as never);
    expect(lines).toEqual([WITHHELD_LINE, WITHHELD_LINE]);
    expect(ctx.withheld).toBe(2);
    expect(capOutcome('found-no-problem', ctx.withheld)).toBe('could-not-verify');
    expect(capOutcome('found-a-problem', ctx.withheld)).toBe('found-a-problem');
    expect(capOutcome('could-not-verify', ctx.withheld)).toBe('could-not-verify');
    expect(capOutcome('not-applicable', ctx.withheld)).toBe('not-applicable');
    expect(capOutcome('found-no-problem', 0)).toBe('found-no-problem');
  });
});

describe('evidence schemas', () => {
  it('refuse unknown fields, with a fixed message and no cause', () => {
    const ctx = createRunContext();
    const r = recordRequest(ctx, { method: 'GET', url: 'https://seller.test/a' });
    expect(checkEvidence(ctx, r).ok).toBe(true);
    const bad = checkEvidence(ctx, { ...r, paymentHeader: 'anything' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.error.message).toBe(EVIDENCE_TEXT.evidenceShapeMismatch);
      expect(bad.error.cause).toBeUndefined();
    }
    expect(ctx.withheld).toBe(1);
  });
  it('evidence that fails its schema: the shape sentence, counted, and the outcome capped', () => {
    const ctx = createRunContext();
    const r = recordRequest(ctx, { method: 'GET', url: 'https://seller.test/a' });
    const s = serialiseEvidence(ctx, { ...r, extra: 1 });
    expect(s.ok).toBe(false);
    if (!s.ok) {
      expect(s.error.message).toBe(EVIDENCE_TEXT.evidenceShapeMismatch);
      expect(s.error.cause).toBeUndefined();
    }
    expect(ctx.withheld).toBe(1);
    expect(capOutcome('found-no-problem', ctx.withheld)).toBe('could-not-verify');
  });
  it('evidence that would show a registered secret: the private-value sentence, counted, and the outcome capped', () => {
    const ctx = createRunContext();
    const r = recordRequest(ctx, { method: 'GET', url: 'https://seller.test/a' });
    const ok = serialiseEvidence(ctx, r);
    expect(ok.ok).toBe(true);
    expect(ctx.withheld).toBe(0);
    expect(capOutcome('found-no-problem', ctx.withheld)).toBe('found-no-problem');
    ctx.registerSecret('seller.test/a');
    const s = serialiseEvidence(ctx, r);
    expect(s.ok).toBe(false);
    if (!s.ok) {
      expect(s.error.message).toBe(EVIDENCE_TEXT.outputWithheld);
      expect(s.error.cause).toBeUndefined();
    }
    expect(ctx.withheld).toBe(1);
    expect(capOutcome('found-no-problem', ctx.withheld)).toBe('could-not-verify');
  });
  it('JSON Schema', () => {
    expect(z.toJSONSchema(EvidenceSchema, { unrepresentable: 'any' })).toMatchSnapshot();
  });
});
