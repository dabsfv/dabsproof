// Checking a payment request against the policy, with a fake clock and a fake random source. No key,
// no signature and no real nonce: addresses are made-up repeats, and nonces are made from repeating
// byte patterns at run time. Expected digests are computed with transferDigest in the test, so no
// 64-hex value is written here.
import { inspect } from 'node:util';
import { BASE_SEPOLIA } from '@dabsproof/registry';
import { describe, expect, it } from 'vitest';
import {
  type AuthoriseInput,
  authorise,
  isCheckedPlan,
  MAX_PER_RUN_UNITS,
  MAX_PER_SIGNATURE_UNITS,
  readPlanForSigning,
} from '../src/authorise.js';
import { TRANSFER_DOMAIN, transferDigest } from '../src/typed-data.js';

const PAYER = `0x${'1'.repeat(40)}`;
const PAYEE = `0x${'2'.repeat(40)}`;
const RELAYER = `0x${'3'.repeat(40)}`;
const NOW = 1_700_000_000;
const fill = (byte: number) => (n: number) => new Uint8Array(n).fill(byte);
const MARK = 'zz-input-marker-zz';

type Req = Record<string, unknown>;
type Pol = Record<string, unknown>;
const req = (o: Req = {}): Req => ({
  scheme: 'exact',
  network: BASE_SEPOLIA,
  asset: TRANSFER_DOMAIN.verifyingContract,
  amount: '1000',
  payTo: PAYEE,
  maxTimeoutSeconds: 300,
  extra: { name: 'USDC', version: '2' },
  ...o,
});
const pol = (o: Pol = {}): Pol => ({
  payees: [PAYEE],
  perSignatureCap: '100000',
  perRunCap: '1000000',
  spentSoFar: '0',
  excluded: [RELAYER],
  ...o,
});
const run = (r: Req = req(), p: Pol = pol(), extra: Partial<AuthoriseInput> = {}) =>
  authorise({ requirements: r, payer: PAYER, policy: p, clock: () => NOW, random: fill(0xa5), ...extra });
const reasonOf = (r: ReturnType<typeof authorise>) => (r.ok ? 'ok' : r.reason);
const addr = (c: string) => `0x${c.repeat(40)}`;

describe('authorise: a request that passes every check', () => {
  it('gives a frozen checked plan with the public terms and a digest for exactly those terms', () => {
    const r = run();
    if (!r.ok) throw new Error(r.reason);
    const p = r.plan;
    expect(isCheckedPlan(p)).toBe(true);
    expect(Object.isFrozen(p)).toBe(true);
    expect([p.network, p.asset, p.from, p.to, p.value, p.validAfter, p.validBefore]).toEqual([
      BASE_SEPOLIA,
      TRANSFER_DOMAIN.verifyingContract,
      PAYER,
      PAYEE,
      '1000',
      '0',
      String(NOW + 300),
    ]);
    const s = readPlanForSigning(p);
    expect(s?.nonce).toBe(`0x${'a5'.repeat(32)}`);
    const expected = transferDigest({
      from: PAYER,
      to: PAYEE,
      value: '1000',
      validAfter: '0',
      validBefore: String(NOW + 300),
      nonce: `0x${'a5'.repeat(32)}`,
    });
    expect(expected.ok && s?.digestHex === expected.digestHex).toBe(true);
    expect(Object.isFrozen(s)).toBe(true);
  });
  it('two runs with different random bytes give different nonces and digests', () => {
    const a = run(req(), pol(), { random: fill(0x11) });
    const b = run(req(), pol(), { random: fill(0x22) });
    if (!a.ok || !b.ok) throw new Error('refused');
    const sa = readPlanForSigning(a.plan);
    const sb = readPlanForSigning(b.plan);
    expect(sa?.nonce === sb?.nonce).toBe(false);
    expect(sa?.digestHex === sb?.digestHex).toBe(false);
  });
});

describe('authorise: each reason code', () => {
  it('shape-not-allowed: not an object, wrong policy types, or a scheme other than exact', () => {
    // undefined is not in this list: run() would put the default request in its place. It is covered
    // by authorise(undefined) in the test that no failure throws.
    for (const r of [null, 42, 'x', []]) expect(reasonOf(run(r as unknown as Req))).toBe('shape-not-allowed');
    expect(reasonOf(run(req(), null as unknown as Pol))).toBe('shape-not-allowed');
    expect(reasonOf(run(req(), pol({ payees: PAYEE })))).toBe('shape-not-allowed');
    expect(reasonOf(run(req(), pol({ perSignatureCap: 100000 })))).toBe('shape-not-allowed');
    expect(reasonOf(run(req(), pol(), { clock: 5 as unknown as () => number }))).toBe('shape-not-allowed');
    for (const scheme of ['upto', 'EXACT', '', undefined])
      expect(reasonOf(run(req({ scheme })))).toBe('shape-not-allowed');
  });
  it('payer-invalid', () => {
    for (const payer of ['', '0x12', MARK, null]) {
      const r = authorise({ requirements: req(), payer, policy: pol(), clock: () => NOW, random: fill(1) });
      expect(reasonOf(r)).toBe('payer-invalid');
    }
  });
  it('policy-invalid: caps above the hard limits, a zero cap, a bad total or a bad excluded address', () => {
    expect(reasonOf(run(req(), pol({ perSignatureCap: (MAX_PER_SIGNATURE_UNITS + 1n).toString() })))).toBe(
      'policy-invalid',
    );
    expect(reasonOf(run(req(), pol({ perRunCap: (MAX_PER_RUN_UNITS + 1n).toString() })))).toBe('policy-invalid');
    expect(reasonOf(run(req(), pol({ perSignatureCap: '0' })))).toBe('policy-invalid');
    expect(reasonOf(run(req(), pol({ spentSoFar: '-1' })))).toBe('policy-invalid');
    expect(reasonOf(run(req(), pol({ excluded: ['0x12'] })))).toBe('policy-invalid');
  });
  it('chain-id-mismatch', () => {
    for (const network of ['eip155:8453', 'eip155:1', '', undefined]) {
      expect(reasonOf(run(req({ network })))).toBe('chain-id-mismatch');
    }
  });
  it('token-not-allowed', () => {
    for (const asset of [addr('4'), '', undefined]) expect(reasonOf(run(req({ asset })))).toBe('token-not-allowed');
    expect(reasonOf(run(req({ asset: TRANSFER_DOMAIN.verifyingContract.toLowerCase() })))).toBe('ok');
  });
  it('domain-mismatch', () => {
    for (const extra of [undefined, {}, { name: 'USD Coin', version: '2' }, { name: 'USDC', version: '1' }]) {
      expect(reasonOf(run(req({ extra })))).toBe('domain-mismatch');
    }
  });
  it('transfer-method-not-allowed', () => {
    for (const assetTransferMethod of ['permit2', 'EIP3009', '']) {
      expect(reasonOf(run(req({ extra: { name: 'USDC', version: '2', assetTransferMethod } })))).toBe(
        'transfer-method-not-allowed',
      );
    }
    expect(reasonOf(run(req({ extra: { name: 'USDC', version: '2', assetTransferMethod: 'eip3009' } })))).toBe('ok');
  });
  it('payee-list-invalid: empty, too long, a bad or zero address, the payer, an excluded address or the token', () => {
    for (const payees of [
      [],
      ['0x12'],
      [addr('0')],
      [PAYER],
      [RELAYER],
      [TRANSFER_DOMAIN.verifyingContract],
      [PAYEE, addr('5'), addr('6'), addr('7'), addr('8'), addr('9')],
    ]) {
      expect(reasonOf(run(req(), pol({ payees })))).toBe('payee-list-invalid');
    }
  });
  it('payee-not-allowed', () => {
    for (const payTo of [addr('4'), '', undefined]) expect(reasonOf(run(req({ payTo })))).toBe('payee-not-allowed');
    expect(reasonOf(run(req({ payTo: PAYEE.toUpperCase().replace('0X', '0x') })))).toBe('ok');
  });
  it('amount-invalid', () => {
    for (const amount of ['0', '-1', '01', '1.5', '1e3', '', 1000, undefined]) {
      expect(reasonOf(run(req({ amount })))).toBe('amount-invalid');
    }
  });
  it('amount-over-signature-cap, including a cap the caller lowered', () => {
    expect(reasonOf(run(req({ amount: '100001' })))).toBe('amount-over-signature-cap');
    expect(reasonOf(run(req({ amount: '501' }), pol({ perSignatureCap: '500' })))).toBe('amount-over-signature-cap');
  });
  it('amount-over-run-cap', () => {
    expect(reasonOf(run(req({ amount: '1000' }), pol({ spentSoFar: '999001' })))).toBe('amount-over-run-cap');
  });
  it('window-invalid', () => {
    for (const maxTimeoutSeconds of [0, -1, 1.5, '300', Number.NaN, undefined]) {
      expect(reasonOf(run(req({ maxTimeoutSeconds })))).toBe('window-invalid');
    }
  });
  it('window-too-long', () => {
    expect(reasonOf(run(req({ maxTimeoutSeconds: 301 })))).toBe('window-too-long');
  });
  it('clock-failed: a clock that throws or does not give whole seconds', () => {
    for (const clock of [
      () => {
        throw new Error(MARK);
      },
      () => Number.NaN,
      () => -1,
      () => 1.5,
    ]) {
      expect(reasonOf(run(req(), pol(), { clock }))).toBe('clock-failed');
    }
  });
  it('random-source-failed', () => {
    for (const random of [
      fill(1).bind(null, 31),
      () => new Uint8Array(31),
      () => new Uint8Array(33),
      () => [1, 2, 3] as unknown as Uint8Array,
      () => {
        throw new Error(MARK);
      },
    ]) {
      expect(reasonOf(run(req(), pol(), { random: random as (n: number) => Uint8Array }))).toBe('random-source-failed');
    }
  });
  it('random-source-failed: a random source that gives 32 zero bytes', () => {
    expect(reasonOf(run(req(), pol(), { random: (n) => new Uint8Array(n) }))).toBe('random-source-failed');
  });
  it('clock-failed: a clock so late that the end of the window is not a safe integer', () => {
    expect(reasonOf(run(req(), pol(), { clock: () => Number.MAX_SAFE_INTEGER }))).toBe('clock-failed');
  });
});

describe('authorise: boundaries', () => {
  it('an amount exactly at the per-signature cap passes, one more fails', () => {
    expect(reasonOf(run(req({ amount: '100000' })))).toBe('ok');
    expect(reasonOf(run(req({ amount: '100001' })))).toBe('amount-over-signature-cap');
  });
  it('a total exactly at the per-run cap passes, one more fails', () => {
    expect(reasonOf(run(req({ amount: '1000' }), pol({ spentSoFar: '999000' })))).toBe('ok');
    expect(reasonOf(run(req({ amount: '1001' }), pol({ spentSoFar: '999000' })))).toBe('amount-over-run-cap');
  });
  it('caps exactly at the hard limits pass, one more is policy-invalid', () => {
    expect(reasonOf(run(req(), pol({ perSignatureCap: '100000', perRunCap: '1000000' })))).toBe('ok');
    expect(reasonOf(run(req(), pol({ perSignatureCap: '100001' })))).toBe('policy-invalid');
    expect(reasonOf(run(req(), pol({ perRunCap: '1000001' })))).toBe('policy-invalid');
  });
  it('a window of 300 s passes, 301 fails', () => {
    expect(reasonOf(run(req({ maxTimeoutSeconds: 300 })))).toBe('ok');
    expect(reasonOf(run(req({ maxTimeoutSeconds: 301 })))).toBe('window-too-long');
  });
  it('exactly 5 payees pass, 6 fail', () => {
    const five = [PAYEE, addr('5'), addr('6'), addr('7'), addr('8')];
    expect(reasonOf(run(req(), pol({ payees: five })))).toBe('ok');
    expect(reasonOf(run(req(), pol({ payees: [...five, addr('9')] })))).toBe('payee-list-invalid');
  });
});

describe('authorise: order, printing and look-alikes', () => {
  it('runs the checks in order: a request that breaks two rules gives the first', () => {
    expect(reasonOf(run(req({ scheme: 'upto', network: 'eip155:1' })))).toBe('shape-not-allowed');
    expect(reasonOf(run(req({ network: 'eip155:1', asset: addr('4') })))).toBe('chain-id-mismatch');
    expect(reasonOf(run(req({ asset: addr('4'), extra: {} })))).toBe('token-not-allowed');
    expect(reasonOf(run(req({ extra: { assetTransferMethod: 'permit2' } })))).toBe('domain-mismatch');
    expect(reasonOf(run(req({ payTo: addr('4'), amount: '0' }), pol({ payees: [] })))).toBe('payee-list-invalid');
    expect(reasonOf(run(req({ payTo: addr('4'), amount: '0' })))).toBe('payee-not-allowed');
    expect(reasonOf(run(req({ amount: '100001', maxTimeoutSeconds: 301 })))).toBe('amount-over-signature-cap');
    expect(reasonOf(run(req({ maxTimeoutSeconds: 301 }), pol(), { random: () => new Uint8Array(1) }))).toBe(
      'window-too-long',
    );
  });
  it('the plan prints as [CheckedPlan] four ways, with no nonce, digest or address in any of them', () => {
    const r = run();
    if (!r.ok) throw new Error(r.reason);
    const s = readPlanForSigning(r.plan);
    const printed = [JSON.stringify(r.plan), String(r.plan), `${r.plan}`, inspect(r.plan, { showHidden: true })];
    expect(printed).toEqual(['"[CheckedPlan]"', '[CheckedPlan]', '[CheckedPlan]', '[CheckedPlan]']);
    const all = [...printed, JSON.stringify(r), inspect(r, { depth: 5 })].join('\n').toLowerCase();
    for (const hidden of [s?.nonce, s?.digestHex, PAYER, PAYEE]) {
      expect(all.includes(String(hidden).toLowerCase())).toBe(false);
    }
    expect(Object.keys(r.plan)).toEqual([]);
  });
  it('a look-alike object, or one built from the same class, is not a checked plan', () => {
    const r = run();
    if (!r.ok) throw new Error(r.reason);
    const Ctor = r.plan.constructor as new (...a: string[]) => object;
    const lookAlikes = [
      { network: BASE_SEPOLIA, from: PAYER, to: PAYEE, value: '1000', validAfter: '0' },
      Object.create(Object.getPrototypeOf(r.plan)),
      new Ctor(PAYER, PAYEE, '1000', '1'),
      { ...r.plan },
      null,
      '[CheckedPlan]',
    ];
    for (const x of lookAlikes) {
      expect(isCheckedPlan(x)).toBe(false);
      expect(readPlanForSigning(x)).toBe(null);
    }
  });
  it('no failure throws, and no result holds any input text', () => {
    const throwing = new Proxy(
      {},
      {
        get() {
          throw new Error(MARK);
        },
      },
    );
    const cases: (() => ReturnType<typeof authorise>)[] = [
      () => run(throwing as Req),
      () => run(req(), throwing as Pol),
      () => authorise(undefined as unknown as AuthoriseInput),
      ...['scheme', 'network', 'asset', 'amount', 'payTo', 'maxTimeoutSeconds', 'extra'].map(
        (k) => () => run(req({ [k]: MARK })),
      ),
      ...['payees', 'perSignatureCap', 'perRunCap', 'spentSoFar', 'excluded'].map(
        (k) => () => run(req(), pol({ [k]: MARK })),
      ),
      () => run(req(), pol({ payees: [MARK] })),
    ];
    for (const c of cases) {
      let r: unknown;
      expect(() => {
        r = c();
      }).not.toThrow();
      expect((r as { ok: boolean }).ok).toBe(false);
      expect(JSON.stringify(r).includes(MARK)).toBe(false);
    }
  });
});
