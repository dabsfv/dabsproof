// exportManifest(): turns a seller's x402 route configuration into a manifest. The input types
// below are written locally to match the shape @x402/core 2.31.0 documents (one route config,
// or a map from path pattern to route config); nothing is imported from @x402 packages.
// Anything that is not fixed in the configuration goes to notExported with a reason code.
import { MANIFEST_TEXT as M } from './messages.js';
import { dollarsToUnits, isValidDecimals } from './price.js';
import {
  ADDRESS,
  EVM_NETWORK,
  type Manifest,
  type ManifestRoute,
  ManifestSchema,
  type NotExported,
  type NotExportedReason,
  ROUTE,
  SCHEMES,
  type Scheme,
} from './schema.js';

/** One way to pay for a route: scheme, recipient, price and network. Other fields are ignored. */
export interface PaymentOptionLike {
  scheme: string;
  payTo: unknown;
  price: unknown;
  network: string;
  [other: string]: unknown;
}

/** A route's payment configuration: one payment option or a list. Other fields are ignored. */
export interface RouteConfigLike {
  accepts: PaymentOptionLike | PaymentOptionLike[];
  [other: string]: unknown;
}

export type RoutesConfigLike = RouteConfigLike | Record<string, RouteConfigLike>;

export interface ExportOptions {
  /** The asset every "$" price is paid in (the money string itself names none). */
  asset: string;
  /** The asset's decimal places, used to turn "$0.001" into smallest units. */
  decimals: number;
  /** Required when routes is a single route configuration rather than a map of paths. */
  path?: string;
}

const isSingle = (r: RoutesConfigLike): r is RouteConfigLike => Object.hasOwn(r, 'accepts');

function termsOf(
  route: string,
  option: PaymentOptionLike,
  options: ExportOptions,
): { ok: true; entry: ManifestRoute } | { ok: false; reason: NotExportedReason } {
  if (!(SCHEMES as readonly string[]).includes(option.scheme)) return { ok: false, reason: 'scheme-unknown' };
  if (typeof option.network !== 'string' || !EVM_NETWORK.test(option.network))
    return { ok: false, reason: 'network-not-evm' };
  if (typeof option.payTo === 'function') return { ok: false, reason: 'payto-function' };
  if (typeof option.payTo !== 'string' || !ADDRESS.test(option.payTo))
    return { ok: false, reason: 'payto-not-address' };
  const price = option.price;
  if (typeof price === 'function') return { ok: false, reason: 'price-function' };
  if (typeof price === 'number') return { ok: false, reason: 'price-number' };
  if (typeof price === 'object' && price !== null) return { ok: false, reason: 'price-asset-amount' };
  if (typeof price !== 'string') return { ok: false, reason: 'price-format' };
  const units = dollarsToUnits(price, options.decimals);
  if (!units.ok) return { ok: false, reason: units.reason };
  const scheme = option.scheme as Scheme;
  return {
    ok: true,
    entry: {
      route,
      ...(scheme === 'exact' ? {} : { scheme }),
      price: units.units,
      asset: options.asset,
      network: option.network,
      address: option.payTo,
    } as ManifestRoute,
  };
}

export function exportManifest(routes: RoutesConfigLike, options: ExportOptions): Manifest {
  if (typeof options?.asset !== 'string' || !ADDRESS.test(options.asset)) throw new Error(`asset: ${M.address}`);
  if (!isValidDecimals(options.decimals)) throw new Error(`decimals: ${M.decimals}`);
  let pairs: [string, RouteConfigLike][];
  if (isSingle(routes)) {
    if (typeof options.path !== 'string') throw new Error(`path: ${M.needsPath}`);
    pairs = [[options.path, routes]];
  } else {
    pairs = Object.entries(routes);
  }
  const entries: ManifestRoute[] = [];
  const notExported: NotExported[] = [];
  const seen = new Set<string>();
  for (const [route, config] of pairs) {
    if (!ROUTE.test(route)) throw new Error(`route: ${M.route}`);
    const list = Array.isArray(config.accepts) ? config.accepts : [config.accepts];
    for (const option of list) {
      const t = termsOf(route, option, options);
      if (!t.ok) {
        notExported.push({ route, reason: t.reason });
        continue;
      }
      const key = `${route}|${t.entry.scheme ?? 'exact'}|${t.entry.network}|${t.entry.asset.toLowerCase()}`;
      if (seen.has(key)) {
        notExported.push({ route, reason: 'duplicate-option' });
        continue;
      }
      seen.add(key);
      entries.push(t.entry);
    }
  }
  const byRoute = (a: { route: string }, b: { route: string }) => a.route.localeCompare(b.route);
  entries.sort(
    (a, b) =>
      byRoute(a, b) || (a.scheme ?? 'exact').localeCompare(b.scheme ?? 'exact') || a.network.localeCompare(b.network),
  );
  notExported.sort((a, b) => byRoute(a, b) || a.reason.localeCompare(b.reason));
  return ManifestSchema.parse({ manifestVersion: 1, routes: entries, ...(notExported.length ? { notExported } : {}) });
}
