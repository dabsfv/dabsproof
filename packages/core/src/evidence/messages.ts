// Every sentence the evidence code can produce. pnpm lint:wording checks them all. No message,
// code or error here ever carries the input it refers to.
export const EVIDENCE_TEXT = Object.freeze({
  headerUndecodable: 'The payment header was present but could not be read; only its name and length were recorded.',
  outputWithheld: 'This output was withheld because it would have shown a value that must stay private.',
  errorCodeWithheld: "The payment service's error text was not a short code, so only its length was recorded.",
  notTextHeader: 'A header value was not text, so only its name was recorded.',
  evidenceShapeMismatch: 'This evidence did not match its expected shape, so it was withheld.',
});

/** Why a payment has no fingerprint. A missing fingerprint never means "no reuse found". */
export const NO_FINGERPRINT_REASONS = [
  'undecodable',
  'unsupported-version',
  'unsupported-payload',
  'unsupported-scheme',
  'missing-fields',
  'not-a-payment-header',
] as const;
export type NoFingerprintReason = (typeof NO_FINGERPRINT_REASONS)[number];

/**
 * The only error the evidence code throws or returns. Its message is a fixed EVIDENCE_TEXT
 * sentence and it never has a cause, because Node and zod errors can quote their input.
 */
export class EvidenceError extends Error {
  readonly code: string;
  constructor(code: string, message: string = EVIDENCE_TEXT.headerUndecodable) {
    super(message);
    this.name = 'EvidenceError';
    this.code = code;
  }
}
