// Throwaway testnet keys for the runner: one buyer key and one relayer key, for Base Sepolia
// (eip155:84532) only. The real creation is run by the person themselves, in their own Terminal;
// tests use a temporary HOME. Nothing here signs, funds or sends anything, and nothing is claimed
// about the keys beyond this: each is made from random bytes from node:crypto. A key is never
// returned, printed or logged, and an existing key is never overwritten or deleted. The core takes
// the home folder as a parameter and never reads the environment or the real home folder.
import { createECDH, randomBytes as nodeRandomBytes } from 'node:crypto';
import { accessSync, closeSync, constants, existsSync, mkdirSync, openSync, statSync, writeSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { brand } from '@dabsproof/brand';
import { publicKeyToAddress } from '@dabsproof/evm';

export const WALLET_NETWORK = 'eip155:84532';
export const WALLET_ROLES = ['buyer', 'relayer'] as const;
export type WalletRole = (typeof WALLET_ROLES)[number];

export type WalletCode =
  | 'network-required'
  | 'network-not-allowed'
  | 'home-invalid'
  | 'folder-too-open'
  | 'folder-not-writable'
  | 'key-exists'
  | 'permissions-wrong'
  | 'key-generation-failed'
  | 'write-failed';

export interface WalletOptions {
  home: unknown;
  network: unknown;
  /** For tests only. Defaults to node:crypto's randomBytes. */
  randomBytes?: (size: number) => Uint8Array;
}

export type WalletResult =
  | { ok: true; wallets: { role: WalletRole; address: string }[] }
  | { ok: false; code: WalletCode; written?: WalletRole[] };

const MAX_DRAWS = 8;

/** The folder below the home folder, as parts: the config folder, the product slug, wallets, the network. */
export function walletFolderParts(): string[] {
  return ['.config', brand.slug, 'wallets', WALLET_NETWORK.replace(':', '-')];
}

/** Exactly ['--network', <value>] is accepted; anything else is args-invalid. The value is checked by createWallets. */
export function parseArgs(
  argv: readonly string[],
): { ok: true; network: string } | { ok: false; code: 'args-invalid' } {
  if (argv.length !== 2 || argv[0] !== '--network') return { ok: false, code: 'args-invalid' };
  const value = argv[1];
  if (typeof value !== 'string' || value === '' || value.startsWith('-')) return { ok: false, code: 'args-invalid' };
  return { ok: true, network: value };
}

const modeOf = (path: string): number => statSync(path).mode & 0o777;

/** One secp256k1 key from random bytes: up to MAX_DRAWS draws, rejecting bytes that are not a valid key. */
function generate(draw: (size: number) => Uint8Array): { secret: Buffer; address: string } | null {
  for (let i = 0; i < MAX_DRAWS; i++) {
    const secret = Buffer.from(draw(32));
    if (secret.length !== 32) {
      secret.fill(0);
      continue;
    }
    try {
      const ecdh = createECDH('secp256k1');
      ecdh.setPrivateKey(secret);
      return { secret, address: publicKeyToAddress(ecdh.getPublicKey(null, 'compressed')) };
    } catch {
      // Not a valid key for the curve (for example all zeros): draw again.
      secret.fill(0);
    }
  }
  return null;
}

export function createWallets(options: WalletOptions): WalletResult {
  const { home, network } = options;
  if (network === undefined || network === null || network === '') return { ok: false, code: 'network-required' };
  if (network !== WALLET_NETWORK) return { ok: false, code: 'network-not-allowed' };

  if (typeof home !== 'string' || !isAbsolute(home)) return { ok: false, code: 'home-invalid' };
  try {
    if (!statSync(home).isDirectory()) return { ok: false, code: 'home-invalid' };
  } catch {
    return { ok: false, code: 'home-invalid' };
  }

  const folder = join(home, ...walletFolderParts());
  try {
    if (!existsSync(folder)) mkdirSync(folder, { recursive: true, mode: 0o700 });
  } catch {
    return { ok: false, code: 'folder-not-writable' };
  }
  try {
    accessSync(folder, constants.W_OK);
  } catch {
    return { ok: false, code: 'folder-not-writable' };
  }
  if (modeOf(folder) !== 0o700) return { ok: false, code: 'folder-too-open' };

  const files = WALLET_ROLES.map((role) => ({ role, file: join(folder, `${role}.key`) }));
  // Both are checked before either is written, so a refusal writes nothing.
  if (files.some((f) => existsSync(f.file))) return { ok: false, code: 'key-exists' };

  // Both keys are made before either is written, so a generation failure writes nothing.
  const draw = options.randomBytes ?? nodeRandomBytes;
  const keys: { role: WalletRole; file: string; secret: Buffer; address: string }[] = [];
  for (const f of files) {
    const k = generate(draw);
    if (k === null) {
      for (const done of keys) done.secret.fill(0);
      return { ok: false, code: 'key-generation-failed' };
    }
    keys.push({ ...f, ...k });
  }

  const written: WalletRole[] = [];
  try {
    for (const k of keys) {
      let fd: number;
      try {
        fd = openSync(k.file, 'wx', 0o600);
      } catch (e) {
        const exists = (e as NodeJS.ErrnoException).code === 'EEXIST';
        return exists
          ? { ok: false, code: 'key-exists', written: [...written] }
          : { ok: false, code: 'write-failed', written: [...written] };
      }
      try {
        writeSync(fd, `0x${k.secret.toString('hex')}\n`);
      } catch {
        return { ok: false, code: 'write-failed', written: [...written] };
      } finally {
        closeSync(fd);
      }
      written.push(k.role);
      // Nothing is ever deleted: a file whose mode is not 0600 is reported, by role, and left in place.
      if (modeOf(k.file) !== 0o600) return { ok: false, code: 'permissions-wrong', written: [...written] };
    }
  } finally {
    // Best effort only: the key buffers are zeroed, but copies made by the hex string, the curve
    // object or the operating system cannot be cleared from here.
    for (const k of keys) k.secret.fill(0);
  }
  return { ok: true, wallets: keys.map((k) => ({ role: k.role, address: k.address })) };
}
