// The local chain's options and argument list, for anvil on 127.0.0.1 only. Pure functions: nothing
// here starts a process, opens a socket or sends a request, and nothing is read from HOME, the
// environment or any file. The binary path is passed in by the caller. A fork is refused unless its
// https URL is on a list the caller passes in (empty by default) and its block is pinned. The argument
// list never holds a state, funding or impersonation flag. Base Sepolia only (eip155:84532).
import { isAbsolute } from 'node:path';
import { BASE_SEPOLIA } from '@dabsproof/registry';

export const ANVIL_HOST = '127.0.0.1';
/** 84532, taken from the runner's Base Sepolia network name, not written again. */
export const ANVIL_CHAIN_ID = Number(BASE_SEPOLIA.split(':')[1]);
/** The demo harness's port; the chain never uses it. */
const RESERVED_PORT = 4319;

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
}

export interface ChainOptions {
  readonly host: typeof ANVIL_HOST;
  readonly port: number;
  readonly chainId: number;
  readonly binaryPath: string;
  readonly fork: Readonly<{ url: string; block: number }> | null;
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
  const options: ChainOptions = Object.freeze({
    host: ANVIL_HOST,
    port,
    chainId: ANVIL_CHAIN_ID,
    binaryPath: path,
    fork: fork.fork,
  });
  validated.add(options);
  return { ok: true, options };
}

/**
 * The argument list for anvil, built from validated options only: host, port, chain id and no dev
 * accounts, plus the fork URL and pinned block when a fork was validated. Returns the list and starts
 * nothing. Throws if the options did not come from validateChainOptions.
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
  if (options.fork) args.push('--fork-url', options.fork.url, '--fork-block-number', String(options.fork.block));
  return args;
}
