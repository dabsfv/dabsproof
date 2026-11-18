// The only place code reads the product name and slugs from. The values live in
// brand.config.json at the repo root.
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

export const brand: Brand = Object.freeze({ ...config });
