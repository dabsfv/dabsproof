// The CLI, as a pure function so tests can call it. It reads only the manifests named on the
// command line and sends nothing anywhere. With --format json, standard output holds only the
// JSON document, whatever happens, and nothing is written to standard error.
import { brand } from '@dabsproof/brand';
import {
  analyse,
  buildInvalidManifestDocument,
  buildStaticReportDocument,
  loadManifest,
  type Manifest,
  type ReportDocument,
  refusedJson,
  renderJson,
  renderMarkdown,
  renderTerminal,
  usageErrorJson,
} from '@dabsproof/core';

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: 0 | 1 | 2;
}

export const FORMATS = ['terminal', 'markdown', 'json'] as const;
export type Format = (typeof FORMATS)[number];

export const usage = (): string =>
  `Usage: ${brand.cliName} check <manifest.json> [--previous <earlier-manifest.json>]... [--format terminal|markdown|json]`;

/** Takes --format out of the arguments first, so a JSON request is honoured even when the rest is wrong. */
function takeFormat(argv: readonly string[]): { format: Format; rest: string[] } | null {
  const rest: string[] = [];
  let format: Format = 'terminal';
  let seen = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== '--format') {
      rest.push(argv[i] as string);
      continue;
    }
    const value = argv[i + 1];
    if (seen || !value || !(FORMATS as readonly string[]).includes(value)) return null;
    format = value as Format;
    seen = true;
    i++;
  }
  return { format, rest };
}

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

const render = (format: Format, doc: ReportDocument<unknown>): string =>
  format === 'json' ? renderJson(doc) : format === 'markdown' ? renderMarkdown(doc) : renderTerminal(doc);

export function run(argv: readonly string[]): RunResult {
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) {
    return { stdout: `${usage()}\n`, stderr: '', exitCode: 0 };
  }
  const taken = takeFormat(argv);
  if (!taken) return { stdout: '', stderr: `${usage()}\n`, exitCode: 2 };
  const { format, rest } = taken;
  const args = parse(rest);
  if (!args) {
    return format === 'json'
      ? { stdout: usageErrorJson(usage()), stderr: '', exitCode: 2 }
      : { stdout: '', stderr: `${usage()}\n`, exitCode: 2 };
  }
  const loaded = loadManifest(args.file);
  if (!loaded.ok) {
    if (loaded.kind === 'refused') {
      return format === 'json'
        ? { stdout: refusedJson(args.file, loaded.reason, usage()), stderr: '', exitCode: 2 }
        : { stdout: '', stderr: `${loaded.reason}\n${usage()}\n`, exitCode: 2 };
    }
    const doc = buildInvalidManifestDocument(brand.productName, args.file, loaded.reason, loaded.issues);
    return { stdout: render(format, doc), stderr: '', exitCode: 2 };
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
  const doc = buildStaticReportDocument(brand.productName, args.file, report, { read, unreadable });
  return { stdout: render(format, doc), stderr: '', exitCode: report.exitCode };
}
