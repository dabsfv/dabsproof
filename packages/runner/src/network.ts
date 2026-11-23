// The Base Sepolia check on a PAYMENT-REQUIRED value: every accepts entry must name Base Sepolia.
// The value is read by core's inspectPaymentRequired and never kept or returned.
import { createRunContext, inspectPaymentRequired } from '@dabsproof/core';
import { BASE_SEPOLIA } from '@dabsproof/registry';

export type NetworkCode = 'payment-required-undecodable' | 'no-accepts' | 'network-not-kept' | 'not-base-sepolia';

export function checkRequiredNetworks(value: unknown): { ok: true } | { ok: false; code: NetworkCode } {
  if (typeof value !== 'string') return { ok: false, code: 'payment-required-undecodable' };
  const o = inspectPaymentRequired(createRunContext(), 'PAYMENT-REQUIRED', value);
  if (!o.decoded) return { ok: false, code: 'payment-required-undecodable' };
  if (o.accepts.length === 0 && o.acceptsOverCap === 0) return { ok: false, code: 'no-accepts' };
  if (o.accepts.some((a) => a.network !== undefined && a.network !== BASE_SEPOLIA)) {
    return { ok: false, code: 'not-base-sepolia' };
  }
  // An entry whose network was dropped, or one past the inspector's cap, cannot be shown to be Base Sepolia.
  if (o.acceptsOverCap > 0 || o.accepts.some((a) => a.network === undefined)) {
    return { ok: false, code: 'network-not-kept' };
  }
  return { ok: true };
}
