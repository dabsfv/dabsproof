// The only place code reads the product name and slugs from. The values live in
// brand.config.json at the repo root; the build copies them into this package.
import config from '../../../brand.config.json' with { type: 'json' };

export interface Brand {
  readonly productName: string;
  readonly slug: string;
  readonly cliName: string;
  readonly npmScope: string;
  readonly domain: string | null;
  readonly dnsLabel: string;
  readonly wellKnownFile: string;
  readonly configDir: string;
}

const TEXT_FIELDS = ['productName', 'slug', 'cliName', 'npmScope', 'dnsLabel', 'wellKnownFile', 'configDir'] as const;

/** Checks the shape of brand.config.json; throws naming the field, never its value. */
export function parseBrand(raw: unknown): Brand {
  if (typeof raw !== 'object' || raw === null) throw new Error('brand.config.json must hold an object');
  const r = raw as Record<string, unknown>;
  const allowed = new Set<string>([...TEXT_FIELDS, 'domain']);
  for (const key of Object.keys(r))
    if (!allowed.has(key)) throw new Error(`brand.config.json has an unknown field: ${key}`);
  for (const key of TEXT_FIELDS) {
    if (typeof r[key] !== 'string' || r[key] === '')
      throw new Error(`brand.config.json field ${key} must be non-empty text`);
  }
  if (r.domain !== null && typeof r.domain !== 'string')
    throw new Error('brand.config.json field domain must be text or null');
  return Object.freeze({ ...(r as unknown as Brand) });
}

export const brand: Brand = parseBrand(config);
