// Append-only rules: an ID never disappears, a retired ID stays retired, a sub-check ID is never
// removed, and severity, status or kind never change without a version bump.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checks, type RegistryEntry } from '../src/index.js';

interface Locked {
  version: number;
  status: string;
  kind: string | null;
  severity: string | null;
  subChecks: string[];
}
const lock: Record<string, Locked> = JSON.parse(readFileSync(new URL('./registry.lock.json', import.meta.url), 'utf8'));

function current(e: RegistryEntry): Locked {
  const full = e.status === 'active' || e.status === 'experimental';
  return {
    version: e.version,
    status: e.status,
    kind: e.status === 'retired' ? null : e.kind,
    severity: full ? e.severity : null,
    subChecks: full ? e.subChecks.map((s) => s.id) : [],
  };
}

describe('registry lock', () => {
  it('still has every locked ID', () => {
    const ids = new Set(checks.map((c) => c.id));
    for (const id of Object.keys(lock)) expect(ids.has(id), `${id} disappeared`).toBe(true);
  });

  for (const [id, was] of Object.entries(lock)) {
    it(`${id}: changes only with a version bump; retired stays retired; sub-checks are never removed`, () => {
      const entry = checks.find((c) => c.id === id);
      if (!entry) return;
      const now = current(entry);
      if (was.status === 'retired') expect(now.status).toBe('retired');
      for (const sub of was.subChecks) expect(now.subChecks, `${sub} was removed`).toContain(sub);
      expect(now.version).toBeGreaterThanOrEqual(was.version);
      if (now.version === was.version) expect(now).toEqual(was);
    });
  }

  it('lists every registry entry (new entries are added to the lock on purpose)', () => {
    for (const c of checks) expect(Object.keys(lock), `${c.id} is not in registry.lock.json`).toContain(c.id);
  });
});
