// Every static implementation has a registry sub-check with static text; every active check
// has an implementation for each of its static sub-checks.
import { checks, getCheck } from '@dabsproof/registry';
import { describe, expect, it } from 'vitest';
import { STATIC_IMPLEMENTATIONS } from '../src/index.js';

const implemented = new Set(STATIC_IMPLEMENTATIONS.map((i) => i.subCheckId));

describe('coverage', () => {
  it('each implementation has a registry sub-check with static text', () => {
    for (const id of implemented) {
      const check = getCheck(id.split('.')[0] ?? '');
      const sub =
        check && (check.status === 'active' || check.status === 'experimental')
          ? check.subChecks.find((s) => s.id === id)
          : undefined;
      expect(sub, `${id} is not in the registry`).toBeDefined();
      expect(sub?.static, `${id} has no static text`).toBeDefined();
      expect(['static', 'both']).toContain(sub?.kind);
      if (['X402-03.cross-route', 'X402-03.dup-index', 'X402-03.index-range-overlap'].includes(id)) {
        expect(sub?.static?.['found-no-problem-within-scheme'], `${id} has no within-scheme text`).toBeDefined();
      }
    }
  });

  it('each active check has every static sub-check implemented', () => {
    for (const c of checks) {
      if (c.status !== 'active') continue;
      for (const s of c.subChecks) {
        if (s.kind !== 'live') expect(implemented.has(s.id), `${s.id} has no implementation`).toBe(true);
      }
    }
  });

  it('keeps X402-03 experimental while 6 of its 9 sub-checks have a static part', () => {
    expect(getCheck('X402-03')?.status).toBe('experimental');
    expect([...implemented].sort()).toEqual([
      'X402-03.cross-route',
      'X402-03.dup-index',
      'X402-03.dynamic-per-pattern',
      'X402-03.index-range-overlap',
      'X402-03.stale-mapping',
      'X402-03.tiers',
    ]);
  });
});
