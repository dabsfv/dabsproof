// Price text such as "$0.001" to a whole number of the asset's smallest units. Whole-number
// arithmetic only: no floating point, extra decimal places are refused, nothing is rounded.

export type PriceResult = { ok: true; units: string } | { ok: false; reason: 'price-format' | 'price-too-precise' };

export const isValidDecimals = (d: unknown): d is number =>
  Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 36;

export function dollarsToUnits(text: string, decimals: number): PriceResult {
  if (!isValidDecimals(decimals)) throw new RangeError('decimals out of range');
  const m = /^\$(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) return { ok: false, reason: 'price-format' };
  const whole = m[1] ?? '0';
  const fraction = m[2] ?? '';
  if (fraction.length > decimals) return { ok: false, reason: 'price-too-precise' };
  const units = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
  return { ok: true, units: units.toString() };
}
