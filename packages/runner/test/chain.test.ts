// Unit tests for the local chain's option checks and argument list. Nothing is started, nothing is
// sent and no file is touched: the binary path and every state path are only strings built at run
// time, and the fork URL is a made-up name on a .test domain. The state-path checks look at text only;
// where a path really leads could not be verified here. These tests say nothing about anvil itself.
import { randomBytes, randomInt } from 'node:crypto';
import { brand } from '@dabsproof/brand';
import { describe, expect, it } from 'vitest';
import { FORK_LIMIT_ARGS } from '../src/chain.js';
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
/** The product's config folder name, from the brand package (the last part of configDir), not written here. */
const CONFIG_FOLDER = brand.configDir.split('/').pop() ?? '';
const BINARY = `/fake-${tag()}/bin/anvil`;
const FORK = `https://rpc-${tag()}.example.test/`;
const BLOCK = randomInt(1, 1_000_000_000);
const PORT = randomInt(20_000, 60_000);
// Made-up folders: a repo and a state folder side by side, never created.
const ROOT = `/fake-${tag()}`;
const REPO = `${ROOT}/repo`;
const STATE = `${ROOT}/state`;
const DUMP = `${STATE}/base-sepolia-${BLOCK}.anvil-state.json`;
const LOAD = `${STATE}/saved-${tag()}.json`;
const base = (o: Partial<ChainOptionsInput> = {}): ChainOptionsInput => ({
  host: '127.0.0.1',
  port: PORT,
  chainId: ANVIL_CHAIN_ID,
  binaryPath: BINARY,
  ...o,
});
const fork = (o: Partial<ChainOptionsInput> = {}) =>
  base({ forkUrl: FORK, forkBlock: BLOCK, allowedForkUrls: [FORK], ...o });
/** The one fork run that writes its state, with every state input given. */
const dumpRun = (o: Partial<ChainOptionsInput> = {}) =>
  fork({ stateDir: STATE, repoRoot: REPO, dumpStatePath: DUMP, ...o });
/** An offline start from a saved state, with every state input given. */
const loadRun = (o: Partial<ChainOptionsInput> = {}) =>
  base({ stateDir: STATE, repoRoot: REPO, loadStatePath: LOAD, ...o });
const reasonOf = (input: ChainOptionsInput): ChainReason | 'ok' => {
  const r = validateChainOptions(input);
  return r.ok ? 'ok' : r.reason;
};
const optionsOf = (input: ChainOptionsInput): ChainOptions => {
  const r = validateChainOptions(input);
  if (!r.ok) throw new Error(r.reason);
  return r.options;
};
const BASE_ARGS = () => ['--host', '127.0.0.1', '--port', String(PORT), '--chain-id', '84532', '--accounts', '0'];
/** Written out in full, not taken from the constant, so that the order is checked as text. */
const FORK_ARGS = () => [
  '--fork-url',
  FORK,
  '--fork-block-number',
  String(BLOCK),
  '--no-fork-node-info',
  '--no-storage-caching',
  '--retries',
  '0',
  '--timeout',
  '10000',
  '--fork-header',
  'User-Agent: repo-check',
];
const FORK_LIMIT_FLAGS = ['--no-storage-caching', '--retries', '--timeout', '--fork-header'];
/** Never produced, whatever the input. */
const NEVER = [
  '--state',
  '--fund-accounts',
  '--auto-impersonate',
  '--compute-units-per-second',
  '--no-rate-limit',
  '--no-rpc-rate-limit',
];

describe('the local chain options (nothing is started)', () => {
  it('the chain id comes from the Base Sepolia network name', () => {
    expect(ANVIL_CHAIN_ID).toBe(84532);
  });
  it('accepts the no-fork options and returns them frozen', () => {
    const o = optionsOf(base());
    expect(o).toEqual({
      host: '127.0.0.1',
      port: PORT,
      chainId: ANVIL_CHAIN_ID,
      binaryPath: BINARY,
      fork: null,
      dumpStatePath: null,
      loadStatePath: null,
    });
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
        dumpRun({ loadStatePath: LOAD }),
        dumpRun({ stateDir: 'state' }),
        dumpRun({ repoRoot: 'repo' }),
        dumpRun({ stateDir: undefined }),
        dumpRun({ repoRoot: undefined }),
        dumpRun({ stateDir: `${REPO}/state`, dumpStatePath: `${REPO}/state/x.json` }),
        dumpRun({ dumpStatePath: 'x.json' }),
        loadRun({ loadStatePath: 'x.json' }),
        dumpRun({ dumpStatePath: `${STATE}/.config/${CONFIG_FOLDER}/x.json` }),
        dumpRun({ dumpStatePath: `${ROOT}/other/x.json` }),
        dumpRun({ dumpStatePath: `${STATE}/x.txt` }),
        dumpRun({ dumpStatePath: `${STATE}/.env.json` }),
        base({ stateDir: STATE, repoRoot: REPO, dumpStatePath: DUMP }),
        loadRun({ forkUrl: FORK, forkBlock: BLOCK, allowedForkUrls: [FORK] }),
      ].map(reasonOf),
    );
    expect([...seen].sort()).toEqual([...CHAIN_REASONS].sort());
  });
});

describe('the saved chain state (paths are text only; nothing is read or written)', () => {
  it('accepts the one fork run writing its state, and an offline start from a saved state', () => {
    const d = optionsOf(dumpRun());
    expect(d.dumpStatePath).toBe(DUMP);
    expect(d.loadStatePath).toBe(null);
    const l = optionsOf(loadRun());
    expect(l.loadStatePath).toBe(LOAD);
    expect(l.dumpStatePath).toBe(null);
    expect(l.fork).toBe(null);
  });
  it('only undefined means not given: null for each state input is refused with its own reason', () => {
    expect(reasonOf(dumpRun({ stateDir: null }))).toBe('state-dir-invalid');
    expect(reasonOf(dumpRun({ repoRoot: null }))).toBe('repo-root-invalid');
    expect(reasonOf(fork({ stateDir: STATE, repoRoot: REPO, dumpStatePath: null }))).toBe('dump-state-path-invalid');
    expect(reasonOf(base({ stateDir: STATE, repoRoot: REPO, loadStatePath: null }))).toBe('load-state-path-invalid');
    // A state folder and repo folder given alone are still checked.
    expect(reasonOf(base({ stateDir: null }))).toBe('state-dir-invalid');
    expect(reasonOf(base({ repoRoot: null }))).toBe('repo-root-invalid');
    expect(reasonOf(base({ stateDir: STATE, repoRoot: REPO }))).toBe('ok');
  });
  it('the state folder and the repo folder must be plain absolute paths', () => {
    for (const bad of [
      'state',
      './state',
      `${ROOT}/a/../state`,
      `${ROOT}/./state`,
      `${ROOT}//state`,
      `${STATE}/`,
      '',
      42,
      '/',
      `${ROOT}\\state`,
    ]) {
      expect(reasonOf(dumpRun({ stateDir: bad }))).toBe('state-dir-invalid');
      expect(reasonOf(dumpRun({ repoRoot: bad }))).toBe('repo-root-invalid');
    }
  });
  it('a state path needs both the state folder and the repo folder', () => {
    expect(reasonOf(dumpRun({ stateDir: undefined }))).toBe('state-dir-missing');
    expect(reasonOf(dumpRun({ repoRoot: undefined }))).toBe('repo-root-missing');
    expect(reasonOf(loadRun({ stateDir: undefined }))).toBe('state-dir-missing');
    expect(reasonOf(loadRun({ repoRoot: undefined }))).toBe('repo-root-missing');
  });
  it('the state folder must lie outside the repo folder: not the same, not inside it, not holding it', () => {
    expect(reasonOf(dumpRun({ stateDir: REPO, dumpStatePath: `${REPO}/x.json` }))).toBe('state-dir-overlaps-repo');
    expect(reasonOf(dumpRun({ stateDir: `${REPO}/state`, dumpStatePath: `${REPO}/state/x.json` }))).toBe(
      'state-dir-overlaps-repo',
    );
    expect(reasonOf(dumpRun({ stateDir: ROOT, dumpStatePath: `${ROOT}/x.json` }))).toBe('state-dir-overlaps-repo');
    // Compared ignoring case, since the disk may fold case (could not verify which it does).
    expect(
      reasonOf(
        dumpRun({ stateDir: `${REPO.toUpperCase()}/state`, dumpStatePath: `${REPO.toUpperCase()}/state/x.json` }),
      ),
    ).toBe('state-dir-overlaps-repo');
    // A sibling whose name starts with the repo's name is outside it.
    expect(reasonOf(dumpRun({ stateDir: `${REPO}-state`, dumpStatePath: `${REPO}-state/x.json` }))).toBe('ok');
  });
  it('a state path must be a plain absolute path', () => {
    for (const bad of [
      'x.json',
      './x.json',
      `${STATE}/../x.json`,
      `${STATE}/./x.json`,
      `${STATE}//x.json`,
      `${STATE}/x.json/`,
      '',
      42,
    ]) {
      expect(reasonOf(dumpRun({ dumpStatePath: bad }))).toBe('dump-state-path-invalid');
      expect(reasonOf(loadRun({ loadStatePath: bad }))).toBe('load-state-path-invalid');
    }
  });
  it('a state path must lie inside the state folder, and a sibling with the same prefix is outside', () => {
    for (const p of [`${ROOT}/other/x.json`, `${STATE}-other/x.json`, `${STATE}.json`, `${REPO}/x.json`, STATE]) {
      expect(reasonOf(dumpRun({ dumpStatePath: p }))).toBe('state-path-outside-state-dir');
      expect(reasonOf(loadRun({ loadStatePath: p }))).toBe('state-path-outside-state-dir');
    }
  });
  it('a state path must end in .json and its name must not start with .env', () => {
    for (const p of [`${STATE}/x.txt`, `${STATE}/x.json.bak`, `${STATE}/.json`, `${STATE}/x`]) {
      expect(reasonOf(dumpRun({ dumpStatePath: p }))).toBe('state-path-not-json');
    }
    for (const p of [`${STATE}/.env.json`, `${STATE}/.env-state.json`, `${STATE}/.ENV.json`]) {
      expect(reasonOf(dumpRun({ dumpStatePath: p }))).toBe('state-path-env-name');
      expect(reasonOf(loadRun({ loadStatePath: p }))).toBe('state-path-env-name');
    }
  });
  it("a state path holding a .config segment followed by the product's config folder name is refused", () => {
    expect(CONFIG_FOLDER.length > 0).toBe(true);
    expect(reasonOf(dumpRun({ dumpStatePath: `${STATE}/.config/${CONFIG_FOLDER}/x.json` }))).toBe(
      'state-path-in-config-dir',
    );
    const inConfig = `${ROOT}/home/.config/${CONFIG_FOLDER}`;
    expect(reasonOf(dumpRun({ stateDir: inConfig, dumpStatePath: `${inConfig}/x.json` }))).toBe(
      'state-path-in-config-dir',
    );
    expect(reasonOf(loadRun({ stateDir: inConfig, loadStatePath: `${inConfig}/x.json` }))).toBe(
      'state-path-in-config-dir',
    );
    // Ignoring case, as before.
    expect(reasonOf(dumpRun({ dumpStatePath: `${STATE}/.CONFIG/${CONFIG_FOLDER.toUpperCase()}/x.json` }))).toBe(
      'state-path-in-config-dir',
    );
    // The two segments must follow one another.
    expect(reasonOf(dumpRun({ dumpStatePath: `${STATE}/.config/other/${CONFIG_FOLDER}.json` }))).toBe('ok');
  });
  it('writing state needs the fork run, loading state needs no fork, and both together are refused', () => {
    expect(reasonOf(base({ stateDir: STATE, repoRoot: REPO, dumpStatePath: DUMP }))).toBe('dump-state-without-fork');
    expect(reasonOf(loadRun({ forkUrl: FORK, forkBlock: BLOCK, allowedForkUrls: [FORK] }))).toBe(
      'load-state-with-fork',
    );
    expect(reasonOf(dumpRun({ loadStatePath: LOAD }))).toBe('dump-and-load-state-together');
    expect(reasonOf(loadRun({ dumpStatePath: DUMP }))).toBe('dump-and-load-state-together');
  });
  it('the checks see text only: a path through a link elsewhere is accepted as text (where it leads could not be verified here)', () => {
    expect(reasonOf(dumpRun({ dumpStatePath: `${STATE}/link-to-somewhere/x.json` }))).toBe('ok');
  });
});

describe('the anvil argument list (returned only; nothing is started)', () => {
  it('no fork: host, port, chain id and no dev accounts, exactly', () => {
    expect(buildAnvilArgs(optionsOf(base()))).toEqual(BASE_ARGS());
  });
  it('a validated fork adds the fork URL, the pinned block, --no-fork-node-info and the four fork limits, exactly', () => {
    expect(buildAnvilArgs(optionsOf(fork()))).toEqual([...BASE_ARGS(), ...FORK_ARGS()]);
  });
  it('the four fork limits come in a fixed order after --no-fork-node-info, the header as one argument', () => {
    const args = buildAnvilArgs(optionsOf(dumpRun()));
    const at = args.indexOf('--no-fork-node-info');
    expect(args.slice(at + 1, at + 8)).toEqual([
      '--no-storage-caching',
      '--retries',
      '0',
      '--timeout',
      '10000',
      '--fork-header',
      'User-Agent: repo-check',
    ]);
    for (const f of FORK_LIMIT_FLAGS) expect(args.filter((a) => a === f).length).toBe(1);
    expect(FORK_LIMIT_ARGS).toEqual(args.slice(at + 1, at + 8));
    expect(Object.isFrozen(FORK_LIMIT_ARGS)).toBe(true);
  });
  it('the four fork limits never appear without a validated fork: not for a plain run, not for a load run', () => {
    for (const input of [base(), loadRun(), base({ stateDir: STATE, repoRoot: REPO })]) {
      const args = buildAnvilArgs(optionsOf(input));
      for (const f of FORK_LIMIT_FLAGS) expect(args.includes(f)).toBe(false);
      expect(args.includes('User-Agent: repo-check')).toBe(false);
    }
  });
  it('the one fork run adds --dump-state with its path, exactly', () => {
    expect(buildAnvilArgs(optionsOf(dumpRun()))).toEqual([...BASE_ARGS(), ...FORK_ARGS(), '--dump-state', DUMP]);
  });
  it('an offline start adds --load-state with its path and no fork flag, exactly', () => {
    expect(buildAnvilArgs(optionsOf(loadRun()))).toEqual([...BASE_ARGS(), '--load-state', LOAD]);
  });
  it('--state, funding, impersonation and rate-limit flags never appear; --dump-state and --load-state only when validated', () => {
    const extra = { state: '/x', dumpState: '/x', loadState: '/x', fundAccounts: ['a:1'], autoImpersonate: true };
    const plain = [base(extra as Partial<ChainOptionsInput>), fork(extra as Partial<ChainOptionsInput>)];
    const withState = [dumpRun(extra as Partial<ChainOptionsInput>), loadRun(extra as Partial<ChainOptionsInput>)];
    for (const input of [...plain, ...withState]) {
      const flags = buildAnvilArgs(optionsOf(input)).filter((a) => a.startsWith('-'));
      for (const f of NEVER) expect(flags.includes(f)).toBe(false);
      for (const f of flags) {
        expect([
          '--host',
          '--port',
          '--chain-id',
          '--accounts',
          '--fork-url',
          '--fork-block-number',
          '--no-fork-node-info',
          '--no-storage-caching',
          '--retries',
          '--timeout',
          '--fork-header',
          '--dump-state',
          '--load-state',
        ]).toContain(f);
      }
    }
    for (const input of plain) {
      const flags = buildAnvilArgs(optionsOf(input));
      expect(flags.includes('--dump-state')).toBe(false);
      expect(flags.includes('--load-state')).toBe(false);
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
      dumpStatePath: '/x/state.json',
      loadStatePath: null,
    } as unknown as ChainOptions;
    expect(() => buildAnvilArgs(madeUp)).toThrow('chain-options-not-validated');
  });
});
