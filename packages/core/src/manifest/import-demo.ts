// Reads the demo's route-config JSON format and turns it into a manifest. Written from the
// format's structure; nothing is copied. The demo's own note field is dropped.
import { z } from 'zod';
import { MANIFEST_TEXT as M } from './messages.js';
import { dollarsToUnits, isValidDecimals } from './price.js';
import {
  ADDRESS,
  describeIssues,
  EVM_NETWORK,
  type Manifest,
  type ManifestRoute,
  ManifestSchema,
  ROUTE,
} from './schema.js';

const Address = z.string().regex(ADDRESS, M.address);
const Dollars = z.string().regex(/^\$\d+(?:\.\d+)?$/, M.dollarPrice);
const Index = z.number().int().min(0);

const DemoEntrySchema = z
  .object({
    price: z.union([Dollars, z.record(z.string().regex(/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/, M.tier), Dollars)]),
    payTo: Address.optional(),
    index: Index.optional(),
    perResource: z.object({ baseIndex: Index }).strict().optional(),
  })
  .strict()
  .refine((e) => [e.payTo, e.index, e.perResource].filter((x) => x !== undefined).length === 1, { message: M.payee });

const DemoConfigSchema = z
  .object({
    _note: z.string().optional(),
    network: z.string().regex(EVM_NETWORK, M.network),
    asset: Address,
    routes: z.record(z.string().regex(ROUTE, M.route), DemoEntrySchema),
  })
  .strict();

export type ImportResult = { ok: true; manifest: Manifest } | { ok: false; issues: string[] };

export function importDemoConfig(json: unknown, options: { decimals: number }): ImportResult {
  if (!isValidDecimals(options?.decimals)) return { ok: false, issues: [`decimals: ${M.decimals}`] };
  const parsed = DemoConfigSchema.safeParse(json);
  if (!parsed.success) return { ok: false, issues: describeIssues(parsed.error.issues) };
  const { network, asset, routes } = parsed.data;
  const out: ManifestRoute[] = [];
  const issues: string[] = [];
  for (const [route, e] of Object.entries(routes)) {
    const prices: [string | undefined, string][] =
      typeof e.price === 'string'
        ? [[undefined, e.price]]
        : Object.entries(e.price).sort(([a], [b]) => a.localeCompare(b));
    for (const [tier, text] of prices) {
      const p = dollarsToUnits(text, options.decimals);
      if (!p.ok) {
        issues.push(
          `routes.${route}.price${tier ? `.${tier}` : ''}: ${p.reason === 'price-too-precise' ? M.tooPrecise : M.dollarPrice}`,
        );
        continue;
      }
      const entry: ManifestRoute = {
        route,
        ...(tier ? { tier } : {}),
        price: p.units,
        asset,
        network,
      } as ManifestRoute;
      if (e.payTo !== undefined) entry.address = e.payTo;
      else if (e.index !== undefined) entry.index = e.index;
      else if (e.perResource) entry.perResource = { baseIndex: e.perResource.baseIndex };
      out.push(entry);
    }
  }
  if (issues.length) return { ok: false, issues };
  out.sort((a, b) => a.route.localeCompare(b.route) || (a.tier ?? '').localeCompare(b.tier ?? ''));
  const checked = ManifestSchema.safeParse({ manifestVersion: 1, routes: out });
  return checked.success
    ? { ok: true, manifest: checked.data }
    : { ok: false, issues: describeIssues(checked.error.issues) };
}
