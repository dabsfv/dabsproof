import { run } from '@dabsproof/cli';
import { mappingPath } from '../lib/payto.js';

const file = mappingPath();
if (!file) {
  process.stderr.write('refused: mapping-path\n');
  process.exit(1);
}
const result = run(['check', file]);
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exitCode = result.exitCode === 0 ? 0 : 1;
