// Static analysis, results, evidence and reports.
import { brand } from '@dabsproof/brand';
import { checks } from '@dabsproof/registry';

export { registryText, type TextPart } from './lint/registry-text.js';
export { FORBIDDEN_WORDS, lintWording, US_SPELLINGS, type WordingProblem, withoutCode } from './lint/wording.js';
export {
  type ExportOptions,
  exportManifest,
  type PaymentOptionLike,
  type RouteConfigLike,
  type RoutesConfigLike,
} from './manifest/export.js';
export { type ImportOptions, type ImportResult, importDemoConfig } from './manifest/import-demo.js';
export { type LoadResult, loadManifest, MAX_MANIFEST_BYTES } from './manifest/load.js';
export { MANIFEST_TEXT } from './manifest/messages.js';
export { dollarsToUnits, type PriceResult } from './manifest/price.js';
export {
  describeIssues,
  isDynamic,
  MAX_INDEX,
  type Manifest,
  type ManifestRoute,
  ManifestSchema,
  NOT_EXPORTED_REASONS,
  NOT_EXPORTED_TEXT,
  type NotExported,
  type NotExportedReason,
  SCHEMES,
  type Scheme,
} from './manifest/schema.js';
export { serialiseManifest } from './manifest/serialise.js';
export {
  type Block,
  buildInvalidManifestDocument,
  buildStaticReportDocument,
  type InvalidManifestJson,
  type Line,
  type PreviousManifests,
  plain,
  REPORT_JSON_VERSION,
  type ReportDocument,
  type ReportJson,
  type Segment,
  shortAddress,
} from './report/document.js';
export { type ReportJsonOutput, ReportJsonSchema, refusedJson, renderJson, usageErrorJson } from './report/json.js';
export { renderInvalidManifest, renderMarkdown, renderStaticReport } from './report/markdown.js';
export { renderTerminal } from './report/terminal.js';
export { REPORT_TEXT, reportSentences } from './report/text.js';
export type { CheckResult, ResultGroup, RouteRef, StaticContext } from './results/types.js';
export { type AnalyseOptions, analyse, exitCodeFor, type StaticReport, staticNetworkFilter } from './static/analyse.js';
export { type HistoryChanges, historyChanges } from './static/checks/x402-03.js';
export { STATIC_IMPLEMENTATIONS } from './static/implementations.js';

export function summary(): string {
  return `${brand.productName}: ${checks.length} checks loaded`;
}

// Evidence (step 1.5).
export * from './evidence/index.js';
