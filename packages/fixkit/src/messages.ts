// Every sentence the fix kit can show. pnpm lint:wording checks them all. No message, code or
// error here ever carries a variable's value, a key, an xpub or a payment header.
export const FIXKIT_TEXT = Object.freeze({
  mappingRefused:
    'The payment address mapping has a problem, so no payment address was given out. The report below lists it.',
  mappingUnverified:
    'Part of the payment address mapping could not be verified. The report below lists what was not checked.',
  envKeyShaped: 'A server variable looks like key material. Only its name and type are shown.',
  envPublicKeyShaped:
    "A variable whose name starts with NEXT_PUBLIC_ looks like key material. Next.js can copy these variables into browser code when the app is built, so the value may already be in files sent to browsers. This check reads only the running server's environment. Only the variable's name and type are shown.",
  envPublicXpub:
    "A variable whose name starts with NEXT_PUBLIC_ looks like an extended public key. On its own it cannot move funds, but anyone who has it can find every address made from it and see their balances. Next.js can copy these variables into browser code when the app is built. Only the variable's name is shown.",
  networkRefused:
    'The mapping names a network other than Base Sepolia (eip155:84532). This version supports Base Sepolia only.',
  unknownRoute: 'This route is not in the payment address mapping, so no payment address was given out.',
  idOutOfRange: 'This item number is outside the range set for the route, so no payment address was given out.',
  startupSkipped:
    'The start-up check cannot run in the Edge runtime, so no payment address is given out here. Use the Node.js runtime for routes that give out payment addresses.',
  startupStopped:
    'The start-up check found a problem in the payment address mapping. No payment address will be given out until it is fixed. The report below lists it.',
  fallbackRefused: 'The start-up check did not pass, so no payment address was given out.',
  assetRefused: 'The mapping names an asset that is not on the allow-list for Base Sepolia.',
  envKeyName: 'A server variable has a name that suggests key material. Only its name is shown.',
  tierNotGiven:
    'This route has tiers, and the request did not name one that is in the mapping, so no payment address was given out.',
  itemNotGiven:
    'This route needs a whole item number, and the request did not give one, so no payment address was given out.',
  notConfigured: 'No payment address mapping has been set up, so no payment address was given out.',
  checkNotRun: 'The start-up check could not run here, so no payment address was given out.',
  /** Label before the names a seller excused with the allowNames option. */
  allowNamesLabel: 'allowNames',
});

/** Type labels for key-shaped values (sentence k). Shown beside a variable's name, never with its value. */
export const KEY_TYPE_LABEL = Object.freeze({
  'private-key': 'private key',
  'extended-private-key': 'extended private key',
  'mnemonic-like': 'mnemonic-like phrase',
  'pem-private-key': 'PEM private key',
  'extended-public-key': 'extended public key',
});
export type KeyType = keyof typeof KEY_TYPE_LABEL;

export type FixkitErrorCode =
  | 'mapping-refused'
  | 'mapping-invalid'
  | 'network-refused'
  | 'asset-refused'
  | 'xpub-refused'
  | 'environment-refused'
  | 'unknown-route'
  | 'tier-not-given'
  | 'item-not-given'
  | 'id-out-of-range'
  | 'edge-runtime'
  | 'runtime-refused'
  | 'not-configured'
  | 'check-not-run'
  | 'start-up-refused';

/**
 * The only error the fix kit throws. Its message is a fixed sentence; it never has a cause and
 * never carries an input value.
 */
export class FixkitError extends Error {
  readonly code: FixkitErrorCode;
  constructor(code: FixkitErrorCode, message: string) {
    super(message);
    this.name = 'FixkitError';
    this.code = code;
  }
}
