// Caps on untrusted input. Anything over a cap is counted, never kept.
export const LIMITS = Object.freeze({
  /** Values shorter than this are not registered as secrets (they would match ordinary text). */
  minSecretLength: 8,
  /** Every run of this many characters from a registered secret is checked for in each output. */
  secretWindow: 8,
  /** At most this many entries of a 402 reply's accepts list are kept. */
  maxAccepts: 20,
  /** Longest kept text field (URL path, allow-listed header value). */
  maxText: 256,
  /** Longest kept network identifier. */
  maxNetwork: 64,
  /** Longest kept amount (digits only). */
  maxAmountDigits: 78,
  /** Longest kept time value such as validBefore (digits only). */
  maxTimeDigits: 20,
  /** Longest header value that is decoded at all. */
  maxDecodedHeader: 16384,
  /** Largest kept maxTimeoutSeconds. */
  maxTimeoutSeconds: 1_000_000_000,
  /** Most query parameter names kept. */
  maxQueryNames: 32,
});

/** The rule for keeping an error code from a payment service. */
export const ERROR_CODE = /^[a-z][a-z0-9_]{2,63}$/;
export const ALL_HEX = /^[0-9a-f]+$/;
