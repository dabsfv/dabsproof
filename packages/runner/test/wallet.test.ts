// Unit tests for the wallet core. Every test uses its own temporary home folder, made under the
// operating system's temp folder and removed afterwards; the real home folder is never read, listed
// or written, and the command wrapper is never run. No key file's contents are ever printed.
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createWallets, parseArgs, WALLET_NETWORK, walletFolderParts } from '../src/wallet.js';

const homes: string[] = [];
afterEach(() => {
  for (const h of homes.splice(0)) {
    const folder = join(h, ...walletFolderParts());
    if (existsSync(folder)) chmodSync(folder, 0o700);
    rmSync(h, { recursive: true, force: true });
  }
});

/** A fresh temporary home folder (never the real one). */
function tempHome(): string {
  const h = realpathSync(mkdtempSync(join(tmpdir(), 'wallet-home-')));
  homes.push(h);
  return h;
}
const folderIn = (home: string) => join(home, ...walletFolderParts());
const modeOf = (path: string) => statSync(path).mode & 0o777;
/** Names only, recursively, inside one temporary home folder. */
const namesIn = (home: string) => (readdirSync(home, { recursive: true }) as string[]).map(String).sort();
const HEX64 = /(?<![0-9a-fA-F])[0-9a-fA-F]{64}(?![0-9a-fA-F])/;
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

describe('createWallets (throwaway testnet keys only)', () => {
  it('refuses without, or with a wrong, network and creates nothing', () => {
    const home = tempHome();
    expect(createWallets({ home, network: undefined })).toEqual({ ok: false, code: 'network-required' });
    expect(createWallets({ home, network: '' })).toEqual({ ok: false, code: 'network-required' });
    expect(createWallets({ home, network: 'eip155:8453' })).toEqual({ ok: false, code: 'network-not-allowed' });
    expect(createWallets({ home, network: 'base-sepolia' })).toEqual({ ok: false, code: 'network-not-allowed' });
    expect(namesIn(home)).toEqual([]);
  });
  it('creates buyer and relayer keys in a temporary home, modes 0600 and 0700, and returns only addresses', () => {
    const home = tempHome();
    const r = createWallets({ home, network: WALLET_NETWORK });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.wallets.map((w) => w.role)).toEqual(['buyer', 'relayer']);
    for (const w of r.wallets) expect(/^0x[0-9a-fA-F]{40}$/.test(w.address)).toBe(true);
    expect(r.wallets[0]?.address === r.wallets[1]?.address).toBe(false);
    expect(Object.keys(r).sort()).toEqual(['ok', 'wallets']);
    const folder = folderIn(home);
    expect(modeOf(folder)).toBe(0o700);
    for (const role of ['buyer', 'relayer']) expect(modeOf(join(folder, `${role}.key`))).toBe(0o600);
  });
  it('the address for private key 1 is the well-known one', () => {
    const home = tempHome();
    let n = 0;
    // Key 1 for the buyer and key 2 for the relayer, built at run time.
    const draw = (size: number) => {
      const b = Buffer.alloc(size);
      b[size - 1] = ++n;
      return b;
    };
    const r = createWallets({ home, network: WALLET_NETWORK, randomBytes: draw });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.wallets[0]).toEqual({ role: 'buyer', address: '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf' });
  });
  it('a second run refuses key-exists and leaves the files byte-identical', () => {
    const home = tempHome();
    expect(createWallets({ home, network: WALLET_NETWORK }).ok).toBe(true);
    const folder = folderIn(home);
    const before = ['buyer', 'relayer'].map((r) => readFileSync(join(folder, `${r}.key`)));
    expect(createWallets({ home, network: WALLET_NETWORK })).toEqual({ ok: false, code: 'key-exists' });
    const after = ['buyer', 'relayer'].map((r) => readFileSync(join(folder, `${r}.key`)));
    expect(before.every((b, i) => b.equals(after[i] as Buffer))).toBe(true);
  });
  it('an unset, relative or missing home gives home-invalid', () => {
    const home = tempHome();
    for (const h of [undefined, '', 'relative/home', join(home, 'missing'), 42]) {
      expect(createWallets({ home: h, network: WALLET_NETWORK })).toEqual({ ok: false, code: 'home-invalid' });
    }
    expect(namesIn(home)).toEqual([]);
  });
  it.skipIf(isRoot)('a read-only folder gives folder-not-writable (skipped when running as root)', () => {
    const home = tempHome();
    const folder = folderIn(home);
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    chmodSync(folder, 0o500);
    expect(createWallets({ home, network: WALLET_NETWORK })).toEqual({ ok: false, code: 'folder-not-writable' });
    chmodSync(folder, 0o700);
    expect(readdirSync(folder)).toEqual([]);
  });
  it('an existing folder with mode 0755 gives folder-too-open', () => {
    const home = tempHome();
    const folder = folderIn(home);
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    chmodSync(folder, 0o755);
    expect(createWallets({ home, network: WALLET_NETWORK })).toEqual({ ok: false, code: 'folder-too-open' });
    expect(readdirSync(folder)).toEqual([]);
  });
  it('no result or refusal holds a key, a 64-hex string, the temp path or the home text; key files have the right shape', () => {
    const home = tempHome();
    const results = [
      createWallets({ home, network: WALLET_NETWORK }),
      createWallets({ home, network: WALLET_NETWORK }),
      createWallets({ home: join(home, 'missing'), network: WALLET_NETWORK }),
      createWallets({ home, network: 'eip155:1' }),
    ];
    const text = JSON.stringify(results);
    expect(HEX64.test(text)).toBe(false);
    expect(text.includes(home)).toBe(false);
    expect(text.includes(tmpdir())).toBe(false);
    for (const role of ['buyer', 'relayer']) {
      const content = readFileSync(join(folderIn(home), `${role}.key`), 'utf8');
      expect(/^0x[0-9a-f]{64}\n$/.test(content)).toBe(true);
      expect(text.includes(content.slice(2, 66))).toBe(false);
    }
  });
  it('parseArgs accepts exactly --network <value>', () => {
    expect(parseArgs(['--network', 'eip155:84532'])).toEqual({ ok: true, network: 'eip155:84532' });
    for (const argv of [
      [],
      ['--network'],
      ['--network', 'eip155:84532', 'x'],
      ['--network=eip155:84532'],
      ['--net', 'x'],
      ['--network', '--x'],
      ['--network', ''],
    ]) {
      expect(parseArgs(argv)).toEqual({ ok: false, code: 'args-invalid' });
    }
  });
});
