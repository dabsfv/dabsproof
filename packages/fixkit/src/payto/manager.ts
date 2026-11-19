// The payment address manager. It takes an account-level xpub only, always validates the mapping
// first (there is no way to skip that), refuses networks and assets that are not on evm's
// allow-list, and gives out only the addresses the mapping names: no shared or default address,
// ever. It prints as a fixed label, so the xpub cannot reach a log by accident.

import { inspect } from 'node:util';
import { MAX_INDEX, type Manifest, type ManifestRoute } from '@dabsproof/core';
import {
  type AccountKey,
  allowedAsset,
  deriveAddress,
  isAllowedNetwork,
  parseAccountXpub,
  toChecksumAddress,
} from '@dabsproof/evm';
import { type MappingInput, type ValidateOptions, type Validation, validateMapping } from '../mapping/validate.js';
import { FixkitError, FIXKIT_TEXT as T } from '../messages.js';

const LABEL = '[PayToManager]';

export interface PayToRequest {
  /** The route as written in the mapping, for example /api/item/[id]. */
  route: string;
  tier?: string;
  scheme?: 'exact' | 'upto';
  /** The item number, for routes that give each item its own address. */
  id?: number | string;
}

export interface ManagerOptions extends ValidateOptions {
  mapping: MappingInput | string;
  /** The account-level xpub. Needed only when the mapping uses address indexes. */
  xpub?: string;
}

const keyOf = (route: string, tier: string | undefined, scheme: string | undefined): string =>
  `${route}\n${tier ?? ''}\n${scheme ?? 'exact'}`;

export class PayToManager {
  readonly validation: Validation;
  #account: AccountKey | null;
  #routes: Map<string, ManifestRoute>;
  /** Route and scheme pairs that have tiers in the mapping. */
  #tiered: Set<string>;
  #cache = new Map<number, string>();

  /** Use createPayToManager(). */
  constructor(validation: Validation & { manifest: Manifest }, account: AccountKey | null) {
    this.validation = validation;
    this.#account = account;
    this.#routes = new Map(validation.manifest.routes.map((r) => [keyOf(r.route, r.tier, r.scheme), r]));
    this.#tiered = new Set(
      validation.manifest.routes.filter((r) => r.tier !== undefined).map((r) => keyOf(r.route, undefined, r.scheme)),
    );
  }

  #derive(index: number): string {
    const hit = this.#cache.get(index);
    if (hit) return hit;
    if (!this.#account) throw new FixkitError('xpub-refused', T.fallbackRefused);
    const address = deriveAddress(this.#account, index);
    this.#cache.set(index, address);
    return address;
  }

  /** The address for one route (and item). Refuses anything the mapping does not name. */
  payToFor(request: PayToRequest): string {
    const r = this.#routes.get(keyOf(request.route, request.tier, request.scheme));
    if (!r) {
      if (this.#tiered.has(keyOf(request.route, undefined, request.scheme))) {
        throw new FixkitError('tier-not-given', T.tierNotGiven);
      }
      throw new FixkitError('unknown-route', T.unknownRoute);
    }
    if (r.address !== undefined) return toChecksumAddress(r.address);
    if (r.index !== undefined) return this.#derive(r.index);
    const p = r.perResource;
    if (!p) throw new FixkitError('unknown-route', T.unknownRoute);
    const id = typeof request.id === 'string' && /^\d{1,10}$/.test(request.id) ? Number(request.id) : request.id;
    if (typeof id !== 'number' || !Number.isInteger(id)) throw new FixkitError('item-not-given', T.itemNotGiven);
    if (id < 0) throw new FixkitError('id-out-of-range', T.idOutOfRange);
    if (p.firstId !== undefined && p.lastId !== undefined && (id < p.firstId || id > p.lastId)) {
      throw new FixkitError('id-out-of-range', T.idOutOfRange);
    }
    if (p.baseIndex + id > MAX_INDEX) throw new FixkitError('id-out-of-range', T.idOutOfRange);
    return this.#derive(p.baseIndex + id);
  }

  toJSON(): string {
    return LABEL;
  }
  toString(): string {
    return LABEL;
  }
  [inspect.custom](): string {
    return LABEL;
  }
}

/**
 * Validates the mapping (core's checks only), then refuses a network or asset not on the
 * allow-list, then reads the xpub. Throws FixkitError (or evm's EvmInputError for the xpub);
 * the error carries the report text when the mapping itself was refused.
 */
export function createPayToManager(options: ManagerOptions): PayToManager {
  const { mapping, xpub, ...validateOptions } = options;
  const validation = validateMapping(mapping, validateOptions);
  if (validation.decision === 'refuse' || validation.manifest === null) {
    throw Object.assign(new FixkitError('mapping-refused', T.mappingRefused), { report: validation.text });
  }
  for (const r of validation.manifest.routes) {
    if (!isAllowedNetwork(r.network)) throw new FixkitError('network-refused', T.networkRefused);
  }
  for (const r of validation.manifest.routes) {
    try {
      allowedAsset(r.network, r.asset);
    } catch {
      throw new FixkitError('asset-refused', T.assetRefused);
    }
  }
  const needsXpub = validation.manifest.routes.some((r) => r.address === undefined);
  const account = needsXpub ? parseAccountXpub(typeof xpub === 'string' ? xpub : '') : null;
  return new PayToManager(validation as Validation & { manifest: Manifest }, account);
}
