// The wording lint for everything a seller reads. Text inside backticks is skipped (code,
// header names). Plain English cannot be checked by a program; review covers it.

export type WordingRule = 'forbidden-word' | 'us-spelling' | 'capitalised-severity';
export interface WordingProblem {
  rule: WordingRule;
  word: string;
  index: number;
  suggestion?: string;
}

// Claims the product never makes (CLAUDE.md, plan §2.3).
export const FORBIDDEN_WORDS = [
  'secure',
  'safe',
  'unhackable',
  'guarantee',
  'guaranteed',
  'guarantees',
  'audit',
  'audited',
  'audits',
] as const;

// An explicit list, no suffix rules. "license" is left out on purpose; review catches it.
export const US_SPELLINGS: Readonly<Record<string, string>> = Object.freeze({
  authorize: 'authorise',
  authorized: 'authorised',
  authorization: 'authorisation',
  behavior: 'behaviour',
  color: 'colour',
  analyze: 'analyse',
  analyzed: 'analysed',
  recognize: 'recognise',
  organization: 'organisation',
  initialize: 'initialise',
  center: 'centre',
  catalog: 'catalogue',
  canceled: 'cancelled',
  canceling: 'cancelling',
  favor: 'favour',
  honor: 'honour',
  labeled: 'labelled',
  modeled: 'modelled',
  defense: 'defence',
  offense: 'offence',
});

const SEVERITY_WORDS = ['critical', 'high', 'medium', 'low'];

/** Replaces backtick spans with spaces, so positions stay the same. */
export function withoutCode(text: string): string {
  return text.replace(/`[^`]*`/g, (span) => ' '.repeat(span.length));
}

export function lintWording(text: string): WordingProblem[] {
  const plain = withoutCode(text);
  const problems: WordingProblem[] = [];
  for (const m of plain.matchAll(/\b[A-Za-z]+\b/g)) {
    const word = m[0];
    const lower = word.toLowerCase();
    if ((FORBIDDEN_WORDS as readonly string[]).includes(lower)) {
      problems.push({ rule: 'forbidden-word', word, index: m.index });
    }
    const uk = US_SPELLINGS[lower];
    if (uk) problems.push({ rule: 'us-spelling', word, index: m.index, suggestion: uk });
    if (SEVERITY_WORDS.includes(lower) && word !== lower) {
      problems.push({ rule: 'capitalised-severity', word, index: m.index, suggestion: lower });
    }
  }
  return problems.sort((a, b) => a.index - b.index);
}
