// Every piece of registry text a seller reads, in reading order (title first).
import type { RegistryEntry } from '@dabsproof/registry';

export interface TextPart {
  field: string;
  text: string;
}

export function registryText(entry: RegistryEntry): TextPart[] {
  const parts: TextPart[] = [{ field: 'title', text: entry.title }];
  const add = (field: string, text: string): void => {
    parts.push({ field, text });
  };
  if (entry.status === 'retired') {
    add('retiredReason', entry.retiredReason);
    return parts;
  }
  add('whatItTests', entry.whatItTests);
  if (entry.status === 'watch') {
    add('watch.note', entry.watch.note);
    return parts;
  }
  add('whatSomeoneCouldDo', entry.whatSomeoneCouldDo);
  for (const [i, e] of (entry.escalation ?? []).entries()) add(`escalation[${i}].when`, e.when);
  for (const s of entry.subChecks) add(`${s.id} title`, s.title);
  for (const [outcome, text] of Object.entries(entry.outcomes)) add(`outcomes.${outcome}`, text);
  add('remediation.summary', entry.remediation.summary);
  for (const [i, t] of entry.remediation.steps.entries()) add(`remediation.steps[${i}]`, t);
  add('remediation.generalGuidance', entry.remediation.generalGuidance);
  for (const [i, t] of (entry.remediation.notAFix ?? []).entries()) add(`remediation.notAFix[${i}]`, t);
  return parts;
}
