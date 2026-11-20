// Test helpers. Fakes are made at run time from random bytes. Expected addresses come from evm's
// SOURCE and expected codes, messages and log lines from the fix kit's SOURCE, both run here by
// vitest: not the bundled build the server runs.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ALLOWED_NETWORKS, BASE_SEPOLIA, deriveAddress, parseAccountXpub } from '../../../packages/evm/src/index.ts';
import { testRoot } from '../../../packages/evm/test/helpers.ts';
import { createPayToManager } from '../../../packages/fixkit/src/index.ts';
import { getPayToManager, registerPayTo, resetPayToState } from '../../../packages/fixkit/src/next/index.ts';

export { FIXKIT_TEXT, KEY_TYPE_LABEL, XPUB_VARIABLE } from '../../../packages/fixkit/src/index.ts';

const account = testRoot().derive("m/44'/60'/0'");
export const TEST_XPUB = account.publicExtendedKey;
/** Only to prove it never appears. Never given to the server. */
export const TEST_XPRV = account.privateExtendedKey;

const parsed = parseAccountXpub(TEST_XPUB);
/** The address at an index, from evm's source. */
export const expectedAt = (index) => deriveAddress(parsed, index);

export const fake64Hex = () => randomBytes(32).toString('hex');
export const fakeServerKey = () => `0x${randomBytes(32).toString('hex')}`;

const USDC = ALLOWED_NETWORKS[BASE_SEPOLIA].assets[0].address;
export function allowListedFixture(name) {
  const m = JSON.parse(readFileSync(new URL(`../../../fixtures/manifests/${name}.json`, import.meta.url), 'utf8'));
  for (const r of m.routes) r.asset = USDC;
  return m;
}

/** The fix kit's own refusal for a call: its code and message, or null if it did not refuse. */
export function refusalFrom(fn) {
  try {
    fn();
  } catch (e) {
    return { code: e.code, message: e.message };
  }
  return null;
}

/** What the fix kit's source answers for a request to the app's mapping. */
export function managerRefusal(mappingFile, request) {
  const manager = createPayToManager({ mapping: mappingFile, xpub: TEST_XPUB });
  return refusalFrom(() => manager.payToFor(request));
}

/**
 * What the fix kit's source does for a start-up with this environment and mapping, then a route
 * call: the lines it logs and the refusal the route gets. register: false skips start-up (the
 * fallback runs the checks); options: false calls the route with no options.
 */
export function startUpFromSource(env, mapping, { register = true, options = true } = {}) {
  const lines = [];
  const opts = { mapping, env: { NEXT_RUNTIME: 'nodejs', ...env }, log: (l) => lines.push(l) };
  resetPayToState();
  if (register) registerPayTo(opts);
  const refusal = refusalFrom(() => (options ? getPayToManager(opts) : getPayToManager()));
  resetPayToState();
  return { lines, refusal };
}

/** True if the text shows the value: any 8 characters in a row, in any letter case. */
export function shows(text, value) {
  const t = text.toLowerCase();
  const v = value.toLowerCase().replace(/^0x/, '');
  for (let i = 0; i + 8 <= v.length; i++) if (t.includes(v.slice(i, i + 8))) return true;
  return false;
}
