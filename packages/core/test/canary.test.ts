// The canary suite: planted fakes go through every evidence path, and none may appear in any
// output: returned objects, JSON, util.inspect, logger lines, error messages, stacks and causes,
// or anything written to standard output or standard error. Every fake is built at run time.
import { inspect } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkEvidence,
  createLogger,
  createRunContext,
  decodeBase64Json,
  decodePaymentSignature,
  EVIDENCE_TEXT,
  inspectPaymentHeader,
  inspectPaymentResponse,
  type LogEvent,
  recordRequest,
  safeSerialise,
} from '../src/index.js';
import {
  address,
  b64,
  type Canaries,
  expectNoCanary,
  expectNoPayer,
  makeCanaries,
  paymentHeader,
  permit2Header,
  printedForms,
  shows,
  txHash,
} from './evidence-helpers.js';

let written: string[] = [];
beforeEach(() => {
  written = [];
  const capture = (chunk: unknown) => {
    written.push(String(chunk));
    return true;
  };
  vi.spyOn(process.stdout, 'write').mockImplementation(capture as never);
  vi.spyOn(process.stderr, 'write').mockImplementation(capture as never);
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void written.push(a.map((x) => inspect(x)).join(' ')));
  }
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** Everything the run could show: each value's printed forms, plus all captured stdout/stderr. */
function outputs(...values: unknown[]): string[] {
  return [...values.flatMap(printedForms), ...written];
}

/** Every fake except the payer (checked separately, in full and short form). */
const others = (c: Canaries): Record<string, string> => {
  const { payer: _payer, ...rest } = c;
  return rest;
};

describe('canary suite', () => {
  it('the checker itself sees a canary in each form it looks for', () => {
    const c = makeCanaries();
    expect(shows(`x${c.signature}x`, c.signature)).toBe(true);
    expect(shows(c.signature.toUpperCase(), c.signature)).toBe(true);
    expect(shows(c.signature.slice(30, 38), c.signature)).toBe(true);
    expect(shows(Buffer.from(c.apiToken).toString('base64'), c.apiToken)).toBe(true);
    expect(shows(Buffer.from(c.apiToken).toString('hex'), c.apiToken)).toBe(true);
    expect(shows('nothing here', c.signature)).toBe(false);
    expect(() => expectNoCanary([c.nonce], others(c))).toThrow('canary shown: nonce');
    expect(() => expectNoCanary([c.nonce], others(c))).not.toThrow(c.nonce);
  });

  it('a good payment header: only terms and a fingerprint come out', () => {
    const c = makeCanaries();
    const ctx = createRunContext();
    const value = paymentHeader({ from: c.payer, to: address(), nonce: c.nonce, signature: c.signature });
    const o = inspectPaymentHeader(ctx, 'PAYMENT-SIGNATURE', value);
    expect(o.fingerprint).toMatch(/^fp1:/);
    const out = outputs(o, ctx);
    expectNoCanary(out, { ...others(c), header: value });
    expectNoPayer(out, c.payer);
  });

  it('a malformed payment header that makes JSON.parse fail: fixed message, no cause, nothing quoted', () => {
    const c = makeCanaries();
    const ctx = createRunContext();
    const text = `[{"nonce":"${c.nonce}"},"${c.signature}",]`;
    // Sanity: Node's own error would quote the input. Ours must not.
    let raw = '';
    try {
      JSON.parse(text);
    } catch (e) {
      raw = (e as Error).message;
    }
    expect(shows(raw, c.signature)).toBe(true);
    const value = Buffer.from(text).toString('base64');
    const d = decodePaymentSignature(ctx, value);
    expect(d.ok).toBe(false);
    if (d.ok) return;
    expect(d.reason).toBe('undecodable');
    expect(d.error.message).toBe(EVIDENCE_TEXT.headerUndecodable);
    expect(d.error.cause).toBeUndefined();
    const b = decodeBase64Json(value);
    expect(b.ok).toBe(false);
    const o = inspectPaymentHeader(ctx, 'payment-signature', value);
    expect(o.noFingerprintReason).toBe('undecodable');
    expectNoCanary(outputs(d, d.error, b, o, ctx), { ...others(c), header: value });
  });

  it('a malformed payment header that fails the schema: fixed message, no cause, nothing quoted', () => {
    const c = makeCanaries();
    const ctx = createRunContext();
    // Valid JSON in the EIP-3009 shape, but the payer is not an address and validBefore is not digits.
    const value = paymentHeader({
      from: `not-${c.payer}`,
      to: address(),
      nonce: c.nonce,
      signature: c.signature,
      validBefore: c.apiToken,
    });
    const d = decodePaymentSignature(ctx, value);
    expect(d.ok).toBe(false);
    if (d.ok) return;
    expect(d.reason).toBe('missing-fields');
    expect(d.error.message).toBe(EVIDENCE_TEXT.headerUndecodable);
    expect(d.error.cause).toBeUndefined();
    const o = inspectPaymentHeader(ctx, 'payment-signature', value);
    const out = outputs(d, d.error, o, ctx);
    expectNoCanary(out, { ...others(c), header: value });
    expectNoPayer(out, c.payer);
  });

  it('a Permit2 payment, a version 1 header and a non-text value keep name and length only', () => {
    const c = makeCanaries();
    const ctx = createRunContext();
    const permit = permit2Header(c.payer, address(), c.signature, c.privateKey);
    const v1 = b64({
      x402Version: 1,
      scheme: 'exact',
      payload: { signature: c.privateKey0x, authorization: { nonce: c.nonce } },
    });
    const obs = [
      inspectPaymentHeader(ctx, 'payment-signature', permit),
      inspectPaymentHeader(ctx, 'X-PAYMENT', v1),
      inspectPaymentHeader(ctx, 'payment-signature', [c.apiToken]),
    ];
    const out = outputs(obs, ctx);
    expectNoCanary(out, { ...others(c), permit, v1 });
    expectNoPayer(out, c.payer);
  });

  it('a whole request: secrets in headers, query string, credentials, fragment, cookies and body', () => {
    const c = makeCanaries();
    const ctx = createRunContext();
    const header = paymentHeader({ from: c.payer, to: address(), nonce: c.nonce, signature: c.signature });
    const r = recordRequest(ctx, {
      method: 'POST',
      url: `https://someone:${c.basicPassword}@seller.test/api/a?token=${c.queryValue}&k=${c.privateKey}#${c.fragment}`,
      requestHeaders: [
        ['payment-signature', header],
        ['Authorization', `Bearer ${c.apiToken}`],
        ['Cookie', c.cookie],
        ['X-Wallet-Phrase', c.mnemonic],
        ['X-Extended-Key', c.xprv],
        ['X-Raw-Key', c.privateKey0x],
        ['Accept', 'application/json'],
      ],
      status: 200,
      responseHeaders: [
        ['Set-Cookie', [c.cookie]],
        ['X-Session-Token', c.apiToken],
        ['Content-Type', 'application/json'],
        ['PAYMENT-RESPONSE', b64({ success: true, transaction: txHash(), network: 'eip155:84532', payer: c.payer })],
      ],
      body: `{"secret":"${c.bodySecret}","phrase":"${c.mnemonic}"}`,
    });
    expect(r.payment?.fingerprint).toMatch(/^fp1:/);
    const lines: string[] = [];
    const log = createLogger(ctx, (l) => lines.push(l));
    log.log({ event: 'request-recorded', method: r.method, path: r.url?.path ?? null, status: r.status });
    log.log({
      event: 'payment-observed',
      headerName: r.payment?.headerName ?? '',
      length: r.payment?.length ?? null,
      decoded: true,
      fingerprint: r.payment?.fingerprint ?? null,
      noFingerprintReason: null,
    });
    const out = outputs(r, ctx, lines, safeSerialise(ctx, r), checkEvidence(ctx, r));
    expectNoCanary(out, { ...others(c), header });
    expectNoPayer(out, c.payer);
    expect(ctx.withheld).toBe(0);
  });

  it('a settlement reply: the payer and a free-text error are never kept', () => {
    const c = makeCanaries();
    const ctx = createRunContext();
    const s = inspectPaymentResponse(
      ctx,
      'payment-response',
      b64({
        success: false,
        transaction: c.signature,
        payer: c.payer,
        errorReason: c.privateKey,
        errorMessage: `failed for ${c.apiToken}`,
      }),
    );
    expect(s.transactionHash).toBeUndefined();
    expect(s.errorReason).toEqual({ codeLength: 64 });
    const out = outputs(s, ctx);
    expectNoCanary(out, others(c));
    expectNoPayer(out, c.payer);
  });

  it('the logger withholds any event holding a canary, including objects that are not events', () => {
    const c = makeCanaries();
    const ctx = createRunContext();
    for (const v of Object.values(c)) ctx.registerSecret(v);
    const lines: string[] = [];
    const log = createLogger(ctx, (l) => lines.push(l));
    log.log({ event: 'run-started', runId: c.nonce });
    log.log({ event: 'request-recorded', method: 'GET', path: `/a/${c.queryValue}`, status: 200 });
    log.log({ event: 'settlement-observed', success: true, transactionHash: c.privateKey0x });
    log.log({ event: 'run-started', runId: 'x', secret: c.signature } as unknown as LogEvent);
    log.log({ text: c.mnemonic } as unknown as LogEvent);
    log.log(c as unknown as LogEvent);
    expect(ctx.withheld).toBe(6);
    expectNoCanary(outputs(lines, ctx), others(c));
    expectNoPayer(outputs(lines), c.payer);
  });

  it('a schema failure on evidence holding canaries: fixed message, no cause', () => {
    const c = makeCanaries();
    const ctx = createRunContext();
    const r = checkEvidence(ctx, { kind: 'request-record', header: c.signature, nested: { key: c.xprv } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toBe(EVIDENCE_TEXT.evidenceShapeMismatch);
    expect(r.error.cause).toBeUndefined();
    expect(ctx.withheld).toBe(1);
    expectNoCanary(outputs(r, r.error, ctx), others(c));
  });

  it('nothing in the evidence code writes to standard output or standard error', () => {
    const c = makeCanaries();
    const ctx = createRunContext();
    recordRequest(ctx, {
      method: 'GET',
      url: `https://seller.test/a?t=${c.queryValue}`,
      requestHeaders: {
        'payment-signature': paymentHeader({ from: c.payer, to: address(), nonce: c.nonce, signature: c.signature }),
      },
    });
    inspectPaymentHeader(ctx, 'payment-signature', 'garbage');
    expect(written).toEqual([]);
  });
});
