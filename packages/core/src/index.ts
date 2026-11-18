// Static analysis, results, evidence and reports. Placeholder until step 0.7.
import { brand } from '@dabsproof/brand';
import { checks } from '@dabsproof/registry';

export function summary(): string {
  return `${brand.productName}: ${checks.length} checks loaded`;
}
