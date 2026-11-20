// Helpers for the demo routes: the mapping entry from the fix kit manager's checked manifest, and the
// item id text. Pure: no imports, no environment, no logging.

/** The entry with this route and tier (no tier for an untiered route), scheme exact or not given. Exactly one, else null. */
export function entryFor(manifest, route, tier) {
  const found = (manifest?.routes ?? []).filter(
    (r) => r.route === route && r.tier === tier && (r.scheme ?? 'exact') === 'exact',
  );
  return found.length === 1 ? found[0] : null;
}

const ID_TEXT = /^[0-9]{1,10}$/;

/** { ok: true, id } only for one to ten ASCII digits, else { ok: false, code: 'bad-item-id' }. A refusal never carries the input. */
export function idText(value) {
  return typeof value === 'string' && ID_TEXT.test(value)
    ? { ok: true, id: value }
    : { ok: false, code: 'bad-item-id' };
}
