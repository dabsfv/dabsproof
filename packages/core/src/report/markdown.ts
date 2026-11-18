// Markdown renderer. It reads the report document and adds layout only (headings, bullets,
// backticks, bold, the table); every word comes from the document.
import type { StaticReport } from '../static/analyse.js';
import {
  type Block,
  buildInvalidManifestDocument,
  buildStaticReportDocument,
  type Line,
  type PreviousManifests,
  type ReportDocument,
} from './document.js';

export { type PreviousManifests, shortAddress } from './document.js';

const line = (segments: Line): string =>
  segments.map((s) => (s.code ? `\`${s.t}\`` : s.strong ? `**${s.t}**` : s.t)).join('');

function block(b: Block): string {
  switch (b.type) {
    case 'title':
      return `# ${line(b.text)}`;
    case 'h2':
      return `## ${line(b.text)}`;
    case 'h3':
      return `### ${line(b.text)}`;
    case 'para':
      return line(b.text);
    case 'list':
      return [...(b.lead ? [line(b.lead)] : []), ...b.items.map((i) => `- ${line(i)}`)].join('\n');
    case 'numbered':
      return b.items.map((i, n) => `${n + 1}. ${line(i)}`).join('\n');
    case 'table':
      return [`| ${b.head[0]} | ${b.head[1]} |`, '|---|---|', ...b.rows.map(([a, c]) => `| ${a} | ${c} |`)].join('\n');
    case 'rule':
      return '---';
  }
}

export const renderMarkdown = (doc: ReportDocument<unknown>): string => `${doc.blocks.map(block).join('\n\n')}\n`;

export function renderStaticReport(
  productName: string,
  manifestPath: string,
  report: StaticReport,
  previous?: PreviousManifests,
): string {
  return renderMarkdown(buildStaticReportDocument(productName, manifestPath, report, previous));
}

export function renderInvalidManifest(
  productName: string,
  manifestPath: string,
  reason: string,
  issues: string[],
): string {
  return renderMarkdown(buildInvalidManifestDocument(productName, manifestPath, reason, issues));
}
