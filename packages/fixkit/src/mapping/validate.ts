// The mapping validator. It has no checks of its own: it loads the mapping with core's loader or
// schema, runs core's analyse(), decides with core's exit code, and words the result with core's
// report. A test proves its results are identical to analyse() for every fixture.
import { brand } from '@dabsproof/brand';
import {
  analyse,
  buildInvalidManifestDocument,
  buildStaticReportDocument,
  type CheckResult,
  describeIssues,
  loadManifest,
  MANIFEST_TEXT,
  type Manifest,
  ManifestSchema,
  renderTerminal,
  type StaticReport,
} from '@dabsproof/core';

export interface ValidateOptions {
  /** Earlier mappings, for the stale-mapping check. */
  previous?: readonly Manifest[];
  /** Refuse when anything could not be verified (exit code 2), not only on a problem. */
  strict?: boolean;
  /** File name shown in the report when the mapping is passed as an object. */
  name?: string;
}

export type Validation =
  | {
      decision: 'start' | 'refuse';
      exitCode: 0 | 1 | 2;
      manifest: Manifest;
      report: StaticReport;
      results: CheckResult[];
      /** The existing terminal report, word for word. */
      text: string;
    }
  | { decision: 'refuse'; exitCode: 1; manifest: null; report: null; results: []; text: string };

/** A mapping as a manifest object, or the path of a manifest file. */
export type MappingInput = Manifest | unknown;

export function validateMapping(input: MappingInput | string, options: ValidateOptions = {}): Validation {
  const shownName = typeof input === 'string' ? input : (options.name ?? 'mapping.json');
  let manifest: Manifest;
  if (typeof input === 'string') {
    const r = loadManifest(input);
    if (!r.ok) {
      const issues = r.kind === 'invalid' ? r.issues : [];
      const doc = buildInvalidManifestDocument(brand.productName, shownName, r.reason, issues);
      return { decision: 'refuse', exitCode: 1, manifest: null, report: null, results: [], text: renderTerminal(doc) };
    }
    manifest = r.manifest;
  } else {
    const r = ManifestSchema.safeParse(input);
    if (!r.success) {
      const doc = buildInvalidManifestDocument(
        brand.productName,
        shownName,
        MANIFEST_TEXT.wrongFormat,
        describeIssues(r.error.issues),
      );
      return { decision: 'refuse', exitCode: 1, manifest: null, report: null, results: [], text: renderTerminal(doc) };
    }
    manifest = r.data;
  }
  const previous = [...(options.previous ?? [])];
  const report = analyse(manifest, { previous });
  const text = renderTerminal(
    buildStaticReportDocument(brand.productName, shownName, report, {
      read: previous.map((_, i) => `previous-${i + 1}.json`),
      unreadable: [],
    }),
  );
  const refuse = report.exitCode === 1 || (options.strict === true && report.exitCode === 2);
  return {
    decision: refuse ? 'refuse' : 'start',
    exitCode: report.exitCode,
    manifest,
    report,
    results: report.results,
    text,
  };
}
