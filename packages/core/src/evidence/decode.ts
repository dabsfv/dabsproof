// Safe decoding of base64 JSON header values. Every failure becomes a fixed EvidenceError with
// no cause, so no Node or zod message (which can quote the input) is ever carried along.
import { LIMITS } from './limits.js';
import { EvidenceError } from './messages.js';
import type { RunContext } from './run-context.js';

export type Decoded = { ok: true; value: unknown } | { ok: false; error: EvidenceError };

export function decodeBase64Json(text: string): Decoded {
  if (text.length > LIMITS.maxDecodedHeader) return { ok: false, error: new EvidenceError('undecodable') };
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(text.trim())) return { ok: false, error: new EvidenceError('undecodable') };
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(text.trim(), 'base64').toString('utf8'));
  } catch {
    return { ok: false, error: new EvidenceError('undecodable') };
  }
  return { ok: true, value: parsed };
}

/** Registers, in memory only, every string field named signature or nonce at any depth. */
export function registerDeepSecrets(ctx: RunContext, value: unknown, depth = 0): void {
  if (depth > 16 || value === null || typeof value !== 'object') return;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string' && /^(signature|nonce)$/i.test(k)) ctx.registerSecret(v);
    else registerDeepSecrets(ctx, v, depth + 1);
  }
}
