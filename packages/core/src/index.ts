// Static analysis, results, evidence and reports. The check command arrives in step 0.7.
import { brand } from '@dabsproof/brand';
import { checks } from '@dabsproof/registry';

export { registryText, type TextPart } from './lint/registry-text.js';
export { FORBIDDEN_WORDS, lintWording, US_SPELLINGS, type WordingProblem, withoutCode } from './lint/wording.js';

export function summary(): string {
  return `${brand.productName}: ${checks.length} checks loaded`;
}
