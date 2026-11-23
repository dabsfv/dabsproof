import { describe, expect, it } from 'vitest';
import { budgetFor, clampLimits, RequestBudget } from '../src/index.js';

describe('the request budget', () => {
  it("reads X402-01's budget from the registry", () => {
    expect(budgetFor('X402-01')).toEqual({ ok: true, limits: { requestsPerRoute: 20, burst: 10 } });
  });
  it('refuses unknown, retired and watch entries', () => {
    expect(budgetFor('X402-99')).toEqual({ ok: false, code: 'unknown-check' });
    expect(budgetFor('X402-08')).toEqual({ ok: false, code: 'no-budget' });
    expect(budgetFor('X402-03.upstream-binding')).toEqual({ ok: false, code: 'no-budget' });
  });
  it('clamps limits to 20 and 10', () => {
    expect(clampLimits({ requestsPerRoute: 100, burst: 50 })).toEqual({ requestsPerRoute: 20, burst: 10 });
    expect(clampLimits({ requestsPerRoute: -1, burst: 2.5 })).toEqual({ requestsPerRoute: 0, burst: 0 });
  });
  it('refuses a 21st request on one route', () => {
    const b = new RequestBudget({ requestsPerRoute: 20, burst: 10 });
    for (let i = 0; i < 20; i++) {
      const slot = b.begin('/a');
      expect(slot.ok).toBe(true);
      if (slot.ok) slot.release();
    }
    expect(b.begin('/a')).toEqual({ ok: false, code: 'route-request-limit' });
  });
  it('refuses an 11th request in flight, and allows it again after a release', () => {
    const b = new RequestBudget({ requestsPerRoute: 20, burst: 10 });
    const slots = Array.from({ length: 10 }, () => b.begin('/a'));
    expect(slots.every((s) => s.ok)).toBe(true);
    expect(b.begin('/a')).toEqual({ ok: false, code: 'burst-limit' });
    const first = slots[0];
    if (first?.ok) {
      first.release();
      first.release();
    }
    expect(b.begin('/a').ok).toBe(true);
    expect(b.begin('/a')).toEqual({ ok: false, code: 'burst-limit' });
  });
  it('counts each route separately', () => {
    const b = new RequestBudget({ requestsPerRoute: 1, burst: 1 });
    expect(b.begin('/a').ok).toBe(true);
    expect(b.begin('/a')).toEqual({ ok: false, code: 'route-request-limit' });
    expect(b.begin('/b').ok).toBe(true);
  });
});
