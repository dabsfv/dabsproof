// pnpm lint:wording for the fix kit: every FIXKIT_TEXT sentence and type label. Exit 1 on any problem.
import { lintWording } from '@dabsproof/core';
import { FIXKIT_TEXT, KEY_TYPE_LABEL } from './messages.js';

const texts = [...Object.values(FIXKIT_TEXT), ...Object.values(KEY_TYPE_LABEL)];
let problems = 0;
for (const [i, text] of texts.entries()) {
  for (const p of lintWording(text)) {
    problems++;
    const hint = p.suggestion ? ` (use "${p.suggestion}")` : '';
    console.error(`fix kit sentence ${i + 1}: ${p.rule} "${p.word}"${hint}`);
  }
}
if (problems) {
  console.error(`wording lint: ${problems} problem(s) in the fix kit sentences.`);
  process.exit(1);
}
console.log(`wording lint: this check found no problem in ${texts.length} fix kit texts.`);
