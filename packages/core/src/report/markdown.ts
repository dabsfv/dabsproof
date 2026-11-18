// One renderer for the report (Markdown here; HTML later). All wording comes from the registry
// or from REPORT_TEXT, so pnpm lint:wording covers every sentence a seller reads.
import { BASE_SEPOLIA, type CheckEntry, getCheck, OUTCOME_LABEL, OUTCOMES } from '@dabsproof/registry';
import { type ManifestRoute, NOT_EXPORTED_TEXT } from '../manifest/schema.js';
import type { CheckResult, ResultGroup, RouteRef } from '../results/types.js';
import type { StaticReport } from '../static/analyse.js';
import { REPORT_TEXT as T } from './text.js';

/** First 6 and last 4 characters, for example 0x0000…0010. */
export const shortAddress = (a: string): string => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** Who gets paid, as shown to a seller. */
function payeeLabel(r: { address?: string; index?: number; range?: { first: number; last: number }; base?: number }) {
  if (r.address !== undefined) return `\`${shortAddress(r.address)}\``;
  if (r.range) return `${T.addressIndexesLabel} ${r.range.first} ${T.rangeTo} ${r.range.last}`;
  if (r.index !== undefined) return `${T.addressIndexLabel} ${r.index}`;
  return `${T.baseIndexLabel} ${r.base}`;
}
const manifestPayee = (r: ManifestRoute): string => {
  const p = r.perResource;
  const range =
    p && p.firstId !== undefined && p.lastId !== undefined
      ? { first: p.baseIndex + p.firstId, last: p.baseIndex + p.lastId }
      : undefined;
  return payeeLabel({
    ...(r.address !== undefined ? { address: r.address } : {}),
    ...(r.index !== undefined ? { index: r.index } : {}),
    ...(range ? { range } : {}),
    ...(p ? { base: p.baseIndex } : {}),
  });
};

/** One route per line: tier and scheme only when they matter, then who gets paid. */
const routeLine =
  (showScheme: boolean) =>
  (r: RouteRef): string => {
    const parts: string[] = [];
    if (r.tier !== undefined) parts.push(`${T.tierLabel} ${r.tier}`);
    if (showScheme) parts.push(`${T.schemeLabel} ${r.scheme}`);
    parts.push(payeeLabel(r));
    const earlier = r.earlierRoute !== undefined ? `; ${T.earlierGivenTo} \`${r.earlierRoute}\`` : '';
    return `- \`${r.route}\` (${parts.join(', ')}${earlier})`;
  };

const tierPart = (r: ManifestRoute) => (r.tier !== undefined ? ` (${T.tierLabel} ${r.tier})` : '');

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

function resultLines(entry: CheckEntry, r: CheckResult, all: CheckResult[], showScheme: boolean): string[] {
  const line = routeLine(showScheme);
  const sub = subFor(entry, r.subCheckId);
  const heading = `### ${r.subCheckId}: ${OUTCOME_LABEL[r.outcome]}${r.severity ? ` (${T.severityLabel} ${r.severity})` : ''}`;
  const out = [heading, '', sub.title, ''];
  if (r.outcome === 'found-a-problem') {
    const causeFound = (g: ResultGroup) =>
      g.sameMistakeAs !== undefined &&
      all.some((o) => o.subCheckId === g.sameMistakeAs && o.outcome === 'found-a-problem');
    const own = r.groups.filter((g) => !causeFound(g));
    const repeats = r.groups.filter(causeFound);
    if (own.length) {
      out.push(sub.static['found-a-problem'], '', T.sharedHeading);
      for (const g of own) out.push(...g.routes.map(line), '');
    }
    for (const g of repeats) out.push(T.sameMistake, ...g.routes.map(line), '');
  } else if (r.outcome === 'found-no-problem') {
    // Static results compare routes within one payment scheme (X402-03 version 3 texts).
    out.push(sub.static['found-no-problem-within-scheme'] ?? sub.static['found-no-problem'], '');
  } else if (r.outcome === 'not-applicable') {
    out.push(
      r.note === 'no-index' ? T.noIndex : (sub.static['not-applicable'] ?? entry.outcomes['not-applicable']),
      '',
    );
  } else {
    const fixed = r.note === 'nothing-checked' ? T.nothingChecked : r.note === 'nothing-fixed' ? T.nothingFixed : null;
    out.push(fixed ?? sub.static['could-not-verify'] ?? entry.outcomes['could-not-verify'], '');
  }
  return out;
}

function fixLines(entry: CheckEntry): string[] {
  const rem = entry.remediation;
  const out = [`${T.whatSomeoneCouldDo} ${entry.whatSomeoneCouldDo}`, ''];
  for (const e of entry.escalation ?? []) out.push(`${T.escalationLead} ${e.to} if ${e.when}.`, '');
  out.push(T.fromManifest, '', `### ${T.howToFix}`, '', rem.summary, '');
  rem.steps.forEach((s, i) => {
    out.push(`${i + 1}. ${s}`);
  });
  out.push('', rem.generalGuidance, '');
  for (const n of rem.notAFix ?? []) out.push(`${T.notAFix} ${n}`, '');
  return out;
}

/** The networks of the routes actually checked (Base Sepolia when none were checked). */
function networksPart(report: StaticReport): string {
  const networks = [...new Set(report.checkedRoutes.map((r) => r.network))];
  if (!networks.length) return `${T.networkLabel} ${BASE_SEPOLIA}`;
  return `${networks.length > 1 ? T.networksLabel : T.networkLabel} ${networks.join(', ')}`;
}

export interface PreviousManifests {
  /** Earlier manifests that were read, as the seller named them. */
  read: string[];
  /** Earlier manifests that could not be read, with a linted reason. */
  unreadable: { path: string; reason: string }[];
}

export function renderStaticReport(
  productName: string,
  manifestPath: string,
  report: StaticReport,
  previous: PreviousManifests = { read: [], unreadable: [] },
): string {
  const out = [
    `# ${productName} check report`,
    '',
    `${T.manifestLabel} \`${manifestPath}\` · ${T.routesReadLabel} ${report.routesRead} · ${networksPart(report)}`,
    '',
    T.fromManifest,
    '',
  ];
  if (previous.read.length) out.push(T.previousLabel, ...previous.read.map((p) => `- \`${p}\``), '');
  if (previous.unreadable.length) {
    out.push(T.previousUnreadableHeading, ...previous.unreadable.map((p) => `- \`${p.path}\`: ${p.reason}`), '');
  }
  if (report.mixedSchemes) out.push(T.schemesSeparate, '');
  if (!report.checkedRoutes.length) out.push(`**${report.routesRead ? T.nothingChecked : T.nothingFixed}**`, '');
  if (report.skippedRoutes.length) {
    out.push(T.skippedRoutes, ...report.skippedRoutes.map((r) => `- \`${r.route}\` (${r.network})`), '');
  }
  if (report.otherNetworkRoutes.length) {
    const lines = report.otherNetworkRoutes.map((r) => `- \`${r.route}\`${tierPart(r)} (${r.network})`);
    out.push(T.otherNetworks, ...lines, '');
  }
  if (report.notExported.length) {
    const lines = report.notExported.map((n) => `- \`${n.route}\`: ${NOT_EXPORTED_TEXT[n.reason]}`);
    out.push(T.notExportedHeading, ...lines, '', `**${T.notExportedOverall}**`, '');
  }
  if (report.perResourceRoutes.length) {
    const lines = report.perResourceRoutes.map((r) => `- \`${r.route}\` (${manifestPayee(r)})`);
    out.push(T.perResourceLeftOut, ...lines, '');
  }
  if (report.hasTiers) out.push(T.queryVariantsNotTried, '');
  if (report.history.moved.length) {
    const lines = report.history.moved.map(
      ({ now, earlier }) =>
        `- \`${now.route}\`${tierPart(now)} (${T.wasLabel} ${manifestPayee(earlier)}, ${T.nowLabel} ${manifestPayee(now)})`,
    );
    out.push(T.movedHeading, ...lines, '');
  }
  if (report.history.reusedOtherTerms.length) {
    const lines = report.history.reusedOtherTerms.map(
      ({ now, earlier }) =>
        `- \`${now.route}\`${tierPart(now)} (${manifestPayee(now)}; ${T.earlierGivenTo} \`${earlier.route}\`)`,
    );
    out.push(T.reusedOtherTermsHeading, ...lines, '');
  }
  out.push(`| ${T.outcomeCount} | ${T.count} |`, '|---|---|');
  for (const o of OUTCOMES)
    out.push(`| ${OUTCOME_LABEL[o]} | ${report.results.filter((r) => r.outcome === o).length} |`);
  out.push('');
  const checkIds = [...new Set(report.results.map((r) => r.checkId))];
  for (const id of checkIds) {
    const entry = entryFor(id);
    const results = report.results.filter((r) => r.checkId === id);
    out.push(`## ${entry.id}: ${entry.title} (${T.versionLabel} ${entry.version}, ${entry.status})`, '');
    for (const r of results) out.push(...resultLines(entry, r, results, report.mixedSchemes));
    if (results.some((r) => r.outcome === 'found-a-problem')) out.push(...fixLines(entry));
  }
  out.push('---', '', T.coverage, '');
  return out.join('\n');
}

export function renderInvalidManifest(
  productName: string,
  manifestPath: string,
  reason: string,
  issues: string[],
): string {
  return [
    `# ${productName} check report`,
    '',
    `${T.manifestLabel} \`${manifestPath}\``,
    '',
    `**${OUTCOME_LABEL['could-not-verify']}**: ${T.invalidManifest}`,
    '',
    reason,
    '',
    ...issues.map((i) => `- \`${i.replace(/`/g, "'")}\``),
    ...(issues.length ? [''] : []),
    '---',
    '',
    T.coverage,
    '',
  ].join('\n');
}
