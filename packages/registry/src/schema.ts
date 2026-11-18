// The registry schema. Check IDs are stable and append-only; X402-08 stays retired and is
// never reused. Changing a check's meaning bumps its version and adds a changelog line.
import { z } from 'zod';
import { BASE_SEPOLIA, COVERS_ONLY, GENERAL_GUIDANCE } from './shared.js';

export const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
export const SeveritySchema = z.enum(SEVERITIES);
export type Severity = z.infer<typeof SeveritySchema>;

// The four outcomes, and the only words a seller sees for them. There is no pass or fail.
export const OUTCOMES = ['found-a-problem', 'found-no-problem', 'could-not-verify', 'not-applicable'] as const;
export const OutcomeSchema = z.enum(OUTCOMES);
export type Outcome = z.infer<typeof OutcomeSchema>;
export const OUTCOME_LABEL: Readonly<Record<Outcome, string>> = Object.freeze({
  'found-a-problem': 'found a problem',
  'found-no-problem': 'found no problem',
  'could-not-verify': 'could not verify',
  'not-applicable': 'not applicable',
});

export const KindSchema = z.enum(['static', 'live', 'both']);
export const PreconditionSchema = z.enum([
  'two-paid-routes-same-terms',
  'upto-route',
  'ownership-verified',
  'seller-uses-our-standin-facilitator',
  'code-access',
]);
export const EvidenceSchema = z.enum([
  'request-record',
  'payment-terms',
  'settlement-receipt',
  'balance-delta',
  'code-citation',
  'config-finding',
]);

const Text = z
  .string()
  .min(1)
  .refine((s) => s === s.trim(), 'text must not start or end with spaces');
const CheckId = z.string().regex(/^X402-\d{2}$/, 'a check ID looks like X402-01');
const WatchId = z.string().regex(/^X402-\d{2}\.[a-z0-9]+(?:-[a-z0-9]+)*$/, 'a watch ID looks like X402-03.some-name');
const SUB_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const Version = z.number().int().min(1);

export const ChangelogSchema = z
  .array(
    z
      .object({
        version: Version,
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        change: Text,
      })
      .strict(),
  )
  .min(1);

// Live-run limits from CLAUDE.md: at most 20 requests per route per run, bursts of 10.
export const BudgetSchema = z
  .object({
    draft: z.boolean(),
    requestsPerRoute: z.number().int().min(0).max(20),
    burst: z.number().int().min(0).max(10),
    routes: z.union([z.number().int().min(0), z.literal('all')]),
    payments: z.number().int().min(0),
    maxSpendAtomic: z.string().regex(/^\d+$/).optional(),
  })
  .strict()
  .refine((b) => b.burst <= b.requestsPerRoute, { message: 'burst cannot exceed requestsPerRoute', path: ['burst'] });

export const OutcomesSchema = z
  .object({
    'found-a-problem': Text,
    'found-no-problem': Text.refine((s) => s.endsWith(` ${COVERS_ONLY}`), `must end with "${COVERS_ONLY}"`),
    'could-not-verify': Text,
    'not-applicable': Text,
  })
  .strict();

export const RemediationSchema = z
  .object({
    summary: Text,
    steps: z.array(Text).min(1),
    generalGuidance: z.literal(GENERAL_GUIDANCE),
    fixKit: z.enum(['per-route-address', 'guards']).optional(),
    notAFix: z.array(Text).optional(),
  })
  .strict();

export const SubCheckSchema = z.object({ id: z.string(), title: Text, kind: KindSchema }).strict();

export const AppliesToSchema = z
  .object({
    x402Versions: z.array(z.literal(2)).min(1),
    schemes: z.array(z.enum(['exact', 'upto'])).min(1),
    networks: z.array(z.literal(BASE_SEPOLIA)).min(1),
  })
  .strict();

type Changelog = z.infer<typeof ChangelogSchema>;
function changelogMatches(entry: { version: number; changelog: Changelog }, ctx: z.RefinementCtx): void {
  entry.changelog.forEach((line, i) => {
    if (line.version !== i + 1) {
      ctx.addIssue({
        code: 'custom',
        message: 'changelog versions must run 1, 2, 3 …',
        path: ['changelog', i, 'version'],
      });
    }
  });
  if (entry.changelog.at(-1)?.version !== entry.version) {
    ctx.addIssue({ code: 'custom', message: 'the newest changelog line must match version', path: ['version'] });
  }
}

export const CheckSchema = z
  .object({
    id: CheckId,
    version: Version,
    // experimental until the check has an implementation; then active, with a version bump.
    status: z.enum(['active', 'experimental']),
    title: Text,
    severity: SeveritySchema,
    escalation: z.array(z.object({ to: SeveritySchema, when: Text }).strict()).optional(),
    kind: KindSchema,
    whatItTests: Text,
    whatSomeoneCouldDo: Text,
    preconditions: z.array(PreconditionSchema),
    appliesTo: AppliesToSchema,
    budget: BudgetSchema,
    evidence: z.array(EvidenceSchema).min(1),
    outcomes: OutcomesSchema,
    remediation: RemediationSchema,
    subChecks: z.array(SubCheckSchema),
    references: z.array(z.url()),
    changelog: ChangelogSchema,
  })
  .strict()
  .superRefine((entry, ctx) => {
    changelogMatches(entry, ctx);
    const seen = new Set<string>();
    entry.subChecks.forEach((sub, i) => {
      const slug = sub.id.startsWith(`${entry.id}.`) ? sub.id.slice(entry.id.length + 1) : '';
      if (!SUB_SLUG.test(slug)) {
        ctx.addIssue({
          code: 'custom',
          message: `sub-check IDs look like ${entry.id}.some-name`,
          path: ['subChecks', i, 'id'],
        });
      }
      if (seen.has(sub.id))
        ctx.addIssue({ code: 'custom', message: 'duplicate sub-check ID', path: ['subChecks', i, 'id'] });
      seen.add(sub.id);
    });
  });

// A watch entry gives information only and never reports a problem.
export const WatchSchema = z
  .object({
    id: WatchId,
    version: Version,
    status: z.literal('watch'),
    title: Text,
    kind: KindSchema,
    whatItTests: Text,
    watch: z
      .object({
        status: z.enum(['found-no-problem', 'could-not-verify', 'not-applicable']),
        note: Text,
      })
      .strict(),
    references: z.array(z.url()),
    changelog: ChangelogSchema,
  })
  .strict()
  .superRefine(changelogMatches);

export const RetiredSchema = z
  .object({
    id: CheckId,
    version: Version,
    status: z.literal('retired'),
    title: Text,
    retiredReason: Text,
    changelog: ChangelogSchema,
  })
  .strict()
  .superRefine(changelogMatches);

export const RegistryEntrySchema = z.union([CheckSchema, WatchSchema, RetiredSchema]);

export type CheckEntry = z.infer<typeof CheckSchema>;
export type WatchEntry = z.infer<typeof WatchSchema>;
export type RetiredEntry = z.infer<typeof RetiredSchema>;
export type RegistryEntry = z.infer<typeof RegistryEntrySchema>;
export type CheckInput = z.input<typeof CheckSchema>;
export type WatchInput = z.input<typeof WatchSchema>;
export type RetiredInput = z.input<typeof RetiredSchema>;
