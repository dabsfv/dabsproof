// The report document: one source of wording for every format. Every sentence and label comes
// from REPORT_TEXT, MANIFEST_TEXT or the registry; the renderers (terminal, Markdown, JSON) add
// layout only and never add words.
import { BASE_SEPOLIA, type CheckEntry, getCheck, OUTCOME_LABEL, OUTCOMES, type Outcome } from '@dabsproof/registry';
import { type ManifestRoute, NOT_EXPORTED_TEXT } from '../manifest/schema.js';
import type { CheckResult, ResultGroup, RouteRef } from '../results/types.js';
import type { StaticReport } from '../static/analyse.js';
import { REPORT_TEXT as T } from './text.js';

/** A run of text. code: shown as code (backticks in Markdown). strong: emphasised. */
export interface Segment {
  t: string;
  code?: true;
  strong?: true;
}
export type Line = Segment[];

export type Block =
  | { type: 'title'; text: Line }
  | { type: 'para'; text: Line }
  | { type: 'list'; lead?: Line; items: Line[] }
  | { type: 'numbered'; items: Line[] }
  | { type: 'table'; head: [string, string]; rows: [string, string][] }
  | { type: 'h2'; text: Line }
  | { type: 'h3'; text: Line }
  | { type: 'rule' };

export const REPORT_JSON_VERSION = 1;

export interface JsonRoute {
  route: string;
  tier: string | null;
  scheme: string | null;
  payee: string;
  earlierRoute: string | null;
}
export interface JsonResult {
  subCheckId: string;
  title: string;
  outcome: Outcome;
  label: string;
  severity: string | null;
  /** The outcome sentence, or null when the report does not show it (only "same mistake" groups). */
  text: string | null;
  routesHeading: string | null;
  groups: { routes: JsonRoute[] }[];
  sameMistake: { text: string; routes: JsonRoute[] }[];
}
export interface JsonCheck {
  checkId: string;
  title: string;
  version: number;
  status: string;
  results: JsonResult[];
  fix: {
    whatSomeoneCouldDo: string;
    escalation: string[];
    summary: string;
    steps: string[];
    guidance: string;
    notAFix: string[];
  } | null;
}
export interface ReportJson {
  formatVersion: number;
  kind: 'report';
  manifest: string;
  routesRead: number;
  networksChecked: string[];
  overall: { outcome: Outcome; label: string };
  exitCode: 0 | 1 | 2;
  counts: Record<Outcome, number>;
  notes: string[];
  information: { text: string; items: string[] }[];
  checks: JsonCheck[];
  coverage: string;
}
export interface InvalidManifestJson {
  formatVersion: number;
  kind: 'invalid-manifest';
  manifest: string;
  overall: { outcome: 'could-not-verify'; label: string };
  exitCode: 2;
  text: string;
  reason: string;
  issues: string[];
  coverage: string;
}

export interface ReportDocument<J> {
  blocks: Block[];
  json: J;
}

export interface PreviousManifests {
  /** Earlier manifests that were read, as the seller named them. */
  read: string[];
  /** Earlier manifests that could not be read, with a linted reason. */
  unreadable: { path: string; reason: string }[];
}

/**
 * A manifest is named by its file name only, never the path as typed, so a report shared with
 * others shows no folder names (which can include a user name).
 */
export const fileName = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/** First 6 and last 4 characters, for example 0x0000…0010. */
export const shortAddress = (a: string): string => `${a.slice(0, 6)}…${a.slice(-4)}`;

const text = (t: string): Segment => ({ t });
const code = (t: string): Segment => ({ t, code: true });
/** Plain text of a line, as the terminal and JSON show it. */
export const plain = (line: Line): string => line.map((s) => s.t).join('');

function payeeSegment(r: { address?: string; index?: number; range?: { first: number; last: number }; base?: number }) {
  if (r.address !== undefined) return code(shortAddress(r.address));
  if (r.range) return text(`${T.addressIndexesLabel} ${r.range.first} ${T.rangeTo} ${r.range.last}`);
  if (r.index !== undefined) return text(`${T.addressIndexLabel} ${r.index}`);
  return text(`${T.baseIndexLabel} ${r.base}`);
}
function manifestPayee(r: ManifestRoute): Segment {
  const p = r.perResource;
  const range =
    p && p.firstId !== undefined && p.lastId !== undefined
      ? { first: p.baseIndex + p.firstId, last: p.baseIndex + p.lastId }
      : undefined;
  return payeeSegment({
    ...(r.address !== undefined ? { address: r.address } : {}),
    ...(r.index !== undefined ? { index: r.index } : {}),
    ...(range ? { range } : {}),
    ...(p ? { base: p.baseIndex } : {}),
  });
}
const tierSuffix = (r: ManifestRoute): Segment[] => (r.tier !== undefined ? [text(` (${T.tierLabel} ${r.tier})`)] : []);

function routeItem(r: RouteRef, showScheme: boolean): { line: Line; json: JsonRoute } {
  const parts: Segment[] = [];
  if (r.tier !== undefined) parts.push(text(`${T.tierLabel} ${r.tier}`));
  if (showScheme) parts.push(text(`${T.schemeLabel} ${r.scheme}`));
  const payee = payeeSegment(r);
  parts.push(payee);
  const line: Line = [code(r.route), text(' (')];
  parts.forEach((p, i) => {
    if (i) line.push(text(', '));
    line.push(p);
  });
  if (r.earlierRoute !== undefined) line.push(text(`; ${T.earlierGivenTo} `), code(r.earlierRoute));
  line.push(text(')'));
  return {
    line,
    json: {
      route: r.route,
      tier: r.tier ?? null,
      scheme: showScheme ? r.scheme : null,
      payee: payee.t,
      earlierRoute: r.earlierRoute ?? null,
    },
  };
}

function entryFor(checkId: string): CheckEntry {
  const e = getCheck(checkId);
  if (!e || (e.status !== 'active' && e.status !== 'experimental')) throw new Error(`${checkId} is not a check`);
  return e;
}
function subFor(entry: CheckEntry, subCheckId: string) {
  const sub = entry.subChecks.find((s) => s.id === subCheckId);
  if (!sub?.static) throw new Error(`${subCheckId} has no static text in the registry`);
  return { ...sub, static: sub.static };
}

function resultText(entry: CheckEntry, r: CheckResult): string {
  const sub = subFor(entry, r.subCheckId);
  if (r.outcome === 'found-a-problem') return sub.static['found-a-problem'];
  // Static results compare routes within one payment scheme (X402-03 version 3 texts).
  if (r.outcome === 'found-no-problem')
    return sub.static['found-no-problem-within-scheme'] ?? sub.static['found-no-problem'];
  if (r.outcome === 'not-applicable') {
    return r.note === 'no-index' ? T.noIndex : (sub.static['not-applicable'] ?? entry.outcomes['not-applicable']);
  }
  const fixed = r.note === 'nothing-checked' ? T.nothingChecked : r.note === 'nothing-fixed' ? T.nothingFixed : null;
  return fixed ?? sub.static['could-not-verify'] ?? entry.outcomes['could-not-verify'];
}

function resultBlocks(entry: CheckEntry, r: CheckResult, all: CheckResult[], showScheme: boolean) {
  const sub = subFor(entry, r.subCheckId);
  const heading: Line = [text(`${r.subCheckId}: ${OUTCOME_LABEL[r.outcome]}`)];
  if (r.severity) heading.push(text(` (${T.severityLabel} ${r.severity})`));
  const blocks: Block[] = [
    { type: 'h3', text: heading },
    { type: 'para', text: [text(sub.title)] },
  ];
  const sentence = resultText(entry, r);
  const json: JsonResult = {
    subCheckId: r.subCheckId,
    title: sub.title,
    outcome: r.outcome,
    label: OUTCOME_LABEL[r.outcome],
    severity: r.severity ?? null,
    text: sentence,
    routesHeading: null,
    groups: [],
    sameMistake: [],
  };
  if (r.outcome !== 'found-a-problem') {
    blocks.push({ type: 'para', text: [text(sentence)] });
    return { blocks, json };
  }
  const causeFound = (g: ResultGroup) =>
    g.sameMistakeAs !== undefined &&
    all.some((o) => o.subCheckId === g.sameMistakeAs && o.outcome === 'found-a-problem');
  const own = r.groups.filter((g) => !causeFound(g));
  const repeats = r.groups.filter(causeFound);
  if (!own.length) json.text = null;
  if (own.length) {
    blocks.push({ type: 'para', text: [text(sentence)] });
    json.routesHeading = T.sharedHeading;
    own.forEach((g, i) => {
      const items = g.routes.map((x) => routeItem(x, showScheme));
      blocks.push(
        i === 0
          ? { type: 'list', lead: [text(T.sharedHeading)], items: items.map((x) => x.line) }
          : { type: 'list', items: items.map((x) => x.line) },
      );
      json.groups.push({ routes: items.map((x) => x.json) });
    });
  }
  for (const g of repeats) {
    const items = g.routes.map((x) => routeItem(x, showScheme));
    blocks.push({ type: 'list', lead: [text(T.sameMistake)], items: items.map((x) => x.line) });
    json.sameMistake.push({ text: T.sameMistake, routes: items.map((x) => x.json) });
  }
  return { blocks, json };
}

function fixBlocks(entry: CheckEntry): { blocks: Block[]; json: NonNullable<JsonCheck['fix']> } {
  const rem = entry.remediation;
  const escalation = (entry.escalation ?? []).map((e) => `${T.escalationLead} ${e.to} ${T.escalationIf} ${e.when}.`);
  const blocks: Block[] = [
    { type: 'para', text: [text(`${T.whatSomeoneCouldDo} ${entry.whatSomeoneCouldDo}`)] },
    ...escalation.map((s): Block => ({ type: 'para', text: [text(s)] })),
    { type: 'para', text: [text(T.fromManifest)] },
    { type: 'h3', text: [text(T.howToFix)] },
    { type: 'para', text: [text(rem.summary)] },
    { type: 'numbered', items: rem.steps.map((s) => [text(s)]) },
    { type: 'para', text: [text(rem.generalGuidance)] },
    ...(rem.notAFix ?? []).map((n): Block => ({ type: 'para', text: [text(`${T.notAFix} ${n}`)] })),
  ];
  return {
    blocks,
    json: {
      whatSomeoneCouldDo: entry.whatSomeoneCouldDo,
      escalation,
      summary: rem.summary,
      steps: [...rem.steps],
      guidance: rem.generalGuidance,
      notAFix: [...(rem.notAFix ?? [])],
    },
  };
}

/** The networks of the routes actually checked (Base Sepolia when none were checked). */
const networksOf = (report: StaticReport): string[] => {
  const networks = [...new Set(report.checkedRoutes.map((r) => r.network))];
  return networks.length ? networks : [BASE_SEPOLIA];
};

export function buildStaticReportDocument(
  productName: string,
  manifestPath: string,
  report: StaticReport,
  previous: PreviousManifests = { read: [], unreadable: [] },
): ReportDocument<ReportJson> {
  const manifestName = fileName(manifestPath);
  const networks = networksOf(report);
  const blocks: Block[] = [
    { type: 'title', text: [text(`${productName} ${T.reportTitle}`)] },
    {
      type: 'para',
      text: [
        text(`${T.manifestLabel} `),
        code(manifestName),
        text(
          ` · ${T.routesReadLabel} ${report.routesRead} · ${networks.length > 1 ? T.networksLabel : T.networkLabel} ${networks.join(', ')}`,
        ),
      ],
    },
    { type: 'para', text: [text(T.fromManifest)] },
  ];
  const notes: string[] = [T.fromManifest];
  const information: ReportJson['information'] = [];
  const infoList = (lead: string, items: Line[]) => {
    blocks.push({ type: 'list', lead: [text(lead)], items });
    information.push({ text: lead, items: items.map(plain) });
  };
  const note = (s: string, strong = false) => {
    blocks.push({ type: 'para', text: [strong ? { t: s, strong: true } : text(s)] });
    notes.push(s);
  };

  if (previous.read.length)
    infoList(
      T.previousLabel,
      previous.read.map((p) => [code(fileName(p))]),
    );
  if (previous.unreadable.length) {
    infoList(
      T.previousUnreadableHeading,
      previous.unreadable.map((p) => [code(fileName(p.path)), text(`: ${p.reason}`)]),
    );
  }
  if (report.mixedSchemes) note(T.schemesSeparate);
  if (!report.checkedRoutes.length) note(report.routesRead ? T.nothingChecked : T.nothingFixed, true);
  if (report.skippedRoutes.length) {
    infoList(
      T.skippedRoutes,
      report.skippedRoutes.map((r) => [code(r.route), text(` (${r.network})`)]),
    );
  }
  if (report.otherNetworkRoutes.length) {
    infoList(
      T.otherNetworks,
      report.otherNetworkRoutes.map((r) => [code(r.route), ...tierSuffix(r), text(` (${r.network})`)]),
    );
  }
  if (report.notExported.length) {
    infoList(
      T.notExportedHeading,
      report.notExported.map((n) => [code(n.route), text(`: ${NOT_EXPORTED_TEXT[n.reason]}`)]),
    );
    note(T.notExportedOverall, true);
  }
  if (report.perResourceRoutes.length) {
    infoList(
      T.perResourceLeftOut,
      report.perResourceRoutes.map((r) => [code(r.route), text(' ('), manifestPayee(r), text(')')]),
    );
  }
  if (report.hasTiers) note(T.queryVariantsNotTried);
  if (report.history.moved.length) {
    infoList(
      T.movedHeading,
      report.history.moved.map(({ now, earlier }) => [
        code(now.route),
        ...tierSuffix(now),
        text(` (${T.wasLabel} `),
        manifestPayee(earlier),
        text(`, ${T.nowLabel} `),
        manifestPayee(now),
        text(')'),
      ]),
    );
  }
  if (report.history.reusedOtherTerms.length) {
    infoList(
      T.reusedOtherTermsHeading,
      report.history.reusedOtherTerms.map(({ now, earlier }) => [
        code(now.route),
        ...tierSuffix(now),
        text(' ('),
        manifestPayee(now),
        text(`; ${T.earlierGivenTo} `),
        code(earlier.route),
        text(')'),
      ]),
    );
  }
  const counts = Object.fromEntries(
    OUTCOMES.map((o) => [o, report.results.filter((r) => r.outcome === o).length]),
  ) as Record<Outcome, number>;
  blocks.push({
    type: 'table',
    head: [T.outcomeCount, T.count],
    rows: OUTCOMES.map((o) => [OUTCOME_LABEL[o], String(counts[o])]),
  });

  const checks: JsonCheck[] = [];
  for (const id of [...new Set(report.results.map((r) => r.checkId))]) {
    const entry = entryFor(id);
    const results = report.results.filter((r) => r.checkId === id);
    blocks.push({
      type: 'h2',
      text: [text(`${entry.id}: ${entry.title} (${T.versionLabel} ${entry.version}, ${entry.status})`)],
    });
    const jsonResults: JsonResult[] = [];
    for (const r of results) {
      const built = resultBlocks(entry, r, results, report.mixedSchemes);
      blocks.push(...built.blocks);
      jsonResults.push(built.json);
    }
    let fix: JsonCheck['fix'] = null;
    if (results.some((r) => r.outcome === 'found-a-problem')) {
      const built = fixBlocks(entry);
      blocks.push(...built.blocks);
      fix = built.json;
    }
    checks.push({
      checkId: entry.id,
      title: entry.title,
      version: entry.version,
      status: entry.status,
      results: jsonResults,
      fix,
    });
  }
  blocks.push({ type: 'rule' }, { type: 'para', text: [text(T.coverage)] });
  return {
    blocks,
    json: {
      formatVersion: REPORT_JSON_VERSION,
      kind: 'report',
      manifest: manifestName,
      routesRead: report.routesRead,
      networksChecked: networks,
      overall: { outcome: report.overall, label: OUTCOME_LABEL[report.overall] },
      exitCode: report.exitCode,
      counts,
      notes,
      information,
      checks,
      coverage: T.coverage,
    },
  };
}

export function buildInvalidManifestDocument(
  productName: string,
  manifestPath: string,
  reason: string,
  issues: string[],
): ReportDocument<InvalidManifestJson> {
  const manifestName = fileName(manifestPath);
  const label = OUTCOME_LABEL['could-not-verify'];
  const cleanIssues = issues.map((i) => i.replace(/`/g, "'"));
  const blocks: Block[] = [
    { type: 'title', text: [text(`${productName} ${T.reportTitle}`)] },
    { type: 'para', text: [text(`${T.manifestLabel} `), code(manifestName)] },
    { type: 'para', text: [{ t: label, strong: true }, text(`: ${T.invalidManifest}`)] },
    { type: 'para', text: [text(reason)] },
    ...(cleanIssues.length ? [{ type: 'list', items: cleanIssues.map((i) => [code(i)]) } as Block] : []),
    { type: 'rule' },
    { type: 'para', text: [text(T.coverage)] },
  ];
  return {
    blocks,
    json: {
      formatVersion: REPORT_JSON_VERSION,
      kind: 'invalid-manifest',
      manifest: manifestName,
      overall: { outcome: 'could-not-verify', label },
      exitCode: 2,
      text: T.invalidManifest,
      reason,
      issues: cleanIssues,
      coverage: T.coverage,
    },
  };
}
