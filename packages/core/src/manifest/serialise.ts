// Stable manifest output: fixed key order, two-space indent, a final newline. Entry order is
// kept as given (the importer and exportManifest() already sort their output).
import type { Manifest, ManifestRoute, NotExported } from './schema.js';

const ROUTE_KEYS = ['route', 'tier', 'scheme', 'price', 'asset', 'network', 'address', 'index', 'perResource'] as const;

function ordered<T extends object>(value: T, keys: readonly string[]): Record<string, unknown> {
  const v = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of keys) if (v[k] !== undefined) out[k] = v[k];
  return out;
}

export function serialiseManifest(m: Manifest): string {
  const out: Record<string, unknown> = {};
  if (m.$comment !== undefined) out.$comment = m.$comment;
  out.manifestVersion = m.manifestVersion;
  out.routes = m.routes.map((r: ManifestRoute) => ordered(r, ROUTE_KEYS));
  if (m.notExported !== undefined)
    out.notExported = m.notExported.map((n: NotExported) => ordered(n, ['route', 'reason']));
  return `${JSON.stringify(out, null, 2)}\n`;
}
