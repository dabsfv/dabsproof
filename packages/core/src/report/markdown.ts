// One renderer for the report (Markdown here; HTML later). All wording comes from the registry
// or from REPORT_TEXT, so pnpm lint:wording covers every sentence a seller reads.
import { BASE_SEPOLIA, type CheckEntry, getCheck, OUTCOME_LABEL, OUTCOMES } from '@dabsproof/registry';
import type { CheckResult, ResultGroup, RouteRef } from '../results/types.js';
import type { StaticReport } from '../static/analyse.js';
import { REPORT_TEXT as T } from './text.js';

/** First 6 and last 4 characters, for example 0x0000…0010. */
export const shortAddress = (a: string): string => `${a.slice(0, 6)}…${a.slice(-4)}`;

const routeLine = (r: RouteRef): string =>
  r.address !== undefined
    ? `- \`${r.route}\` (\`${shortAddress(r.address)}\`)`
    : `- \`${r.route}\` (address index ${r.index})`;

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

function resultLines(entry: CheckEntry, r: CheckResult, all: CheckResult[]): string[] {
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
      for (const g of own) out.push(...g.routes.map(routeLine), '');
    }
    for (const g of repeats) out.push(T.sameMistake, ...g.routes.map(routeLine), '');
  } else if (r.outcome === 'found-no-problem') {
    out.push(sub.static['found-no-problem'], '');
  } else if (r.outcome === 'not-applicable') {
    out.push(r.note === 'no-index' ? T.noIndex : entry.outcomes['not-applicable'], '');
  } else {
    out.push(r.note === 'nothing-checked' ? T.nothingChecked : entry.outcomes['could-not-verify'], '');
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

export function renderStaticReport(productName: string, manifestPath: string, report: StaticReport): string {
  const out = [
    `# ${productName} check report`,
    '',
    `${T.manifestLabel} \`${manifestPath}\` · ${T.routesReadLabel} ${report.routesRead} · ${T.networkLabel} ${BASE_SEPOLIA}`,
    '',
    T.fromManifest,
    '',
  ];
  if (!report.checkedRoutes.length) out.push(`**${T.nothingChecked}**`, '');
  if (report.skippedRoutes.length) {
    out.push(T.skippedRoutes, ...report.skippedRoutes.map((r) => `- \`${r.route}\` (${r.network})`), '');
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
    for (const r of results) out.push(...resultLines(entry, r, results));
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
