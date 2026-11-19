// Start-up helper for Next.js instrumentation.ts, and the request-time fallback.
//
// What the step 1.6 spike saw with Next.js 16.4.6 (a minimal app, 127.0.0.1 only):
// - register() ran once per server start in the Node.js runtime, under next start and next dev,
//   before the first request was answered. It ran separately in the Edge runtime, only when the
//   first Edge request arrived.
// - A throw in register() did not stop next start: the server kept listening and answered every
//   request (Node.js route, Edge route and page) with a plain 500 Internal Server Error.
// - A value stored in a module by register() did not reach a route handler; a value stored on
//   globalThis did, in the Node.js runtime. The Edge runtime saw neither.
// - Turbopack did not resolve a package linked from outside the project folder; packages copied
//   into node_modules as real folders worked.
// - NEXT_PUBLIC_ values set at build time were found in files under .next/static (sent to browsers).
// - register() did not run during next build.
// - next dev made one outbound connection (consistent with the npm registry; content not seen);
//   next build and next start: none seen.
// Not tested by the spike: a request arriving while register() runs; a throw under next dev;
// whether core was bundled or loaded from node_modules; bundling of @dabsproof/evm, @noble/* and
// @scure/*; how sellers will install the package (nothing is published).
//
// So: the checked manager lives on globalThis under a Symbol.for key, the checks run only in the
// Node.js runtime, the Edge runtime always refuses, and the fix kit never relies on Next.js to
// stop serving: every path that gives out an address goes through a manager built from a checked
// mapping, or refuses.
import { brand } from '@dabsproof/brand';
import { EvmInputError } from '@dabsproof/evm';
import { type GuardOptions, guardEnvironment, XPUB_VARIABLE } from '../guards/env.js';
import { FixkitError, FIXKIT_TEXT as T } from '../messages.js';
import { createPayToManager, type ManagerOptions, type PayToManager, type PayToRequest } from '../payto/manager.js';

/** Where the checked manager (or the refusal) is kept, shared by instrumentation and routes. */
export const STATE_KEY: unique symbol = Symbol.for(`${brand.slug}.fixkit.payto`) as never;

export type PayToState = { status: 'ready'; manager: PayToManager } | { status: 'refused'; code: FixkitError['code'] };

export interface RegisterOptions extends Omit<ManagerOptions, 'xpub'>, GuardOptions {
  /** The xpub. Defaults to the fix kit's own environment variable. */
  xpub?: string;
  /** The environment to check. Defaults to process.env. */
  env?: Readonly<Record<string, string | undefined>>;
  /** Throw after a failed check instead of only refusing addresses. */
  failHard?: boolean;
  /** Where lines are written. Defaults to standard error. */
  log?: (line: string) => void;
}

type Store = { [STATE_KEY]?: PayToState };
const store = (): Store => globalThis as Store;
const runtimeOf = (env: Readonly<Record<string, string | undefined>>): string => env.NEXT_RUNTIME ?? 'nodejs';
const stderr = (line: string): void => {
  process.stderr.write(`${line}\n`);
};

/** The current state, if register() or the fallback has run. */
export const payToState = (): PayToState | undefined => store()[STATE_KEY];

/** Clears the state (tests, and Next.js dev reloads before a new check). */
export function resetPayToState(): void {
  delete store()[STATE_KEY];
}

function refuse(code: FixkitError['code'], message: string, options: RegisterOptions): PayToState {
  const state: PayToState = { status: 'refused', code };
  store()[STATE_KEY] = state;
  if (options.failHard) throw new FixkitError(code, message);
  return state;
}

/**
 * Call from register() in instrumentation.ts. Runs the environment guard and the mapping checks in
 * the Node.js runtime only. By default a failed check does not throw: it writes the report to
 * standard error and keeps a refused state, so every payment route refuses. failHard throws too.
 */
export function registerPayTo(options: RegisterOptions): PayToState | undefined {
  const env = options.env ?? process.env;
  const runtime = runtimeOf(env);
  // Edge: register() runs there too (spike), but the checks never do; routes refuse with h.
  if (runtime === 'edge') return undefined;
  // Any other value: nothing is stored and nothing is given out; failHard throws q.
  if (runtime !== 'nodejs') {
    if (options.failHard) throw new FixkitError('runtime-refused', T.checkNotRun);
    return undefined;
  }
  const log = options.log ?? stderr;
  try {
    return runChecks(options, env, log);
  } catch (e) {
    if (e instanceof FixkitError && options.failHard) throw e;
    // The checks could not be loaded or run: refuse with q, and keep no detail (it could quote an input).
    try {
      log(T.checkNotRun);
    } catch {
      // The refusal below does not depend on the log working.
    }
    return refuse('check-not-run', T.checkNotRun, options);
  }
}

function runChecks(
  options: RegisterOptions,
  env: Readonly<Record<string, string | undefined>>,
  log: (line: string) => void,
): PayToState {
  const guard = guardEnvironment(env, {
    ...(options.allowNames ? { allowNames: options.allowNames } : {}),
    ...(options.strict !== undefined ? { strict: options.strict } : {}),
  });
  for (const line of guard.lines) log(line);
  if (guard.refuse) {
    log(T.fallbackRefused);
    return refuse('environment-refused', T.fallbackRefused, options);
  }
  const { xpub, env: _env, failHard: _failHard, log: _log, allowNames: _allow, ...managerOptions } = options;
  try {
    const manager = createPayToManager({ ...managerOptions, xpub: xpub ?? env[XPUB_VARIABLE] ?? '' });
    if (manager.validation.exitCode === 2) {
      log(T.mappingUnverified);
      log(manager.validation.text);
    }
    const state: PayToState = { status: 'ready', manager };
    store()[STATE_KEY] = state;
    return state;
  } catch (e) {
    if (e instanceof FixkitError && e.code === 'mapping-refused') {
      log(T.startupStopped);
      log((e as FixkitError & { report?: string }).report ?? '');
      return refuse('mapping-refused', T.startupStopped, options);
    }
    if (e instanceof FixkitError) {
      log(e.message);
      log(T.fallbackRefused);
      return refuse(e.code, T.fallbackRefused, options);
    }
    if (e instanceof EvmInputError) {
      log(`${XPUB_VARIABLE}: ${e.message}`);
      log(T.fallbackRefused);
      return refuse('xpub-refused', T.fallbackRefused, options);
    }
    // Anything unexpected means the checks did not run to the end: registerPayTo refuses with q.
    throw e;
  }
}

/**
 * The checked manager, for route handlers. In the Edge runtime it always refuses. If start-up
 * did not run (for example register() is not wired), it runs the same checks now when given the
 * options, and refuses otherwise. It never gives out an address from an unchecked mapping.
 */
export function getPayToManager(options?: RegisterOptions): PayToManager {
  const env = options?.env ?? process.env;
  const runtime = runtimeOf(env);
  if (runtime === 'edge') throw new FixkitError('edge-runtime', T.startupSkipped);
  // Any other runtime value: the checks are not run there, so nothing is given out (q).
  if (runtime !== 'nodejs') throw new FixkitError('runtime-refused', T.checkNotRun);
  let state = payToState();
  if (!state && !options) throw new FixkitError('not-configured', T.notConfigured);
  if (!state && options) {
    try {
      state = registerPayTo({ ...options, failHard: false });
    } catch {
      state = { status: 'refused', code: 'check-not-run' };
    }
  }
  if (state?.status === 'ready') return state.manager;
  // q when the checks could not run; j only for a check that ran and failed.
  if (!state || state.code === 'check-not-run') throw new FixkitError('check-not-run', T.checkNotRun);
  throw new FixkitError('start-up-refused', T.fallbackRefused);
}

/** Shorthand for getPayToManager(options).payToFor(request). */
export const payToFor = (request: PayToRequest, options?: RegisterOptions): string =>
  getPayToManager(options).payToFor(request);
