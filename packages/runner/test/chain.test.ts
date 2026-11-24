// Unit tests for the local chain's option checks and argument list. Nothing is started and nothing is
// sent: the binary path is only a string, and the fork URL is a made-up name on a .test domain, built
// at run time. These tests say nothing about anvil's own behaviour.
import { randomBytes, randomInt } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ANVIL_CHAIN_ID,
  buildAnvilArgs,
  CHAIN_REASONS,
  type ChainOptions,
  type ChainOptionsInput,
  type ChainReason,
  validateChainOptions,
} from '../src/index.js';

const tag = () => randomBytes(4).toString('hex');
const BINARY = `/fake-${tag()}/bin/anvil`;
const FORK = `https://rpc-${tag()}.example.test/`;
const BLOCK = randomInt(1, 1_000_000_000);
const PORT = randomInt(20_000, 60_000);
const base = (o: Partial<ChainOptionsInput> = {}): ChainOptionsInput => ({
  host: '127.0.0.1',
  port: PORT,
  chainId: ANVIL_CHAIN_ID,
  binaryPath: BINARY,
  ...o,
});
const fork = (o: Partial<ChainOptionsInput> = {}) =>
  base({ forkUrl: FORK, forkBlock: BLOCK, allowedForkUrls: [FORK], ...o });
const reasonOf = (input: ChainOptionsInput): ChainReason | 'ok' => {
  const r = validateChainOptions(input);
  return r.ok ? 'ok' : r.reason;
};
const optionsOf = (input: ChainOptionsInput): ChainOptions => {
  const r = validateChainOptions(input);
  if (!r.ok) throw new Error(r.reason);
  return r.options;
};
const FORBIDDEN = ['--state', '--dump-state', '--load-state', '--fund-accounts', '--auto-impersonate'];

describe('the local chain options (nothing is started)', () => {
  it('the chain id comes from the Base Sepolia network name', () => {
    expect(ANVIL_CHAIN_ID).toBe(84532);
  });
  it('accepts the no-fork options and returns them frozen', () => {
    const o = optionsOf(base());
    expect(o).toEqual({ host: '127.0.0.1', port: PORT, chainId: ANVIL_CHAIN_ID, binaryPath: BINARY, fork: null });
    expect(Object.isFrozen(o)).toBe(true);
  });
  it('refuses any host but the literal 127.0.0.1', () => {
    for (const host of ['localhost', '::1', '0.0.0.0', '127.0.0.2', ' 127.0.0.1', '', 127001, undefined]) {
      expect(reasonOf(base({ host }))).toBe('host-not-loopback-literal');
    }
  });
  it('refuses ports out of range or not whole, and refuses 4319', () => {
    for (const port of [0, 80, 1023, 65536, 1.5, -1, '18545', undefined, Number.NaN]) {
      expect(reasonOf(base({ port }))).toBe('port-invalid');
    }
    expect(reasonOf(base({ port: 4319 }))).toBe('port-reserved');
    expect(reasonOf(base({ port: 1024 }))).toBe('ok');
    expect(reasonOf(base({ port: 65535 }))).toBe('ok');
  });
  it('refuses any chain id but 84532', () => {
    for (const chainId of [1, 8453, 84531, '84532', undefined]) {
      expect(reasonOf(base({ chainId }))).toBe('chain-id-not-base-sepolia');
    }
  });
  it('refuses a missing, relative or dot-dot binary path', () => {
    for (const binaryPath of [undefined, '', 42, `/fake\0/anvil`]) {
      expect(reasonOf(base({ binaryPath }))).toBe('binary-path-missing');
    }
    for (const binaryPath of ['anvil', './anvil', 'bin/anvil', '~/anvil']) {
      expect(reasonOf(base({ binaryPath }))).toBe('binary-path-not-absolute');
    }
    for (const binaryPath of ['/fake/../anvil', '/fake/bin/..', '/../anvil']) {
      expect(reasonOf(base({ binaryPath }))).toBe('binary-path-has-dot-dot');
    }
  });
  it('accepts a fork only when its https URL is on the list and its block is pinned', () => {
    const o = optionsOf(fork());
    expect(o.fork).toEqual({ url: FORK, block: BLOCK });
    expect(Object.isFrozen(o.fork)).toBe(true);
  });
  it('refuses a fork URL that is not on the list (the list is empty by default)', () => {
    expect(reasonOf(base({ forkUrl: FORK, forkBlock: BLOCK }))).toBe('fork-url-not-allowed');
    expect(reasonOf(fork({ allowedForkUrls: [`https://other-${tag()}.example.test/`] }))).toBe('fork-url-not-allowed');
    // Matched exactly: a different path or a missing trailing slash is not the same entry.
    expect(reasonOf(fork({ forkUrl: `${FORK}x` }))).toBe('fork-url-not-allowed');
    expect(reasonOf(fork({ forkUrl: FORK.slice(0, -1) }))).toBe('fork-url-not-allowed');
  });
  it('refuses a fork URL that is not https, holds a user name or password, or has a query string', () => {
    const http = FORK.replace('https:', 'http:');
    expect(reasonOf(fork({ forkUrl: http, allowedForkUrls: [http] }))).toBe('fork-url-not-https');
    for (const userinfo of ['user@', 'user:pass@', ':pass@']) {
      const u = FORK.replace('https://', `https://${userinfo}`);
      expect(reasonOf(fork({ forkUrl: u, allowedForkUrls: [u] }))).toBe('fork-url-has-userinfo');
    }
    for (const q of ['?k=v', '?']) {
      const u = `${FORK}${q}`;
      expect(reasonOf(fork({ forkUrl: u, allowedForkUrls: [u] }))).toBe('fork-url-has-query');
    }
    for (const forkUrl of ['not a url', '', 42, null]) {
      expect(reasonOf(fork({ forkUrl }))).toBe('fork-url-invalid');
    }
  });
  it('a fork needs a whole block number above 0, and a block needs a fork', () => {
    for (const forkBlock of [undefined, null, 0, -1, 1.5, '100', Number.MAX_SAFE_INTEGER + 2]) {
      expect(reasonOf(fork({ forkBlock }))).toBe('fork-block-invalid');
    }
    // Only undefined means "not given": a null block without a fork is still a block without a fork.
    for (const forkBlock of [BLOCK, null]) {
      expect(reasonOf(base({ forkBlock }))).toBe('fork-block-without-fork-url');
    }
  });
  it('the allowed list must be a list of text', () => {
    for (const allowedForkUrls of ['https://x.example.test/', [42], null, {}]) {
      expect(reasonOf(base({ allowedForkUrls }))).toBe('allowed-fork-urls-invalid');
    }
  });
  it('every reason code is reachable and the list is fixed', () => {
    const seen = new Set<string>(
      [
        base({ host: 'localhost' }),
        base({ port: 80 }),
        base({ port: 4319 }),
        base({ chainId: 1 }),
        base({ binaryPath: '' }),
        base({ binaryPath: 'anvil' }),
        base({ binaryPath: '/a/../anvil' }),
        base({ allowedForkUrls: 'x' }),
        fork({ forkUrl: 'not a url' }),
        fork({ forkUrl: FORK.replace('https:', 'http:') }),
        fork({ forkUrl: FORK.replace('https://', 'https://u@') }),
        fork({ forkUrl: `${FORK}?k=v` }),
        base({ forkUrl: FORK, forkBlock: BLOCK }),
        fork({ forkBlock: 0 }),
        base({ forkBlock: BLOCK }),
      ].map(reasonOf),
    );
    expect([...seen].sort()).toEqual([...CHAIN_REASONS].sort());
  });
});

describe('the anvil argument list (returned only; nothing is started)', () => {
  it('no fork: host, port, chain id and no dev accounts, exactly', () => {
    expect(buildAnvilArgs(optionsOf(base()))).toEqual([
      '--host',
      '127.0.0.1',
      '--port',
      String(PORT),
      '--chain-id',
      '84532',
      '--accounts',
      '0',
    ]);
  });
  it('a validated fork adds only the fork URL and the pinned block', () => {
    expect(buildAnvilArgs(optionsOf(fork()))).toEqual([
      '--host',
      '127.0.0.1',
      '--port',
      String(PORT),
      '--chain-id',
      '84532',
      '--accounts',
      '0',
      '--fork-url',
      FORK,
      '--fork-block-number',
      String(BLOCK),
    ]);
  });
  it('no forbidden flag can appear, even when the input carries extra fields', () => {
    const extra = { state: '/x', dumpState: '/x', loadState: '/x', fundAccounts: ['a:1'], autoImpersonate: true };
    for (const input of [base(extra as Partial<ChainOptionsInput>), fork(extra as Partial<ChainOptionsInput>)]) {
      const args = buildAnvilArgs(optionsOf(input));
      const flags = args.filter((a) => a.startsWith('-'));
      for (const f of FORBIDDEN) expect(flags.includes(f)).toBe(false);
      for (const f of flags) {
        expect(['--host', '--port', '--chain-id', '--accounts', '--fork-url', '--fork-block-number']).toContain(f);
      }
    }
  });
  it('options that did not come from validateChainOptions are refused', () => {
    const copy = { ...optionsOf(base()) } as ChainOptions;
    expect(() => buildAnvilArgs(copy)).toThrow('chain-options-not-validated');
    const madeUp = {
      host: '127.0.0.1',
      port: 4319,
      chainId: 1,
      binaryPath: 'x',
      fork: null,
    } as unknown as ChainOptions;
    expect(() => buildAnvilArgs(madeUp)).toThrow('chain-options-not-validated');
  });
});
