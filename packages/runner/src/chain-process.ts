// Starting and stopping a local anvil chain on 127.0.0.1, for tests only. The options go through
// validateChainOptions and the argument list comes from buildAnvilArgs only, so a fork is started only
// when its URL is on the caller's allowed list and its block is pinned, and a saved state is written
// or loaded only at a path validated there. The binary is started directly, with no shell, with no
// input and with its output ignored: nothing it prints is read, kept or shown. Its environment is the
// one fixed PATH below and nothing else; no environment value of this process is read or passed on.
// Before a start, the state folder and state file are looked at by metadata only (lstat): they are
// never read, written, created or removed here. Folders above the state folder are not looked at, so
// whether one of them is a link could not be verified here. Readiness is one local eth_chainId call
// at a time through checkTarget and sendLocalJson, at most 20 tries, so the request budget applies.
import { type ChildProcess, spawn } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { createConnection } from 'node:net';
import { RequestBudget } from './budget.js';
import { ANVIL_CHAIN_ID, ANVIL_HOST, buildAnvilArgs, type ChainReason, validateChainOptions } from './chain.js';
import { sendLocalJson } from './send.js';
import { checkTarget } from './target.js';

/** The child's whole environment: a fixed PATH, nothing read from this process. */
export const CHAIN_CHILD_ENV: Readonly<{ PATH: string }> = Object.freeze({ PATH: '/usr/bin:/bin' });
/** The largest saved state a start will load. */
export const MAX_LOAD_STATE_BYTES = 64 * 1024 * 1024;
const MAX_TRIES = 20;
/**
 * How long a start waits for eth_chainId, and how often it tries. Both plans fit the request
 * budget of 20 per route: 10 s at one try every 500 ms, or 30 s at one try every 1500 ms for a fork.
 */
export const READY_PLANS = Object.freeze({
  plain: Object.freeze({ deadlineMs: 10_000, everyMs: 500, maxTries: MAX_TRIES }),
  fork: Object.freeze({ deadlineMs: 30_000, everyMs: 1500, maxTries: MAX_TRIES }),
});
export type ReadyPlan = { readonly deadlineMs: number; readonly everyMs: number; readonly maxTries: number };
const STOP_WAIT_MS = 5000;
/** A run that writes its state on exit gets longer to finish writing before a forced kill. */
const DUMP_STOP_WAIT_MS = 15_000;
const READY_ROUTE = 'chain-ready';
const EXPECTED_CHAIN_ID = `0x${ANVIL_CHAIN_ID.toString(16)}`;

export type ChainProcessReason =
  | ChainReason
  | 'state-dir-not-found'
  | 'state-dir-not-folder'
  | 'state-path-is-link'
  | 'dump-state-exists'
  | 'load-state-not-found'
  | 'load-state-not-file'
  | 'load-state-too-large'
  | 'port-in-use'
  | 'start-failed'
  | 'exited-early'
  | 'chain-id-mismatch'
  | 'not-ready';

export interface ChainProcessInput {
  binaryPath: unknown;
  port: unknown;
  forkUrl?: unknown;
  forkBlock?: unknown;
  allowedForkUrls?: unknown;
  stateDir?: unknown;
  repoRoot?: unknown;
  dumpStatePath?: unknown;
  loadStatePath?: unknown;
}

export interface ChainStopResult {
  /** True once the process has exited. */
  exited: boolean;
  /** True if a forced kill was needed after the normal termination signal. */
  forced: boolean;
  /** True if the port refused a connection afterwards. */
  portClosed: boolean;
  /**
   * Only for a run that writes its state: true if, after a normal exit, the state file exists, is a
   * plain file and is not empty (by metadata only; its contents are never read). False after a
   * forced kill.
   */
  dumpWritten?: boolean;
}

export interface ChainProcess {
  port: number;
  pid: number;
  /** True only when this chain was started as a validated fork. */
  readonly fork: boolean;
  /** Stops the process by its ID; a second call returns the same result. */
  stop: () => Promise<ChainStopResult>;
}

/** What would be started, built without starting anything: file, argument list and child options. */
export function chainLaunch(input: ChainProcessInput):
  | {
      ok: true;
      file: string;
      args: string[];
      options: { env: Readonly<{ PATH: string }>; stdio: 'ignore'; shell: false };
      port: number;
      fork: boolean;
      stateDir: string | null;
      dumpStatePath: string | null;
      loadStatePath: string | null;
    }
  | { ok: false; reason: ChainProcessReason } {
  const v = validateChainOptions({
    host: ANVIL_HOST,
    port: input?.port,
    chainId: ANVIL_CHAIN_ID,
    binaryPath: input?.binaryPath,
    forkUrl: input?.forkUrl,
    forkBlock: input?.forkBlock,
    allowedForkUrls: input?.allowedForkUrls,
    stateDir: input?.stateDir,
    repoRoot: input?.repoRoot,
    dumpStatePath: input?.dumpStatePath,
    loadStatePath: input?.loadStatePath,
  });
  if (!v.ok) return v;
  const usesState = v.options.dumpStatePath !== null || v.options.loadStatePath !== null;
  return {
    ok: true,
    file: v.options.binaryPath,
    args: buildAnvilArgs(v.options),
    options: { env: CHAIN_CHILD_ENV, stdio: 'ignore', shell: false },
    port: v.options.port,
    fork: v.options.fork !== null,
    // Validated by validateChainOptions whenever a state path was given.
    stateDir: usesState ? (input.stateDir as string) : null,
    dumpStatePath: v.options.dumpStatePath,
    loadStatePath: v.options.loadStatePath,
  };
}

type Entry = { kind: 'missing' | 'link' | 'folder' | 'file' | 'other'; size: number };
/** What is at a path, by lstat only: the path itself is never read or followed. */
function entryAt(path: string): Entry {
  try {
    const s = lstatSync(path, { throwIfNoEntry: false });
    if (s === undefined) return { kind: 'missing', size: 0 };
    if (s.isSymbolicLink()) return { kind: 'link', size: 0 };
    if (s.isDirectory()) return { kind: 'folder', size: 0 };
    if (s.isFile()) return { kind: 'file', size: s.size };
    return { kind: 'other', size: 0 };
  } catch {
    return { kind: 'missing', size: 0 };
  }
}

/** The state folder and state file checks, by metadata only. Null if nothing is wrong. */
function stateFileProblem(launch: {
  stateDir: string | null;
  dumpStatePath: string | null;
  loadStatePath: string | null;
}): ChainProcessReason | null {
  if (launch.stateDir === null) return null;
  const dir = entryAt(launch.stateDir);
  if (dir.kind === 'missing') return 'state-dir-not-found';
  if (dir.kind === 'link') return 'state-path-is-link';
  if (dir.kind !== 'folder') return 'state-dir-not-folder';
  if (launch.dumpStatePath !== null && entryAt(launch.dumpStatePath).kind !== 'missing') return 'dump-state-exists';
  if (launch.loadStatePath !== null) {
    const f = entryAt(launch.loadStatePath);
    if (f.kind === 'missing') return 'load-state-not-found';
    if (f.kind === 'link') return 'state-path-is-link';
    if (f.kind !== 'file') return 'load-state-not-file';
    if (f.size > MAX_LOAD_STATE_BYTES) return 'load-state-too-large';
  }
  return null;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** A wait that never keeps the process alive on its own. */
const timeout = (ms: number) =>
  new Promise<null>((r) => {
    const t = setTimeout(() => r(null), ms);
    t.unref();
  });

export type ReadyTry = 'ready' | 'mismatch' | 'exited' | 'failed' | 'no';
export type ReadyResult = 'ready' | 'chain-id-mismatch' | 'exited-early' | 'start-failed' | 'not-ready';

/**
 * Tries at most plan.maxTries times, one try every plan.everyMs, until plan.deadlineMs has passed;
 * never a try after the last one or after the deadline. tryOnce gets the time left. The clock can be
 * replaced so that the timing can be tested without waiting.
 */
export async function pollUntilReady(
  plan: ReadyPlan,
  tryOnce: (msLeft: number) => Promise<ReadyTry>,
  clock: { now: () => number; sleep: (ms: number) => Promise<void> } = { now: () => Date.now(), sleep },
): Promise<{ result: ReadyResult; tries: number }> {
  const deadline = clock.now() + plan.deadlineMs;
  let tries = 0;
  while (tries < plan.maxTries) {
    const left = deadline - clock.now();
    if (left <= 0) break;
    tries++;
    const r = await tryOnce(left);
    if (r === 'ready') return { result: 'ready', tries };
    if (r === 'mismatch') return { result: 'chain-id-mismatch', tries };
    if (r === 'exited') return { result: 'exited-early', tries };
    if (r === 'failed') return { result: 'start-failed', tries };
    if (tries >= plan.maxTries) break;
    const wait = Math.min(plan.everyMs, deadline - clock.now());
    if (wait <= 0) break;
    await clock.sleep(wait);
  }
  return { result: 'not-ready', tries };
}

/** True if nothing accepts a connection on 127.0.0.1 at this port. */
function portRefuses(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createConnection({ host: ANVIL_HOST, port });
    s.once('connect', () => {
      s.destroy();
      resolve(false);
    });
    s.once('error', () => resolve(true));
  });
}

/** One eth_chainId call: the result text if the reply holds one, else null. Nothing else is kept. */
async function chainIdOnce(origin: string, budget: RequestBudget): Promise<string | null> {
  const target = checkTarget(origin, { local: true });
  if (!target.ok) return null;
  const r = await sendLocalJson(target.target, budget, READY_ROUTE, '/', {
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_chainId',
    params: [],
  });
  if (!r.ok || r.status !== 200) return null;
  try {
    const result: unknown = JSON.parse(Buffer.from(r.body).toString('utf8'))?.result;
    return typeof result === 'string' && /^0x[0-9a-f]{1,16}$/.test(result) ? result : null;
  } catch {
    return null;
  }
}

function makeStop(child: ChildProcess, port: number, dumpStatePath: string | null): () => Promise<ChainStopResult> {
  let exited = child.exitCode !== null || child.signalCode !== null;
  const exit = new Promise<void>((done) => {
    if (exited) done();
    child.once('exit', () => {
      exited = true;
      done();
    });
  });
  const waitMs = dumpStatePath === null ? STOP_WAIT_MS : DUMP_STOP_WAIT_MS;
  let stopping: Promise<ChainStopResult> | null = null;
  return () => {
    if (stopping) return stopping;
    stopping = (async () => {
      let forced = false;
      // A binary that could not be started has no process ID and no exit event: nothing to stop.
      if (child.pid === undefined) exited = true;
      if (!exited) {
        child.kill('SIGTERM');
        await Promise.race([exit, sleep(waitMs)]);
        if (!exited) {
          forced = true;
          child.kill('SIGKILL');
          await Promise.race([exit, sleep(STOP_WAIT_MS)]);
        }
      }
      let portClosed = await portRefuses(port);
      for (let i = 0; i < 20 && !portClosed; i++) {
        await sleep(100);
        portClosed = await portRefuses(port);
      }
      if (dumpStatePath === null) return { exited, forced, portClosed };
      const f = entryAt(dumpStatePath);
      return { exited, forced, portClosed, dumpWritten: !forced && f.kind === 'file' && f.size > 0 };
    })();
    return stopping;
  };
}

/**
 * Starts anvil on 127.0.0.1 at the given port and waits until eth_chainId answers 84532: at most
 * 10 s, or 30 s for a fork. On any refusal after the start, the process is stopped before returning.
 */
export async function startChain(
  input: ChainProcessInput,
): Promise<({ ok: true } & ChainProcess) | { ok: false; reason: ChainProcessReason }> {
  const launch = chainLaunch(input);
  if (!launch.ok) return launch;
  const problem = stateFileProblem(launch);
  if (problem !== null) return { ok: false, reason: problem };
  // Anything already on the port would answer for us; refuse rather than talk to it.
  if (!(await portRefuses(launch.port))) return { ok: false, reason: 'port-in-use' };
  let child: ChildProcess;
  try {
    child = spawn(launch.file, launch.args, { env: { ...launch.options.env }, stdio: 'ignore', shell: false });
  } catch {
    return { ok: false, reason: 'start-failed' };
  }
  let failed = false;
  child.once('error', () => {
    failed = true;
  });
  const stop = makeStop(child, launch.port, launch.dumpStatePath);
  const origin = `http://${ANVIL_HOST}:${launch.port}`;
  const budget = new RequestBudget({ requestsPerRoute: 20, burst: 1 });
  const ready = await pollUntilReady(launch.fork ? READY_PLANS.fork : READY_PLANS.plain, async (left) => {
    if (failed) return 'failed';
    if (child.exitCode !== null || child.signalCode !== null) return 'exited';
    const id = await Promise.race([chainIdOnce(origin, budget), timeout(left)]);
    if (id === EXPECTED_CHAIN_ID) return 'ready';
    return id === null ? 'no' : 'mismatch';
  });
  if (ready.result === 'ready' && child.pid !== undefined) {
    return { ok: true, port: launch.port, pid: child.pid, fork: launch.fork, stop };
  }
  await stop();
  return { ok: false, reason: ready.result === 'ready' ? 'start-failed' : ready.result };
}
