// URLs are kept as origin and path only: user:password@, the #fragment and every query value
// are dropped; query values are registered as secrets on sight; query names are kept.
import { LIMITS } from './limits.js';
import type { RunContext } from './run-context.js';

export interface KeptUrl {
  origin: string;
  path: string;
  queryNames: string[];
  /** Fields over a cap or not kept for another reason (counted, never kept). */
  dropped: number;
}

export function keepUrl(ctx: RunContext, raw: unknown): KeptUrl | null {
  if (typeof raw !== 'string') return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  ctx.registerSecret(u.username);
  ctx.registerSecret(u.password);
  ctx.registerSecret(u.hash.slice(1));
  let dropped = 0;
  const queryNames: string[] = [];
  for (const [name, value] of u.searchParams) {
    ctx.registerSecret(value);
    if (queryNames.length < LIMITS.maxQueryNames && name.length <= LIMITS.maxText && !queryNames.includes(name)) {
      queryNames.push(name);
    } else dropped++;
  }
  const path = u.pathname.length <= LIMITS.maxText ? u.pathname : '';
  if (!path) dropped++;
  return { origin: u.origin, path, queryNames, dropped };
}
