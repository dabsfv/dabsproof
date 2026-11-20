import { realpathSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

export const DEFAULT_MAPPING = 'payto-map.json';
/** Test mappings may live only in a temp folder whose name starts with this. */
export const TEMP_MAPPING_PREFIX = 'demo-seller-mapping-';

const under = (dir, file) => file.startsWith(dir + sep);

/**
 * The mapping file as a real path, or null if it is missing, not a regular .json file, or outside
 * both the app folder (excluding node_modules and .next) and a TEMP_MAPPING_PREFIX folder directly
 * inside the system temp folder.
 */
export function mappingPath(env = process.env, appDir = process.cwd()) {
  let file;
  let app;
  let temp;
  try {
    file = realpathSync(env.DEMO_MAPPING ? resolve(appDir, env.DEMO_MAPPING) : join(appDir, DEFAULT_MAPPING));
    app = realpathSync(appDir);
    temp = realpathSync(tmpdir());
    if (!file.endsWith('.json') || !statSync(file).isFile()) return null;
  } catch {
    return null;
  }
  if (under(app, file)) {
    const parts = file.slice(app.length + 1).split(sep);
    return parts.includes('node_modules') || parts[0] === '.next' ? null : file;
  }
  if (under(temp, file)) {
    const parts = file.slice(temp.length + 1).split(sep);
    return parts.length === 2 && parts[0].startsWith(TEMP_MAPPING_PREFIX) ? file : null;
  }
  return null;
}

/** Options for the request-time fallback, or none when DEMO_FALLBACK_OPTIONS is "0" (test T8) or there is no usable mapping. */
export function routeOptions(env = process.env) {
  if (env.DEMO_FALLBACK_OPTIONS === '0') return undefined;
  const mapping = mappingPath(env);
  return mapping ? { mapping } : undefined;
}
