// Static analysis, results, evidence and reports.
import { brand } from '@dabsproof/brand';
import { checks } from '@dabsproof/registry';

export { registryText, type TextPart } from './lint/registry-text.js';
export { FORBIDDEN_WORDS, lintWording, US_SPELLINGS, type WordingProblem, withoutCode } from './lint/wording.js';
export { type LoadResult, loadManifest, MAX_MANIFEST_BYTES } from './manifest/load.js';
export { MANIFEST_TEXT } from './manifest/messages.js';
export { type Manifest, type ManifestRoute, ManifestSchema } from './manifest/schema.js';
export { renderInvalidManifest, renderStaticReport, shortAddress } from './report/markdown.js';
export { REPORT_TEXT, reportSentences } from './report/text.js';
export type { CheckResult, ResultGroup, RouteRef } from './results/types.js';
export { analyse, exitCodeFor, type StaticReport } from './static/analyse.js';
export { STATIC_IMPLEMENTATIONS } from './static/implementations.js';

export function summary(): string {
  return `${brand.productName}: ${checks.length} checks loaded`;
}
