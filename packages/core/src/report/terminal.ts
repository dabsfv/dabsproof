// Terminal renderer: plain text, no colour, no Markdown markers. It reads the report document
// and adds layout only (underlines, bullets, column alignment); every word comes from the document.
import type { Block, Line, ReportDocument } from './document.js';

const line = (segments: Line): string => segments.map((s) => s.t).join('');
const width = (s: string): number => [...s].length;

function block(b: Block): string {
  switch (b.type) {
    case 'title': {
      const t = line(b.text);
      return `${t}\n${'='.repeat(width(t))}`;
    }
    case 'h2': {
      const t = line(b.text);
      return `${t}\n${'-'.repeat(width(t))}`;
    }
    case 'h3':
    case 'para':
      return line(b.text);
    case 'list':
      return [...(b.lead ? [line(b.lead)] : []), ...b.items.map((i) => `- ${line(i)}`)].join('\n');
    case 'numbered':
      return b.items.map((i, n) => `${n + 1}. ${line(i)}`).join('\n');
    case 'table': {
      const w = Math.max(width(b.head[0]), ...b.rows.map(([a]) => width(a)));
      const row = (a: string, c: string) => `${a}${' '.repeat(w - width(a))}  ${c}`;
      return [row(b.head[0], b.head[1]), ...b.rows.map(([a, c]) => row(a, c))].join('\n');
    }
    case 'rule':
      return '---';
  }
}

export const renderTerminal = (doc: ReportDocument<unknown>): string => `${doc.blocks.map(block).join('\n\n')}\n`;
