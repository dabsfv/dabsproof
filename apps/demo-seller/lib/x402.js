// The x402 version 2 "payment required" response for one mapping entry. Pure: no imports, no
// Node built-ins, no environment, no logging. It does not verify or settle a payment, calls no
// facilitator, and never reads or echoes a payment header.
//
// Field names and types follow the PaymentRequired and PaymentRequirements types declared by the
// installed @x402/core 2.31.0. Values marked "our choice" are not taken from the package.

const BASE_SEPOLIA = 'eip155:84532';
const BASE_SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

/**
 * EIP-712 domain values for `extra`, by network and asset. This is what @x402/evm 2.31.0 declares for
 * eip155:84532; what the token contract returns is not verified. Any other network or asset is refused.
 */
const EXTRA = Object.freeze({
  [`${BASE_SEPOLIA}|${BASE_SEPOLIA_USDC.toLowerCase()}`]: Object.freeze({ name: 'USDC', version: '2' }),
});

/** Our choice. @x402/core 2.31.0 contains a fallback of 300 seconds; where it applies is not verified. */
export const MAX_TIMEOUT_SECONDS = 300;

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;

/** Base64 of plain printable ASCII text, or null for anything else (btoa takes single-byte text only). */
export function toBase64Ascii(text) {
  return typeof text === 'string' && PRINTABLE_ASCII.test(text) ? btoa(text) : null;
}

/**
 * entry: the mapping's route or tier entry ({ scheme?, network, asset, price }); payTo: from the fix
 * kit; url: the URL to name in resource.url (the routes pass DEMO_ORIGIN plus their own path).
 * Returns { ok: true, status, headers, body } or { ok: false, code }.
 */
export function paymentRequired({ entry, payTo, url }) {
  if (!entry || (entry.scheme ?? 'exact') !== 'exact') return { ok: false, code: 'unsupported-scheme' };
  if (entry.network !== BASE_SEPOLIA) return { ok: false, code: 'unsupported-network' };
  const extra = typeof entry.asset === 'string' ? EXTRA[`${entry.network}|${entry.asset.toLowerCase()}`] : undefined;
  if (!extra) return { ok: false, code: 'unsupported-asset' };
  if (typeof entry.price !== 'string' || !/^\d{1,78}$/.test(entry.price)) return { ok: false, code: 'bad-amount' };
  if (typeof payTo !== 'string' || !ADDRESS.test(payTo)) return { ok: false, code: 'bad-pay-to' };
  let resource;
  try {
    // The caller supplies the URL. This function keeps its origin and path and drops the query (our
    // choice); nothing here checks where the URL came from.
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, code: 'bad-url' };
    resource = { url: `${u.origin}${u.pathname}` };
  } catch {
    return { ok: false, code: 'bad-url' };
  }
  const json = JSON.stringify({
    x402Version: 2,
    resource,
    accepts: [
      {
        scheme: 'exact',
        network: entry.network,
        asset: entry.asset,
        amount: entry.price,
        payTo,
        maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
        extra: { name: extra.name, version: extra.version },
      },
    ],
  });
  const header = toBase64Ascii(json);
  if (header === null) return { ok: false, code: 'not-ascii' };
  return {
    ok: true,
    status: 402,
    headers: { 'content-type': 'application/json', 'PAYMENT-REQUIRED': header },
    body: json,
  };
}
