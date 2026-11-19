// @dabsproof/fixkit: runs in the seller's server. It takes an account-level xpub only, checks the
// payment address mapping with core's static analysis, and gives out only the addresses the
// mapping names. It never takes or keeps a private key, a mnemonic or a payment header.
export {
  type EnvFinding,
  type FindingKind,
  type GuardOptions,
  type GuardResult,
  guardEnvironment,
  XPUB_VARIABLE,
} from './guards/env.js';
export { isKeyMaterial, KEY_NAME, shapeOf } from './guards/shapes.js';
export { type MappingInput, type ValidateOptions, type Validation, validateMapping } from './mapping/validate.js';
export { FIXKIT_TEXT, FixkitError, type FixkitErrorCode, KEY_TYPE_LABEL, type KeyType } from './messages.js';
export {
  createPayToManager,
  type ManagerOptions,
  type PayToManager,
  type PayToRequest,
} from './payto/manager.js';
