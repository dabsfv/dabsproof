// The CLI, as a pure function so tests can call it. It reads only the manifests named on the
// command line and sends nothing anywhere.
import { brand } from '@dabsproof/brand';
import { analyse, loadManifest, type Manifest, renderInvalidManifest, renderStaticReport } from '@dabsproof/core';

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: 0 | 1 | 2;
}

export const usage = (): string =>
  `Usage: ${brand.cliName} check <manifest.json> [--previous <earlier-manifest.json>]...`;

const usageError = (): RunResult => ({ stdout: '', stderr: `${usage()}\n`, exitCode: 2 });

/** check <manifest> followed by any number of --previous <file>, oldest first. */
function parse(argv: readonly string[]): { file: string; previous: string[] } | null {
  const [command, file, ...rest] = argv;
  if (command !== 'check' || !file || file.startsWith('--')) return null;
  const previous: string[] = [];
  for (let i = 0; i < rest.length; i += 2) {
    const value = rest[i + 1];
    if (rest[i] !== '--previous' || !value || value.startsWith('--')) return null;
    previous.push(value);
  }
  return { file, previous };
}

export function run(argv: readonly string[]): RunResult {
  if (argv[0] === '--help' || argv[0] === '-h') return { stdout: `${usage()}\n`, stderr: '', exitCode: 0 };
  const args = parse(argv);
  if (!args) return usageError();
  const loaded = loadManifest(args.file);
  if (!loaded.ok) {
    if (loaded.kind === 'refused') return { stdout: '', stderr: `${loaded.reason}\n${usage()}\n`, exitCode: 2 };
    return {
      stdout: renderInvalidManifest(brand.productName, args.file, loaded.reason, loaded.issues),
      stderr: '',
      exitCode: 2,
    };
  }
  const previous: Manifest[] = [];
  const read: string[] = [];
  const unreadable: { path: string; reason: string }[] = [];
  for (const path of args.previous) {
    const p = loadManifest(path);
    if (p.ok) {
      previous.push(p.manifest);
      read.push(path);
    } else unreadable.push({ path, reason: p.reason });
  }
  const report = analyse(loaded.manifest, { previous, previousUnreadable: unreadable.length });
  return {
    stdout: renderStaticReport(brand.productName, args.file, report, { read, unreadable }),
    stderr: '',
    exitCode: report.exitCode,
  };
}
