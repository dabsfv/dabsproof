// The configured origin for the 402 reply's resource.url (test-only setting DEMO_ORIGIN). Pure: no
// imports, no environment, no logging. Only the literal http://127.0.0.1:<port> is accepted, port 1
// to 65535. A refusal carries a code only, never the value given.

const LOOPBACK_ORIGIN = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/;

/** Returns { ok: true, origin } or { ok: false, code: 'origin-not-given' }. */
export function configuredOrigin(value) {
  const m = typeof value === 'string' ? LOOPBACK_ORIGIN.exec(value) : null;
  if (m === null || Number(m[1]) > 65535) return { ok: false, code: 'origin-not-given' };
  return { ok: true, origin: value };
}
