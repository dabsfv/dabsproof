// The route manifest: the seller's list of paid routes. It holds public payment terms only;
// there is no field for a key, an xpub or a mnemonic, and unknown fields are refused.
import { z } from 'zod';
import { MANIFEST_TEXT as M } from './messages.js';

export const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
export const ROUTE = /^\/[^\s`]*$/;
export const EVM_NETWORK = /^eip155:\d+$/;
export const SCHEMES = ['exact', 'upto'] as const;
export type Scheme = (typeof SCHEMES)[number];

/** Why exportManifest() could not read a route's terms. Codes only, so no value can leak. */
export const NOT_EXPORTED_REASONS = [
  'payto-function',
  'price-function',
  'price-number',
  'price-asset-amount',
  'price-format',
  'price-too-precise',
  'payto-not-address',
  'network-not-evm',
  'scheme-unknown',
  'duplicate-option',
] as const;
export type NotExportedReason = (typeof NOT_EXPORTED_REASONS)[number];

export const NOT_EXPORTED_TEXT: Readonly<Record<NotExportedReason, string>> = Object.freeze({
  'payto-function': M.reasonPayToFunction,
  'price-function': M.reasonPriceFunction,
  'price-number': M.reasonPriceNumber,
  'price-asset-amount': M.reasonPriceAssetAmount,
  'price-format': M.reasonPriceFormat,
  'price-too-precise': M.reasonPriceTooPrecise,
  'payto-not-address': M.reasonPayToNotAddress,
  'network-not-evm': M.reasonNetworkNotEvm,
  'scheme-unknown': M.reasonSchemeUnknown,
  'duplicate-option': M.reasonDuplicateOption,
});

const Address = z.string().regex(ADDRESS, M.address);
const Route = z.string().regex(ROUTE, M.route);
/** Non-hardened BIP-32 child indexes only: 0 to 2^31 - 1. */
export const MAX_INDEX = 2 ** 31 - 1;
const Index = z.number().int().min(0).max(MAX_INDEX, M.indexLimit);
const ItemId = z.number().int().min(0);

export const PerResourceSchema = z
  .object({ baseIndex: Index, firstId: ItemId.optional(), lastId: ItemId.optional() })
  .strict()
  .refine((p) => (p.firstId === undefined) === (p.lastId === undefined), { message: M.idRange })
  .refine((p) => p.firstId === undefined || p.lastId === undefined || p.firstId <= p.lastId, { message: M.idRange })
  .refine((p) => p.lastId === undefined || p.baseIndex + p.lastId <= MAX_INDEX, { message: M.rangeLimit });
export const isDynamic = (route: string): boolean => /\[[^\]/]+\]/.test(route);

export const ManifestRouteSchema = z
  .object({
    route: Route,
    tier: z
      .string()
      .regex(/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/, M.tier)
      .optional(),
    scheme: z.enum(SCHEMES, { error: M.scheme }).optional(),
    // Whole number of the asset's smallest units.
    price: z.string().regex(/^\d+$/, M.price),
    asset: Address,
    network: z.string().regex(EVM_NETWORK, M.network),
    address: Address.optional(),
    index: Index.optional(),
    perResource: PerResourceSchema.optional(),
  })
  .strict()
  .refine((r) => [r.address, r.index, r.perResource].filter((x) => x !== undefined).length === 1, { message: M.payee })
  .refine((r) => r.perResource === undefined || isDynamic(r.route), {
    message: M.perResourceDynamic,
    path: ['perResource'],
  });

export const NotExportedSchema = z.object({ route: Route, reason: z.enum(NOT_EXPORTED_REASONS) }).strict();

export const ManifestSchema = z
  .object({
    $comment: z.string().optional(),
    manifestVersion: z.literal(1),
    routes: z.array(ManifestRouteSchema),
    notExported: z.array(NotExportedSchema).optional(),
  })
  .strict()
  .superRefine((m, ctx) => {
    if (!m.routes.length && !m.notExported?.length)
      ctx.addIssue({ code: 'custom', message: M.emptyManifest, path: ['routes'] });
    const seen = new Set<string>();
    m.routes.forEach((r, i) => {
      const key = `${r.route}|${r.tier ?? ''}|${r.scheme ?? 'exact'}|${r.network}|${r.asset.toLowerCase()}`;
      if (seen.has(key)) ctx.addIssue({ code: 'custom', message: M.routeTwice, path: ['routes', i, 'route'] });
      seen.add(key);
    });
  });

export type ManifestRoute = z.infer<typeof ManifestRouteSchema>;
export type Manifest = z.infer<typeof ManifestSchema>;
export type NotExported = z.infer<typeof NotExportedSchema>;

export const schemeOf = (r: ManifestRoute): Scheme => r.scheme ?? 'exact';

const OWN_MESSAGES = new Set<string>(Object.values(M));
const KNOWN_FIELDS = new Set<string>([
  ...['$comment', 'manifestVersion', 'routes', 'notExported', 'route', 'reason', 'tier', 'scheme', 'price'],
  ...['asset', 'network', 'address', 'index', 'perResource', 'baseIndex', 'firstId', 'lastId', '_note', 'payTo'],
]);
/** A path part is shown only if it is a number, a known field name or a valid route path. */
const safePart = (p: PropertyKey): string =>
  typeof p === 'number' ? String(p) : typeof p === 'string' && (KNOWN_FIELDS.has(p) || ROUTE.test(p)) ? p : '(key)';

/**
 * Turns schema issues into lines a seller can read: the field path and one of our own linted
 * messages. zod's built-in messages are replaced, and unknown field names are never shown.
 */
export function describeIssues(issues: z.ZodError['issues']): string[] {
  return issues.map((i) => {
    const where = i.path.length ? i.path.map(safePart).join('.') : M.topLevel;
    const message = OWN_MESSAGES.has(i.message)
      ? i.message
      : i.code === 'unrecognized_keys'
        ? M.unknownField
        : M.fieldInvalid;
    return `${where}: ${message}`;
  });
}
