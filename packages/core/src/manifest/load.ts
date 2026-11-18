// Reads one manifest file, and only that file. Problems are described by field path, never
// by the value found there.
import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { MANIFEST_TEXT as M } from './messages.js';
import { describeIssues, type Manifest, ManifestSchema } from './schema.js';

export const MAX_MANIFEST_BYTES = 1024 * 1024;

export type LoadResult =
  | { ok: true; manifest: Manifest }
  | { ok: false; kind: 'refused'; reason: string }
  | { ok: false; kind: 'invalid'; reason: string; issues: string[] };

export function loadManifest(path: string): LoadResult {
  if (basename(path).toLowerCase().startsWith('.env')) {
    return { ok: false, kind: 'refused', reason: M.envRefused };
  }
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    return { ok: false, kind: 'refused', reason: M.cannotOpen };
  }
  if (size > MAX_MANIFEST_BYTES) return { ok: false, kind: 'refused', reason: M.tooLarge };
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { ok: false, kind: 'invalid', reason: M.notJson, issues: [] };
  }
  const parsed = ManifestSchema.safeParse(data);
  if (!parsed.success) {
    const issues = describeIssues(parsed.error.issues);
    return { ok: false, kind: 'invalid', reason: M.wrongFormat, issues };
  }
  return { ok: true, manifest: parsed.data };
}
