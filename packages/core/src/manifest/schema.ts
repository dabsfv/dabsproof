// The route manifest: the seller's list of paid routes. It holds public payment terms only;
// there is no field for a key, an xpub or a mnemonic.
import { z } from 'zod';
import { MANIFEST_TEXT as M } from './messages.js';

const Address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, M.address);

export const ManifestRouteSchema = z
  .object({
    // A path, with no spaces or backticks, so it can be shown in a report as written.
    route: z.string().regex(/^\/[^\s`]*$/, M.route),
    // Whole number of the asset's smallest units.
    price: z.string().regex(/^\d+$/, M.price),
    asset: Address,
    network: z.string().regex(/^eip155:\d+$/, M.network),
    address: Address.optional(),
    index: z.number().int().min(0).optional(),
  })
  .strict()
  .refine((r) => (r.address === undefined) !== (r.index === undefined), {
    message: M.addressOrIndex,
  });

export const ManifestSchema = z
  .object({
    $comment: z.string().optional(),
    manifestVersion: z.literal(1),
    routes: z.array(ManifestRouteSchema).min(1),
  })
  .strict()
  .superRefine((m, ctx) => {
    const seen = new Set<string>();
    m.routes.forEach((r, i) => {
      if (seen.has(r.route)) ctx.addIssue({ code: 'custom', message: M.routeTwice, path: ['routes', i, 'route'] });
      seen.add(r.route);
    });
  });

export type ManifestRoute = z.infer<typeof ManifestRouteSchema>;
export type Manifest = z.infer<typeof ManifestSchema>;
