// The local chain's options and argument list, for anvil on 127.0.0.1 only. Pure functions: nothing
// here starts a process, opens a socket or sends a request, and nothing is read from HOME, the
// environment, the working folder or any file. The binary path is passed in by the caller. A fork is
// refused unless its https URL is on a list the caller passes in (empty by default) and its block is
// pinned. A saved chain state may be written once, on the one fork run (--dump-state), or loaded
// offline with no fork (--load-state). Its path must lie inside a state folder the caller names, and
// that folder must lie outside the repo folder the caller names. These checks see only the text of
// each path: they cannot see symlinks, case folding on the disk, or whether a file exists, so where a
// path really leads could not be verified here. The argument list never holds --state, a funding flag
// or an impersonation flag. Base Sepolia only (eip155:84532).
import { isAbsolute } from 'node:path';
import { brand } from '@dabsproof/brand';
import { BASE_SEPOLIA } from '@dabsproof/registry';

export const ANVIL_HOST = '127.0.0.1';
/** 84532, taken from the runner's Base Sepolia network name, not written again. */
export const ANVIL_CHAIN_ID = Number(BASE_SEPOLIA.split(':')[1]);
/** The demo harness's port; the chain never uses it. */
const RESERVED_PORT = 4319;
/**
 * For a validated fork only, in this order, after --no-fork-node-info: no RPC cache on disk, no
 * retries of the fork endpoint, a 10 s limit per fork request, and our own User-Agent on every fork
 * request. Wording from anvil's help text; whether anvil accepts a retry count of 0 could not be
 * verified here.
 */
export const FORK_LIMIT_ARGS: readonly string[] = Object.freeze([
  '--no-storage-caching',
  '--retries',
  '0',
  '--timeout',
  '10000',
  '--fork-header',
  'User-Agent: repo-check',
]);

export const CHAIN_REASONS = [
  'host-not-loopback-literal',
  'port-invalid',
  'port-reserved',
  'chain-id-not-base-sepolia',
  'binary-path-missing',
  'binary-path-not-absolute',
  'binary-path-has-dot-dot',
  'allowed-fork-urls-invalid',
  'fork-url-invalid',
  'fork-url-not-https',
  'fork-url-has-userinfo',
  'fork-url-has-query',
  'fork-url-not-allowed',
  'fork-block-invalid',
  'fork-block-without-fork-url',
  'dump-and-load-state-together',
  'state-dir-invalid',
  'repo-root-invalid',
  'state-dir-missing',
  'repo-root-missing',
  'state-dir-overlaps-repo',
  'dump-state-path-invalid',
  'load-state-path-invalid',
  'state-path-in-config-dir',
  'state-path-outside-state-dir',
  'state-path-not-json',
  'state-path-env-name',
  'dump-state-without-fork',
  'load-state-with-fork',
] as const;
export type ChainReason = (typeof CHAIN_REASONS)[number];

export interface ChainOptionsInput {
  host: unknown;
  port: unknown;
  chainId: unknown;
  binaryPath: unknown;
  forkUrl?: unknown;
  forkBlock?: unknown;
  /** The only fork URLs accepted, matched exactly. Default empty: no fork is allowed. */
  allowedForkUrls?: unknown;
  /** The folder a saved chain state must lie in; outside repoRoot. Needed with either state path. */
  stateDir?: unknown;
  /** The repo folder, so that stateDir can be kept out of it. Needed with either state path. */
  repoRoot?: unknown;
  /** Where the one fork run writes its state on exit. Only with a validated fork. */
  dumpStatePath?: unknown;
  /** A saved state to start from, offline. Only without a fork. */
  loadStatePath?: unknown;
}

export interface ChainOptions {
  readonly host: typeof ANVIL_HOST;
  readonly port: number;
  readonly chainId: number;
  readonly binaryPath: string;
  readonly fork: Readonly<{ url: string; block: number }> | null;
  readonly dumpStatePath: string | null;
  readonly loadStatePath: string | null;
}

/** Options that came out of validateChainOptions; buildAnvilArgs takes no others. */
const validated = new WeakSet<ChainOptions>();

function checkFork(
  input: ChainOptionsInput,
): { ok: true; fork: ChainOptions['fork'] } | { ok: false; reason: ChainReason } {
  // Only undefined means "not given", as for forkUrl and forkBlock; null is refused.
  const allowed = input.allowedForkUrls === undefined ? [] : input.allowedForkUrls;
  if (!Array.isArray(allowed) || !allowed.every((u) => typeof u === 'string')) {
    return { ok: false, reason: 'allowed-fork-urls-invalid' };
  }
  if (input.forkUrl === undefined) {
    return input.forkBlock === undefined
      ? { ok: true, fork: null }
      : { ok: false, reason: 'fork-block-without-fork-url' };
  }
  if (typeof input.forkUrl !== 'string') return { ok: false, reason: 'fork-url-invalid' };
  let url: URL;
  try {
    url = new URL(input.forkUrl);
  } catch {
    return { ok: false, reason: 'fork-url-invalid' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'fork-url-not-https' };
  if (url.username !== '' || url.password !== '') return { ok: false, reason: 'fork-url-has-userinfo' };
  if (url.search !== '' || input.forkUrl.includes('?')) return { ok: false, reason: 'fork-url-has-query' };
  if (!allowed.includes(input.forkUrl)) return { ok: false, reason: 'fork-url-not-allowed' };
  const block = input.forkBlock;
  if (typeof block !== 'number' || !Number.isSafeInteger(block) || block <= 0) {
    return { ok: false, reason: 'fork-block-invalid' };
  }
  return { ok: true, fork: Object.freeze({ url: input.forkUrl, block }) };
}

/**
 * A plain absolute path as text: starts with /, no backslash or NUL, and no empty, "." or ".."
 * segment (so no doubled or trailing slash). Says nothing about where the path really leads.
 */
function isPlainAbsolute(p: unknown): p is string {
  if (typeof p !== 'string' || p === '' || p.includes('\0') || p.includes('\\') || !isAbsolute(p)) return false;
  if (!p.startsWith('/')) return false;
  return p
    .slice(1)
    .split('/')
    .every((s) => s !== '' && s !== '.' && s !== '..');
}

/** True if a and b are the same folder or one lies inside the other, compared as text and ignoring case. */
function overlaps(a: string, b: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`);
}

/**
 * The product's own config folder name: the last part of brand.configDir, taken as text only (no
 * file is looked at), in lower case.
 */
const CONFIG_FOLDER = (brand.configDir.split('/').pop() ?? '').toLowerCase();

/** True if the path holds a ".config" segment followed at once by the config folder name, ignoring case. */
function namesOwnConfigDir(p: string): boolean {
  if (CONFIG_FOLDER === '') return false;
  const s = p.toLowerCase().split('/');
  return s.some((seg, i) => seg === '.config' && s[i + 1] === CONFIG_FOLDER);
}

function checkStatePath(
  p: unknown,
  stateDir: string,
  invalid: 'dump-state-path-invalid' | 'load-state-path-invalid',
): { ok: true; path: string } | { ok: false; reason: ChainReason } {
  if (!isPlainAbsolute(p)) return { ok: false, reason: invalid };
  if (namesOwnConfigDir(p)) return { ok: false, reason: 'state-path-in-config-dir' };
  // Inside the state folder: the folder's own text plus "/" must begin the path, so a sibling such as
  // /x/state-other is not inside /x/state. Compared with case kept.
  if (!p.startsWith(`${stateDir}/`)) return { ok: false, reason: 'state-path-outside-state-dir' };
  const base = p.slice(p.lastIndexOf('/') + 1);
  if (!base.endsWith('.json') || base === '.json') return { ok: false, reason: 'state-path-not-json' };
  if (base.toLowerCase().startsWith('.env')) return { ok: false, reason: 'state-path-env-name' };
  return { ok: true, path: p };
}

function checkState(
  input: ChainOptionsInput,
  fork: ChainOptions['fork'],
): { ok: true; dump: string | null; load: string | null } | { ok: false; reason: ChainReason } {
  // Only undefined means "not given"; null is refused with the input's own reason.
  const dumpGiven = input.dumpStatePath !== undefined;
  const loadGiven = input.loadStatePath !== undefined;
  if (dumpGiven && loadGiven) return { ok: false, reason: 'dump-and-load-state-together' };
  if (input.stateDir !== undefined && !isPlainAbsolute(input.stateDir))
    return { ok: false, reason: 'state-dir-invalid' };
  if (input.repoRoot !== undefined && !isPlainAbsolute(input.repoRoot))
    return { ok: false, reason: 'repo-root-invalid' };
  if ((dumpGiven || loadGiven) && input.stateDir === undefined) return { ok: false, reason: 'state-dir-missing' };
  if ((dumpGiven || loadGiven) && input.repoRoot === undefined) return { ok: false, reason: 'repo-root-missing' };
  if (typeof input.stateDir === 'string' && typeof input.repoRoot === 'string') {
    if (overlaps(input.stateDir, input.repoRoot)) return { ok: false, reason: 'state-dir-overlaps-repo' };
  }
  if (!dumpGiven && !loadGiven) return { ok: true, dump: null, load: null };
  const stateDir = input.stateDir as string;
  if (dumpGiven) {
    const d = checkStatePath(input.dumpStatePath, stateDir, 'dump-state-path-invalid');
    if (!d.ok) return d;
    if (fork === null) return { ok: false, reason: 'dump-state-without-fork' };
    return { ok: true, dump: d.path, load: null };
  }
  const l = checkStatePath(input.loadStatePath, stateDir, 'load-state-path-invalid');
  if (!l.ok) return l;
  if (fork !== null) return { ok: false, reason: 'load-state-with-fork' };
  return { ok: true, dump: null, load: l.path };
}

/** Checks every option; returns frozen options or one short reason code. */
export function validateChainOptions(
  input: ChainOptionsInput,
): { ok: true; options: ChainOptions } | { ok: false; reason: ChainReason } {
  if (input?.host !== ANVIL_HOST) return { ok: false, reason: 'host-not-loopback-literal' };
  const port = input.port;
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1024 || port > 65535) {
    return { ok: false, reason: 'port-invalid' };
  }
  if (port === RESERVED_PORT) return { ok: false, reason: 'port-reserved' };
  if (input.chainId !== ANVIL_CHAIN_ID) return { ok: false, reason: 'chain-id-not-base-sepolia' };
  const path = input.binaryPath;
  if (typeof path !== 'string' || path === '' || path.includes('\0'))
    return { ok: false, reason: 'binary-path-missing' };
  if (!isAbsolute(path)) return { ok: false, reason: 'binary-path-not-absolute' };
  if (path.split(/[\\/]/).includes('..')) return { ok: false, reason: 'binary-path-has-dot-dot' };
  const fork = checkFork(input);
  if (!fork.ok) return fork;
  const state = checkState(input, fork.fork);
  if (!state.ok) return state;
  const options: ChainOptions = Object.freeze({
    host: ANVIL_HOST,
    port,
    chainId: ANVIL_CHAIN_ID,
    binaryPath: path,
    fork: fork.fork,
    dumpStatePath: state.dump,
    loadStatePath: state.load,
  });
  validated.add(options);
  return { ok: true, options };
}

/**
 * The argument list for anvil, built from validated options only: host, port, chain id and no dev
 * accounts; for a validated fork, the fork URL, the pinned block, --no-fork-node-info (which, by
 * anvil's help text, skips its node-info probe of the fork endpoint) and then FORK_LIMIT_ARGS; and
 * --dump-state or --load-state when one was validated. Never --state, a funding flag, an
 * impersonation flag or a rate-limit flag.
 * Returns the list and starts nothing. Throws if the options did not come from validateChainOptions.
 */
export function buildAnvilArgs(options: ChainOptions): string[] {
  if (!validated.has(options)) throw new Error('chain-options-not-validated');
  const args = [
    '--host',
    ANVIL_HOST,
    '--port',
    String(options.port),
    '--chain-id',
    String(ANVIL_CHAIN_ID),
    '--accounts',
    '0',
  ];
  if (options.fork) {
    args.push('--fork-url', options.fork.url, '--fork-block-number', String(options.fork.block), '--no-fork-node-info');
    args.push(...FORK_LIMIT_ARGS);
  }
  if (options.dumpStatePath !== null) args.push('--dump-state', options.dumpStatePath);
  if (options.loadStatePath !== null) args.push('--load-state', options.loadStatePath);
  return args;
}
