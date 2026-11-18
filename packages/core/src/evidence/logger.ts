// The logger accepts only typed events from a fixed list, never free text. Each event is checked
// against its schema and against the run's secret register before it reaches the sink; an event
// that fails either check is dropped, replaced by a withheld marker, and counted.
import type { Outcome } from '@dabsproof/registry';
import { z } from 'zod';
import { NO_FINGERPRINT_REASONS } from './messages.js';
import type { RunContext } from './run-context.js';

const short = z.string().max(256);
export const LogEventSchema = z.discriminatedUnion('event', [
  z.object({ event: z.literal('run-started'), runId: short }).strict(),
  z
    .object({
      event: z.literal('request-recorded'),
      method: short.nullable(),
      path: short.nullable(),
      status: z.number().int().nullable(),
    })
    .strict(),
  z
    .object({
      event: z.literal('payment-observed'),
      headerName: short,
      length: z.number().int().nullable(),
      decoded: z.boolean(),
      fingerprint: short.nullable(),
      noFingerprintReason: z.enum(NO_FINGERPRINT_REASONS).nullable(),
    })
    .strict(),
  z
    .object({
      event: z.literal('settlement-observed'),
      success: z.boolean().nullable(),
      network: short.optional(),
      transactionHash: short.optional(),
    })
    .strict(),
  z.object({ event: z.literal('run-finished'), withheld: z.number().int() }).strict(),
]);
export type LogEvent = z.infer<typeof LogEventSchema>;

export const WITHHELD_LINE = JSON.stringify({ event: 'withheld' });

/** Serialises a value for output, or returns null (and counts it) if it would show a registered secret. */
export function safeSerialise(ctx: RunContext, value: unknown): string | null {
  let text: string | undefined;
  try {
    text = JSON.stringify(value);
  } catch {
    text = undefined;
  }
  if (text === undefined || ctx.holdsSecret(text)) {
    ctx.noteWithheld();
    return null;
  }
  return text;
}

export interface Logger {
  log(event: LogEvent): void;
}

export function createLogger(ctx: RunContext, sink: (line: string) => void): Logger {
  return {
    log(event: LogEvent) {
      if (!LogEventSchema.safeParse(event).success) {
        ctx.noteWithheld();
        sink(WITHHELD_LINE);
        return;
      }
      sink(safeSerialise(ctx, event) ?? WITHHELD_LINE);
    },
  };
}

/**
 * If anything was withheld in a run, its result can only lean towards could not verify:
 * "found no problem" becomes "could not verify"; other outcomes are unchanged.
 */
export const capOutcome = (outcome: Outcome, withheld: number): Outcome =>
  withheld > 0 && outcome === 'found-no-problem' ? 'could-not-verify' : outcome;
