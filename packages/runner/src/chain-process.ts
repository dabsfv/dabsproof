// Starting and stopping a local anvil chain on 127.0.0.1, for tests only. The options go through
// validateChainOptions and the argument list comes from buildAnvilArgs only. The binary is started
// directly, with no shell, with no input and with its output ignored: nothing it prints is read, kept
// or shown. Its environment is the one fixed PATH below and nothing else; no environment value of
// this process is read or passed on. No fork in this version. Readiness is one local eth_chainId
// call at a time through checkTarget and sendLocalJson, so the request budget applies.
import { type ChildProcess, spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { RequestBudget } from './budget.js';
import { ANVIL_CHAIN_ID, ANVIL_HOST, buildAnvilArgs, type ChainReason, validateChainOptions } from './chain.js';
import { sendLocalJson } from './send.js';
import { checkTarget } from './target.js';

/** The child's whole environment: a fixed PATH, nothing read from this process. */
export const CHAIN_CHILD_ENV: Readonly<{ PATH: string }> = Object.freeze({ PATH: '/usr/bin:/bin' });
const READY_DEADLINE_MS = 10_000;
const TRY_EVERY_MS = 500;
const STOP_WAIT_MS = 5000;
const READY_ROUTE = 'chain-ready';
const EXPECTED_CHAIN_ID = `0x${ANVIL_CHAIN_ID.toString(16)}`;

export type ChainProcessReason =
  | ChainReason
  | 'fork-not-allowed-yet'
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
}

export interface ChainStopResult {
  /** True once the process has exited. */
  exited: boolean;
  /** True if a forced kill was needed after the normal termination signal. */
  forced: boolean;
  /** True if the port refused a connection afterwards. */
  portClosed: boolean;
}

export interface ChainProcess {
  port: number;
  pid: number;
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
    }
  | { ok: false; reason: ChainProcessReason } {
  if (input?.forkUrl !== undefined || input?.forkBlock !== undefined) {
    return { ok: false, reason: 'fork-not-allowed-yet' };
  }
  const v = validateChainOptions({
    host: ANVIL_HOST,
    port: input?.port,
    chainId: ANVIL_CHAIN_ID,
    binaryPath: input?.binaryPath,
  });
  if (!v.ok) return v;
  return {
    ok: true,
    file: v.options.binaryPath,
    args: buildAnvilArgs(v.options),
    options: { env: CHAIN_CHILD_ENV, stdio: 'ignore', shell: false },
    port: v.options.port,
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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

function makeStop(child: ChildProcess, port: number): () => Promise<ChainStopResult> {
  let exited = child.exitCode !== null || child.signalCode !== null;
  const exit = new Promise<void>((done) => {
    if (exited) done();
    child.once('exit', () => {
      exited = true;
      done();
    });
  });
  let stopping: Promise<ChainStopResult> | null = null;
  return () => {
    if (stopping) return stopping;
    stopping = (async () => {
      let forced = false;
      // A binary that could not be started has no process ID and no exit event: nothing to stop.
      if (child.pid === undefined) exited = true;
      if (!exited) {
        child.kill('SIGTERM');
        await Promise.race([exit, sleep(STOP_WAIT_MS)]);
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
      return { exited, forced, portClosed };
    })();
    return stopping;
  };
}

/**
 * Starts anvil on 127.0.0.1 at the given port and waits, at most 10 s, until eth_chainId answers
 * 84532. On any refusal after the start, the process is stopped before returning.
 */
export async function startChain(
  input: ChainProcessInput,
): Promise<({ ok: true } & ChainProcess) | { ok: false; reason: ChainProcessReason }> {
  const launch = chainLaunch(input);
  if (!launch.ok) return launch;
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
  const stop = makeStop(child, launch.port);
  const refuse = async (reason: ChainProcessReason) => {
    await stop();
    return { ok: false as const, reason };
  };
  const origin = `http://${ANVIL_HOST}:${launch.port}`;
  const budget = new RequestBudget({ requestsPerRoute: 20, burst: 1 });
  const deadline = Date.now() + READY_DEADLINE_MS;
  while (Date.now() < deadline) {
    if (failed) return refuse('start-failed');
    if (child.exitCode !== null || child.signalCode !== null) return refuse('exited-early');
    const left = deadline - Date.now();
    const id = await Promise.race([chainIdOnce(origin, budget), sleep(left).then(() => null)]);
    if (id === EXPECTED_CHAIN_ID) {
      if (child.pid === undefined) return refuse('start-failed');
      return { ok: true, port: launch.port, pid: child.pid, stop };
    }
    if (id !== null) return refuse('chain-id-mismatch');
    await sleep(Math.min(TRY_EVERY_MS, Math.max(deadline - Date.now(), 0)));
  }
  return refuse('not-ready');
}
