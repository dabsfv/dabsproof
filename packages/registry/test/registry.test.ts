import { describe, expect, it } from 'vitest';
import {
  BASE_SEPOLIA,
  CheckSchema,
  COVERS_ONLY,
  checks,
  GENERAL_GUIDANCE,
  getCheck,
  OUTCOME_LABEL,
  OUTCOMES,
  type RegistryEntry,
} from '../src/index.js';

const full = checks.filter((c) => c.status === 'active' || c.status === 'experimental');
const sellerText = (e: RegistryEntry): string => JSON.stringify(e);

describe('registry entries', () => {
  it('has the nine expected IDs, each once', () => {
    const ids = checks.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      'X402-01',
      'X402-02',
      'X402-03',
      'X402-04',
      'X402-05',
      'X402-06',
      'X402-07',
      'X402-08',
      'X402-03.upstream-binding',
    ]);
  });

  it('keeps X402-08 retired', () => {
    expect(getCheck('X402-08')?.status).toBe('retired');
  });

  it('marks 01 to 07 experimental until they have an implementation', () => {
    expect(full.map((c) => c.status)).toEqual(Array(7).fill('experimental'));
  });

  it('gives the upstream-binding watch entry the status "could not verify"', () => {
    const w = getCheck('X402-03.upstream-binding');
    expect(w?.status === 'watch' && w.watch.status).toBe('could-not-verify');
  });

  it('uses sub-check IDs that are unique across the registry', () => {
    const subs = full.flatMap((c) => (c.status === 'active' || c.status === 'experimental' ? c.subChecks : []));
    expect(new Set(subs.map((s) => s.id)).size).toBe(subs.length);
  });

  it('applies to x402 version 2 on Base Sepolia only', () => {
    for (const c of full) {
      if (c.status !== 'active' && c.status !== 'experimental') continue;
      expect(c.appliesTo.x402Versions).toEqual([2]);
      expect(c.appliesTo.networks).toEqual([BASE_SEPOLIA]);
    }
  });

  it('keeps budgets as drafts within the run limits', () => {
    for (const c of full) {
      if (c.status !== 'active' && c.status !== 'experimental') continue;
      expect(c.budget.draft).toBe(true);
      expect(c.budget.requestsPerRoute).toBeLessThanOrEqual(20);
      expect(c.budget.burst).toBeLessThanOrEqual(10);
    }
  });

  it('ends every "found no problem" text with the coverage sentence, and carries the guidance line', () => {
    for (const c of full) {
      if (c.status !== 'active' && c.status !== 'experimental') continue;
      expect(c.outcomes['found-no-problem'].endsWith(COVERS_ONLY)).toBe(true);
      expect(c.remediation.generalGuidance).toBe(GENERAL_GUIDANCE);
    }
  });

  it('holds no upstream issue or PR numbers, no fix-kit mentions and no "standard practice"', () => {
    for (const c of checks) {
      const t = sellerText(c);
      expect(t).not.toMatch(/#\d+|\b(?:PR|pull request|issue)\s*#?\d+/i);
      expect(t).not.toMatch(/fix kit|server half/i);
      expect(t).not.toMatch(/standard practice/i);
    }
  });
});

describe('outcome words', () => {
  it('are exactly the four outcomes, with fixed labels', () => {
    expect([...OUTCOMES]).toEqual(['found-a-problem', 'found-no-problem', 'could-not-verify', 'not-applicable']);
    expect(OUTCOME_LABEL).toEqual({
      'found-a-problem': 'found a problem',
      'found-no-problem': 'found no problem',
      'could-not-verify': 'could not verify',
      'not-applicable': 'not applicable',
    });
  });
});

describe('the schema refuses', () => {
  const base = structuredClone(getCheck('X402-01')) as Record<string, unknown> & {
    outcomes: Record<string, string>;
    budget: Record<string, unknown>;
    remediation: Record<string, unknown>;
  };
  const refuses = (change: (e: typeof base) => void) => {
    const e = structuredClone(base);
    change(e);
    return CheckSchema.safeParse(e).success === false;
  };

  it('accepts the unchanged entry', () => {
    expect(CheckSchema.safeParse(base).success).toBe(true);
  });
  it('a "pass" or "fail" outcome', () => {
    expect(refuses((e) => Object.assign(e.outcomes, { pass: 'x' }))).toBe(true);
    expect(refuses((e) => Object.assign(e.outcomes, { fail: 'x' }))).toBe(true);
  });
  it('a missing outcome', () => {
    expect(refuses((e) => delete e.outcomes['not-applicable'])).toBe(true);
  });
  it('a "found no problem" text without the coverage sentence', () => {
    expect(refuses((e) => Object.assign(e.outcomes, { 'found-no-problem': 'All good.' }))).toBe(true);
  });
  it('more than 20 requests per route, or a burst over 10', () => {
    expect(refuses((e) => Object.assign(e.budget, { requestsPerRoute: 21 }))).toBe(true);
    expect(refuses((e) => Object.assign(e.budget, { burst: 11 }))).toBe(true);
  });
  it('a remediation without the guidance line', () => {
    expect(refuses((e) => delete e.remediation.generalGuidance)).toBe(true);
  });
  it('a network other than Base Sepolia, or x402 version 1', () => {
    expect(
      refuses((e) =>
        Object.assign(e, { appliesTo: { x402Versions: [2], schemes: ['exact'], networks: ['eip155:8453'] } }),
      ),
    ).toBe(true);
    expect(
      refuses((e) =>
        Object.assign(e, { appliesTo: { x402Versions: [1], schemes: ['exact'], networks: [BASE_SEPOLIA] } }),
      ),
    ).toBe(true);
  });
  it('a sub-check ID that does not start with its check ID', () => {
    expect(refuses((e) => Object.assign(e, { subChecks: [{ id: 'X402-02.burst', title: 'x', kind: 'live' }] }))).toBe(
      true,
    );
  });
  it('a version that does not match the newest changelog line', () => {
    expect(refuses((e) => Object.assign(e, { version: 2 }))).toBe(true);
  });
});

describe('X402-03 version 3 is append-only', () => {
  const c = getCheck('X402-03');
  const subs = c?.status === 'experimental' ? c.subChecks : [];
  const text = (id: string) => subs.find((s) => s.id === id)?.static;
  it('keeps the version 2 static texts word for word', () => {
    expect(text('X402-03.cross-route')?.['found-no-problem']).toBe(
      `No two routes in your route manifest share the same network, asset, price and payment address. ${COVERS_ONLY}`,
    );
    expect(text('X402-03.dup-index')?.['found-no-problem']).toBe(
      `No two routes in your route manifest are given the same address index. ${COVERS_ONLY}`,
    );
  });
  it('adds the within-scheme texts and the static not-applicable text', () => {
    expect(text('X402-03.cross-route')?.['found-no-problem-within-scheme']).toContain(
      'that use the same payment scheme',
    );
    expect(text('X402-03.dup-index')?.['found-no-problem-within-scheme']).toContain('that use the same payment scheme');
    expect(text('X402-03.cross-route')?.['not-applicable']).toBe(
      'Fewer than two of the routes checked share the same payment scheme, network, asset and price, so there was nothing to compare.',
    );
  });
  it('has a changelog line for version 3', () => {
    expect(c?.changelog.find((l) => l.version === 3)?.change).toContain('within one payment scheme');
  });
});
