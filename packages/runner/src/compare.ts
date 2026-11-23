// Compares what the probe's replies ask for, across routes, without any payment. The result is facts
// about the replies only: no outcome and no check or sub-check ID. Two routes asking for identical
// terms says nothing about whether a payment made for one would be accepted by the other; that needs
// a payment, which this does not make. Only public terms are copied (scheme, network, asset, amount,
// payTo, maxTimeoutSeconds) and the resource path; never a header value or a body digest.
import type { ProbeEntry } from './probe.js';

/** One accepts entry of one reply. index is the entry's position in the probe's entries; accept is its position in the reply. */
export interface ComparedOption {
  index: number;
  accept: number;
  route: string;
  resourcePath: string | null;
}

export type Sameness = 'same' | 'different';

export interface PairFacts {
  a: ComparedOption;
  b: ComparedOption;
  scheme: string;
  payTo: Sameness;
  network: Sameness;
  asset: Sameness;
  amount: Sameness;
  /** not-kept when either reply's value was not kept by core's inspector. */
  maxTimeoutSeconds: Sameness | 'not-kept';
}

export type NotComparedCode =
  | 'not-402'
  | 'payment-required-missing'
  | 'payment-required-undecodable'
  | 'no-accepts'
  | 'accepts-entry-dropped'
  | 'accepts-over-cap';

export interface NotCompared {
  index: number;
  route: string;
  /** For a route that was not sent, the probe's own code; otherwise why this reply, or one entry of it, was left out. */
  code: string;
  /** For accepts-entry-dropped, the entry's position in the reply; for accepts-over-cap, how many entries were past the cap. */
  accept?: number;
  count?: number;
}

export interface Comparison {
  /** Accepts entries that took part in the comparison. */
  compared: number;
  pairs: PairFacts[];
  /** Options whose scheme, network, asset, amount and payTo are all identical: identical asked terms, nothing about acceptance. */
  sameTerms: ComparedOption[][];
  notCompared: NotCompared[];
}

interface Option extends ComparedOption {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number | undefined;
}

const same = (x: unknown, y: unknown): Sameness => (x === y ? 'same' : 'different');
const publicOf = (o: Option): ComparedOption => ({
  index: o.index,
  accept: o.accept,
  route: o.route,
  resourcePath: o.resourcePath,
});

/** Compares the asked terms of every pair of replies from different entries, within one scheme. */
export function compareRoutes(entries: readonly ProbeEntry[]): Comparison {
  const options: Option[] = [];
  const notCompared: NotCompared[] = [];
  entries.forEach((e, index) => {
    if (!e.sent) {
      notCompared.push({ index, route: e.route, code: e.code });
      return;
    }
    const rec = e.record;
    const pr = rec.paymentRequired;
    const left: NotComparedCode | null =
      rec.status !== 402
        ? 'not-402'
        : pr === null
          ? 'payment-required-missing'
          : !pr.decoded
            ? 'payment-required-undecodable'
            : pr.accepts.length === 0 && pr.acceptsOverCap === 0
              ? 'no-accepts'
              : null;
    if (left !== null || pr === null) {
      notCompared.push({ index, route: e.route, code: left ?? 'payment-required-missing' });
      return;
    }
    if (pr.acceptsOverCap > 0) {
      notCompared.push({ index, route: e.route, code: 'accepts-over-cap', count: pr.acceptsOverCap });
    }
    pr.accepts.forEach((t, accept) => {
      const { scheme, network, asset, amount, payTo } = t;
      if (
        scheme === undefined ||
        network === undefined ||
        asset === undefined ||
        amount === undefined ||
        payTo === undefined
      ) {
        notCompared.push({ index, route: e.route, code: 'accepts-entry-dropped', accept });
        return;
      }
      const resourcePath = pr.resource ? pr.resource.path : null;
      options.push({
        index,
        accept,
        route: e.route,
        resourcePath,
        scheme,
        network,
        asset,
        amount,
        payTo,
        maxTimeoutSeconds: t.maxTimeoutSeconds,
      });
    });
  });

  const pairs: PairFacts[] = [];
  for (let i = 0; i < options.length; i++) {
    for (let j = i + 1; j < options.length; j++) {
      const a = options[i] as Option;
      const b = options[j] as Option;
      if (a.index === b.index || a.scheme !== b.scheme) continue;
      pairs.push({
        a: publicOf(a),
        b: publicOf(b),
        scheme: a.scheme,
        payTo: same(a.payTo, b.payTo),
        network: same(a.network, b.network),
        asset: same(a.asset, b.asset),
        amount: same(a.amount, b.amount),
        maxTimeoutSeconds:
          a.maxTimeoutSeconds === undefined || b.maxTimeoutSeconds === undefined
            ? 'not-kept'
            : same(a.maxTimeoutSeconds, b.maxTimeoutSeconds),
      });
    }
  }

  // Identical asked terms: the same scheme, network, asset, amount and payTo. This shows only what the
  // replies ask for. It says nothing about whether the seller would accept one payment on both routes.
  const byTerms = new Map<string, Option[]>();
  for (const o of options) {
    const key = JSON.stringify([o.scheme, o.network, o.asset, o.amount, o.payTo]);
    byTerms.set(key, [...(byTerms.get(key) ?? []), o]);
  }
  const sameTerms = [...byTerms.values()]
    .filter((g) => new Set(g.map((o) => o.index)).size > 1)
    .map((g) => g.map(publicOf));

  return { compared: options.length, pairs, sameTerms, notCompared };
}
