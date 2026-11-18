// pnpm lint:wording — runs the wording lint over every registry entry. Exit 1 on any problem.
import { checks } from '@dabsproof/registry';
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
if (problems) {
  console.error(`wording lint: ${problems} problem(s) in ${checks.length} registry entries.`);
  process.exit(1);
}
console.log(`wording lint: this check found no problem in ${parts} texts across ${checks.length} registry entries.`);
