// pnpm lint:wording — runs the wording lint over every registry entry. Exit 1 on any problem.
import { EVM_TEXT } from '@dabsproof/evm';
import { checks } from '@dabsproof/registry';
import { reportSentences } from '../report/text.js';
import { registryText } from './registry-text.js';
import { lintWording } from './wording.js';

let problems = 0;
let parts = 0;
for (const entry of checks) {
  for (const part of registryText(entry)) {
    parts++;
    for (const p of lintWording(part.text)) {
      problems++;
      const hint = p.suggestion ? ` (use "${p.suggestion}")` : '';
      console.error(`${entry.id} ${part.field}: ${p.rule} "${p.word}"${hint}`);
    }
  }
}
for (const [i, text] of [...reportSentences(), ...Object.values(EVM_TEXT)].entries()) {
  parts++;
  for (const p of lintWording(text)) {
    problems++;
    const hint = p.suggestion ? ` (use "${p.suggestion}")` : '';
    console.error(`report sentence ${i + 1}: ${p.rule} "${p.word}"${hint}`);
  }
}
if (problems) {
  console.error(`wording lint: ${problems} problem(s) in ${checks.length} registry entries.`);
  process.exit(1);
}
console.log(
  `wording lint: this check found no problem in ${parts} texts (${checks.length} registry entries, ${reportSentences().length} report and manifest sentences and ${Object.values(EVM_TEXT).length} evm sentences).`,
);
