// The environment guard. It reads the running server's environment only (not .env files, and not
// what Next.js already copied into browser files at build time) and reports variables by name and
// type, never by value.
//
// Refuses: key material or an xpub in a NEXT_PUBLIC_ variable; the fix kit's own setting holding
// anything but an account-level xpub. Reports (refusing only with strict): key-shaped values in
// other server variables, and names that suggest key material. allowNames excuses exact names set
// by the seller, each printed by name; it can never excuse the fix kit's own setting.
import { brand } from '@dabsproof/brand';
import { EvmInputError, parseAccountXpub } from '@dabsproof/evm';
import { KEY_TYPE_LABEL, type KeyType, FIXKIT_TEXT as T } from '../messages.js';
import { isKeyMaterial, KEY_NAME, shapeOf } from './shapes.js';

/** The fix kit's own setting: the account-level xpub. */
export const XPUB_VARIABLE = `${brand.slug.toUpperCase()}_PAYTO_XPUB`;

export type FindingKind = 'public-key-shaped' | 'public-xpub' | 'own-setting' | 'key-shaped' | 'key-name';

export interface EnvFinding {
  name: string;
  kind: FindingKind;
  type: KeyType | null;
  /** Whether this finding refuses on its own (before strict is applied). */
  refuses: boolean;
}

export interface GuardOptions {
  /** Exact variable names to skip. Never excuses the fix kit's own setting. */
  allowNames?: readonly string[];
  /** Also refuse on key-shaped server variables and key-like names. */
  strict?: boolean;
}

export interface GuardResult {
  refuse: boolean;
  findings: EnvFinding[];
  /** Names skipped because they were in allowNames. */
  allowed: string[];
  /** Printable lines: fixed sentences, names and type labels only. */
  lines: string[];
}

const label = (t: KeyType | null): string => (t ? KEY_TYPE_LABEL[t] : '');

export function guardEnvironment(
  env: Readonly<Record<string, string | undefined>> = process.env,
  options: GuardOptions = {},
): GuardResult {
  const allow = new Set(options.allowNames ?? []);
  const findings: EnvFinding[] = [];
  const allowed: string[] = [];
  let ownMessage: string | null = null;
  for (const name of Object.keys(env).sort()) {
    const value = env[name];
    if (name === XPUB_VARIABLE) {
      if (value === undefined || value === '') continue;
      try {
        parseAccountXpub(value);
      } catch (e) {
        ownMessage = e instanceof EvmInputError ? e.message : null;
        findings.push({ name, kind: 'own-setting', type: shapeOf(value), refuses: true });
      }
      continue;
    }
    if (allow.has(name)) {
      allowed.push(name);
      continue;
    }
    const type = shapeOf(value);
    if (name.startsWith('NEXT_PUBLIC_') && type === 'extended-public-key') {
      findings.push({ name, kind: 'public-xpub', type, refuses: true });
    } else if (name.startsWith('NEXT_PUBLIC_') && isKeyMaterial(type)) {
      findings.push({ name, kind: 'public-key-shaped', type, refuses: true });
    } else if (isKeyMaterial(type)) {
      findings.push({ name, kind: 'key-shaped', type, refuses: false });
    } else if (KEY_NAME.test(name)) {
      findings.push({ name, kind: 'key-name', type: null, refuses: false });
    }
  }
  const strict = options.strict === true;
  const refuse = findings.some((f) => f.refuses || strict);
  const lines: string[] = [];
  const group = (kind: FindingKind, sentence: string, withType: boolean) => {
    const list = findings.filter((f) => f.kind === kind);
    if (!list.length) return;
    lines.push(sentence);
    for (const f of list) lines.push(withType && f.type ? `  ${f.name}: ${label(f.type)}` : `  ${f.name}`);
  };
  group('public-key-shaped', T.envPublicKeyShaped, true);
  group('public-xpub', T.envPublicXpub, false);
  const own = findings.find((f) => f.kind === 'own-setting');
  if (own) {
    if (isKeyMaterial(own.type)) {
      lines.push(T.envKeyShaped, `  ${own.name}: ${label(own.type)}`);
    } else if (ownMessage) {
      lines.push(`${own.name}: ${ownMessage}`);
    }
  }
  group('key-shaped', T.envKeyShaped, true);
  group('key-name', T.envKeyName, false);
  if (allowed.length) lines.push(`${T.allowNamesLabel}: ${allowed.join(', ')}`);
  return { refuse, findings, allowed, lines };
}
