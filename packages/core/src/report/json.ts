// JSON output. It holds only what the report already shows: the same sentences, shortened
// addresses, and no prices, assets or full addresses. formatVersion changes whenever the shape does.
import { OUTCOMES } from '@dabsproof/registry';
import { z } from 'zod';
import { fileName, REPORT_JSON_VERSION, type ReportDocument } from './document.js';

const Outcome = z.enum(OUTCOMES);
const Version = z.literal(REPORT_JSON_VERSION);
const ExitCode = z.union([z.literal(0), z.literal(1), z.literal(2)]);

const JsonRouteSchema = z
  .object({
    route: z.string(),
    tier: z.string().nullable(),
    scheme: z.string().nullable(),
    payee: z.string(),
    earlierRoute: z.string().nullable(),
  })
  .strict();

const JsonResultSchema = z
  .object({
    subCheckId: z.string(),
    title: z.string(),
    outcome: Outcome,
    label: z.string(),
    severity: z.string().nullable(),
    text: z.string().nullable(),
    routesHeading: z.string().nullable(),
    groups: z.array(z.object({ routes: z.array(JsonRouteSchema) }).strict()),
    sameMistake: z.array(z.object({ text: z.string(), routes: z.array(JsonRouteSchema) }).strict()),
  })
  .strict();

const JsonCheckSchema = z
  .object({
    checkId: z.string(),
    title: z.string(),
    version: z.number().int(),
    status: z.string(),
    results: z.array(JsonResultSchema),
    fix: z
      .object({
        whatSomeoneCouldDo: z.string(),
        escalation: z.array(z.string()),
        summary: z.string(),
        steps: z.array(z.string()),
        guidance: z.string(),
        notAFix: z.array(z.string()),
      })
      .strict()
      .nullable(),
  })
  .strict();

const ReportKind = z
  .object({
    formatVersion: Version,
    kind: z.literal('report'),
    manifest: z.string(),
    routesRead: z.number().int(),
    networksChecked: z.array(z.string()),
    overall: z.object({ outcome: Outcome, label: z.string() }).strict(),
    exitCode: ExitCode,
    counts: z
      .object({
        'found-a-problem': z.number().int(),
        'found-no-problem': z.number().int(),
        'could-not-verify': z.number().int(),
        'not-applicable': z.number().int(),
      })
      .strict(),
    notes: z.array(z.string()),
    information: z.array(z.object({ text: z.string(), items: z.array(z.string()) }).strict()),
    checks: z.array(JsonCheckSchema),
    coverage: z.string(),
  })
  .strict();

const InvalidManifestKind = z
  .object({
    formatVersion: Version,
    kind: z.literal('invalid-manifest'),
    manifest: z.string(),
    overall: z.object({ outcome: z.literal('could-not-verify'), label: z.string() }).strict(),
    exitCode: z.literal(2),
    text: z.string(),
    reason: z.string(),
    issues: z.array(z.string()),
    coverage: z.string(),
  })
  .strict();

const RefusedKind = z
  .object({
    formatVersion: Version,
    kind: z.literal('refused'),
    manifest: z.string(),
    exitCode: z.literal(2),
    reason: z.string(),
    usage: z.string(),
  })
  .strict();

const UsageErrorKind = z
  .object({ formatVersion: Version, kind: z.literal('usage-error'), exitCode: z.literal(2), usage: z.string() })
  .strict();

export const ReportJsonSchema = z.discriminatedUnion('kind', [
  ReportKind,
  InvalidManifestKind,
  RefusedKind,
  UsageErrorKind,
]);
export type ReportJsonOutput = z.infer<typeof ReportJsonSchema>;

const stringify = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** The document's JSON, checked against the schema before it is written. */
export const renderJson = (doc: ReportDocument<unknown>): string => stringify(ReportJsonSchema.parse(doc.json));

/** The main manifest could not be opened or was refused (for example an environment file). */
export const refusedJson = (manifestPath: string, reason: string, usage: string): string =>
  stringify(
    ReportJsonSchema.parse({
      formatVersion: REPORT_JSON_VERSION,
      kind: 'refused',
      manifest: fileName(manifestPath),
      exitCode: 2,
      reason,
      usage,
    }),
  );

/** The command line could not be read. */
export const usageErrorJson = (usage: string): string =>
  stringify(ReportJsonSchema.parse({ formatVersion: REPORT_JSON_VERSION, kind: 'usage-error', exitCode: 2, usage }));
