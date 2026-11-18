// The CLI, as a pure function so tests can call it. It reads only the manifest named on the
// command line and sends nothing anywhere.
import { brand } from '@dabsproof/brand';
import { analyse, loadManifest, renderInvalidManifest, renderStaticReport } from '@dabsproof/core';

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: 0 | 1 | 2;
}

export const usage = (): string => `Usage: ${brand.cliName} check <manifest.json>`;

export function run(argv: readonly string[]): RunResult {
  const [command, file, ...rest] = argv;
  if (command === '--help' || command === '-h') return { stdout: `${usage()}\n`, stderr: '', exitCode: 0 };
  if (command !== 'check' || !file || rest.length) return { stdout: '', stderr: `${usage()}\n`, exitCode: 2 };
  const loaded = loadManifest(file);
  if (!loaded.ok) {
    if (loaded.kind === 'refused') return { stdout: '', stderr: `${loaded.reason}\n${usage()}\n`, exitCode: 2 };
    return {
      stdout: renderInvalidManifest(brand.productName, file, loaded.reason, loaded.issues),
      stderr: '',
      exitCode: 2,
    };
  }
  const report = analyse(loaded.manifest);
  return { stdout: renderStaticReport(brand.productName, file, report), stderr: '', exitCode: report.exitCode };
}
