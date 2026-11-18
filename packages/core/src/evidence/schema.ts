// Schemas for the evidence kinds the registry names. Every object refuses unknown fields, so no
// field able to hold a payment header, signature, nonce or payer can be added by mistake.
import { z } from 'zod';
import { safeSerialise } from './logger.js';
import { EVIDENCE_TEXT, EvidenceError, NO_FINGERPRINT_REASONS } from './messages.js';
import type { RunContext } from './run-context.js';

const KeptUrl = z
  .object({ origin: z.string(), path: z.string(), queryNames: z.array(z.string()), dropped: z.number().int() })
  .strict();
const Header = z
  .object({
    name: z.string(),
    value: z.string().optional(),
    length: z.number().int().nullable(),
    note: z.literal('not-text').optional(),
  })
  .strict();
const PaymentTerms = z
  .object({
    scheme: z.string().optional(),
    network: z.string().optional(),
    asset: z.string().optional(),
    amount: z.string().optional(),
    payTo: z.string().optional(),
    validAfter: z.string().optional(),
    validBefore: z.string().optional(),
    resource: KeptUrl.optional(),
  })
  .strict();
export const PaymentObservationSchema = z
  .object({
    headerName: z.string(),
    length: z.number().int().nullable(),
    decoded: z.boolean(),
    terms: PaymentTerms.nullable(),
    fingerprint: z
      .string()
      .regex(/^fp1:[A-Za-z0-9_-]{43}$/)
      .nullable(),
    noFingerprintReason: z.enum(NO_FINGERPRINT_REASONS).nullable(),
    dropped: z.number().int(),
  })
  .strict()
  .refine((p) => (p.fingerprint === null) === (p.noFingerprintReason !== null), {
    message: 'a missing fingerprint always has a reason',
  });
const RequiredTerms = z
  .object({
    scheme: z.string().optional(),
    network: z.string().optional(),
    asset: z.string().optional(),
    amount: z.string().optional(),
    payTo: z.string().optional(),
    maxTimeoutSeconds: z.number().int().optional(),
  })
  .strict();
const PaymentRequired = z
  .object({
    headerName: z.string(),
    length: z.number().int(),
    decoded: z.boolean(),
    resource: KeptUrl.nullable(),
    accepts: z.array(RequiredTerms).max(20),
    acceptsOverCap: z.number().int(),
    errorLength: z.number().int().nullable(),
    dropped: z.number().int(),
  })
  .strict();
const Settlement = z
  .object({
    headerName: z.string(),
    length: z.number().int(),
    decoded: z.boolean(),
    success: z.boolean().nullable(),
    network: z.string().optional(),
    transactionHash: z.string().optional(),
    transactionLength: z.number().int().optional(),
    amount: z.string().optional(),
    errorReason: z
      .union([z.object({ code: z.string() }).strict(), z.object({ codeLength: z.number().int() }).strict()])
      .optional(),
    errorMessageLength: z.number().int().optional(),
    dropped: z.number().int(),
  })
  .strict();
export const RequestRecordSchema = z
  .object({
    kind: z.literal('request-record'),
    runId: z.string(),
    method: z.string().nullable(),
    url: KeptUrl.nullable(),
    status: z.number().int().nullable(),
    requestHeaders: z.array(Header),
    responseHeaders: z.array(Header),
    payment: PaymentObservationSchema.nullable(),
    paymentRequired: PaymentRequired.nullable(),
    settlement: Settlement.nullable(),
    body: z
      .object({ sha256: z.string().regex(/^[0-9a-f]{64}$/), length: z.number().int() })
      .strict()
      .nullable(),
    dropped: z.number().int(),
  })
  .strict();
export const BalanceDeltaSchema = z
  .object({
    kind: z.literal('balance-delta'),
    runId: z.string(),
    network: z.string(),
    asset: z.string(),
    payTo: z.string(),
    before: z.string().regex(/^\d+$/),
    after: z.string().regex(/^\d+$/),
  })
  .strict();
export const CodeCitationSchema = z
  .object({ kind: z.literal('code-citation'), file: z.string(), line: z.number().int().min(1) })
  .strict();
export const ConfigFindingSchema = z
  .object({ kind: z.literal('config-finding'), checkId: z.string(), subCheckId: z.string() })
  .strict();
export const EvidenceSchema = z.discriminatedUnion('kind', [
  RequestRecordSchema,
  BalanceDeltaSchema,
  CodeCitationSchema,
  ConfigFindingSchema,
]);

export type EvidenceRecord = z.infer<typeof EvidenceSchema>;

/**
 * Checks a value against the evidence schemas. A mismatch is withheld and counted in the run's
 * withheld total, with the fixed evidenceShapeMismatch sentence and no cause: the zod error,
 * which can quote the input, is never kept.
 */
export function checkEvidence(
  ctx: RunContext,
  value: unknown,
): { ok: true; evidence: EvidenceRecord } | { ok: false; error: EvidenceError } {
  const r = EvidenceSchema.safeParse(value);
  if (r.success) return { ok: true, evidence: r.data };
  ctx.noteWithheld();
  return { ok: false, error: new EvidenceError('schema-mismatch', EVIDENCE_TEXT.evidenceShapeMismatch) };
}

/**
 * Turns evidence into JSON for output. Evidence that fails its schema is withheld with
 * evidenceShapeMismatch; evidence that would show a registered secret is withheld with
 * outputWithheld. Both are counted in the run's withheld total.
 */
export function serialiseEvidence(
  ctx: RunContext,
  value: unknown,
): { ok: true; text: string } | { ok: false; error: EvidenceError } {
  const checked = checkEvidence(ctx, value);
  if (!checked.ok) return checked;
  const text = safeSerialise(ctx, checked.evidence);
  return text === null
    ? { ok: false, error: new EvidenceError('secret-match', EVIDENCE_TEXT.outputWithheld) }
    : { ok: true, text };
}
