// Unit tests for compareRoutes. The entries are built by hand through core's own recordRequest, so
// they have the probe's shape; no request is sent anywhere. Every PAYMENT-REQUIRED value here is
// made-up test data, not a payment.
import { createRunContext, recordRequest } from '@dabsproof/core';
import { describe, expect, it } from 'vitest';
import { compareRoutes, type ProbeEntry } from '../src/index.js';

const ctx = createRunContext();
const address = (d: number) => `0x${String(d).repeat(40)}`;
const accept = (over: Record<string, unknown> = {}) => ({
  scheme: 'exact',
  network: 'eip155:84532',
  asset: address(1),
  amount: '1000',
  payTo: address(2),
  maxTimeoutSeconds: 300,
  extra: {},
  ...over,
});
const headerFor = (accepts: unknown[], path: string) =>
  Buffer.from(JSON.stringify({ x402Version: 2, resource: { url: `http://127.0.0.1:4319${path}` }, accepts })).toString(
    'base64',
  );

interface Opts {
  status?: number;
  raw?: string;
  noHeader?: boolean;
}
const sent = (route: string, accepts: unknown[], opts: Opts = {}): ProbeEntry => {
  const value = opts.raw ?? headerFor(accepts, route);
  const responseHeaders: Record<string, string> = opts.noHeader ? {} : { 'payment-required': value };
  const record = recordRequest(ctx, {
    method: 'GET',
    url: `http://127.0.0.1:4319${route}`,
    status: opts.status ?? 402,
    responseHeaders,
    body: '{}',
  });
  return { route, sent: true, record, network: null };
};
const HEX64 = /(?<![0-9a-fA-F])[0-9a-fA-F]{64}(?![0-9a-fA-F])/;

describe('compareRoutes', () => {
  it('routes asking identical terms are grouped, as a fact about the replies', () => {
    const c = compareRoutes([sent('/a', [accept()]), sent('/b', [accept()])]);
    expect(c.compared).toBe(2);
    expect(c.sameTerms).toEqual([
      [
        { index: 0, accept: 0, route: '/a', resourcePath: '/a' },
        { index: 1, accept: 0, route: '/b', resourcePath: '/b' },
      ],
    ]);
    expect(c.pairs).toEqual([
      {
        a: { index: 0, accept: 0, route: '/a', resourcePath: '/a' },
        b: { index: 1, accept: 0, route: '/b', resourcePath: '/b' },
        scheme: 'exact',
        payTo: 'same',
        network: 'same',
        asset: 'same',
        amount: 'same',
        maxTimeoutSeconds: 'same',
      },
    ]);
    expect(c.notCompared).toEqual([]);
  });
  it('routes that differ only in payTo, or only in amount, are not grouped', () => {
    const byPayTo = compareRoutes([sent('/a', [accept()]), sent('/b', [accept({ payTo: address(3) })])]);
    expect(byPayTo.sameTerms).toEqual([]);
    expect(byPayTo.pairs[0]).toMatchObject({ payTo: 'different', amount: 'same', network: 'same', asset: 'same' });
    const byAmount = compareRoutes([sent('/a', [accept()]), sent('/b', [accept({ amount: '2000' })])]);
    expect(byAmount.sameTerms).toEqual([]);
    expect(byAmount.pairs[0]).toMatchObject({ payTo: 'same', amount: 'different' });
  });
  it('routes are compared only within one scheme', () => {
    const c = compareRoutes([sent('/a', [accept()]), sent('/b', [accept({ scheme: 'upto' })])]);
    expect(c.compared).toBe(2);
    expect(c.pairs).toEqual([]);
    expect(c.sameTerms).toEqual([]);
  });
  it('a reply that is not a 402, or whose PAYMENT-REQUIRED is missing, undecodable, dropped or over the cap, is not compared', () => {
    const c = compareRoutes([
      sent('/ok', [accept()], { status: 200 }),
      sent('/none', [], { noHeader: true }),
      sent('/bad', [], { raw: 'not base64 json' }),
      sent('/dropped', [accept({ amount: '1e6' })]),
      sent(
        '/many',
        Array.from({ length: 21 }, () => accept()),
      ),
    ]);
    expect(c.notCompared).toEqual([
      { index: 0, route: '/ok', code: 'not-402' },
      { index: 1, route: '/none', code: 'payment-required-missing' },
      { index: 2, route: '/bad', code: 'payment-required-undecodable' },
      { index: 3, route: '/dropped', code: 'accepts-entry-dropped', accept: 0 },
      { index: 4, route: '/many', code: 'accepts-over-cap', count: 1 },
    ]);
    // The 20 kept entries of /many are all from one reply, so they form no pair and no group.
    expect(c.compared).toBe(20);
    expect(c.pairs).toEqual([]);
    expect(c.sameTerms).toEqual([]);
  });
  it('a route that was not sent is listed with its probe code', () => {
    const c = compareRoutes([{ route: '/x', sent: false, code: 'path-invalid' }, sent('/a', [accept()])]);
    expect(c.notCompared).toEqual([{ index: 0, route: '/x', code: 'path-invalid' }]);
    expect(c.compared).toBe(1);
  });
  it('the comparison holds no raw header value and no 64-hex string', () => {
    const accepts = [accept()];
    const values = [headerFor(accepts, '/a'), headerFor(accepts, '/b')];
    const s = JSON.stringify(compareRoutes([sent('/a', accepts), sent('/b', accepts)]));
    for (const v of values) expect(s.includes(v)).toBe(false);
    expect(HEX64.test(s)).toBe(false);
  });
});
