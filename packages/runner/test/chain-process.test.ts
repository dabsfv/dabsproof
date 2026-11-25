// Unit tests for starting the local chain. No process is started here: every input below is refused
// before anything starts, or only builds the launch object, and the readiness timing runs on a fake
// clock. The binary path and every state path are only strings; the fork URL is a made-up name on a
// .test domain. These tests say nothing about anvil's own behaviour.
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { pollUntilReady, READY_PLANS, type ReadyTry } from '../src/chain-process.js';
import { CHAIN_CHILD_ENV, chainLaunch, RequestBudget, startChain } from '../src/index.js';

const tag = () => randomBytes(4).toString('hex');
const BINARY = `/fake-${tag()}/bin/anvil`;
const FORK = `https://rpc-${tag()}.example.test/`;
const ROOT = `/fake-${tag()}`;
const reasonOf = (input: Parameters<typeof chainLaunch>[0]) => {
  const r = chainLaunch(input);
  return r.ok ? 'ok' : r.reason;
};

/** A clock that moves only when the code under test sleeps, so 30 s pass at once. */
function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe('starting the local chain (nothing is started here)', () => {
  it('a fork is refused unless its URL is on the allowed list, which is empty by default', () => {
    expect(reasonOf({ binaryPath: BINARY, port: 18545, forkUrl: FORK, forkBlock: 1 })).toBe('fork-url-not-allowed');
    expect(reasonOf({ binaryPath: BINARY, port: 18545, forkBlock: 1 })).toBe('fork-block-without-fork-url');
    expect(reasonOf({ binaryPath: BINARY, port: 18545, forkUrl: null })).toBe('fork-url-invalid');
  });
  it('refuses port 4319, a port below 1024 and a port that is not whole', () => {
    expect(reasonOf({ binaryPath: BINARY, port: 4319 })).toBe('port-reserved');
    expect(reasonOf({ binaryPath: BINARY, port: 1023 })).toBe('port-invalid');
    expect(reasonOf({ binaryPath: BINARY, port: 18545.5 })).toBe('port-invalid');
    expect(reasonOf({ binaryPath: BINARY, port: undefined })).toBe('port-invalid');
  });
  it('refuses a missing or relative binary path', () => {
    expect(reasonOf({ binaryPath: undefined, port: 18545 })).toBe('binary-path-missing');
    expect(reasonOf({ binaryPath: '', port: 18545 })).toBe('binary-path-missing');
    expect(reasonOf({ binaryPath: 'anvil', port: 18545 })).toBe('binary-path-not-absolute');
    expect(reasonOf({ binaryPath: './bin/anvil', port: 18545 })).toBe('binary-path-not-absolute');
  });
  it('the launch is the binary itself, no shell, no input or output, and an environment of PATH only', () => {
    const r = chainLaunch({ binaryPath: BINARY, port: 18545 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.file).toBe(BINARY);
    expect(r.args).toEqual(['--host', '127.0.0.1', '--port', '18545', '--chain-id', '84532', '--accounts', '0']);
    expect(r.options).toEqual({ env: { PATH: '/usr/bin:/bin' }, stdio: 'ignore', shell: false });
    expect(Object.keys(r.options.env)).toEqual(['PATH']);
    expect(CHAIN_CHILD_ENV).toEqual({ PATH: '/usr/bin:/bin' });
    expect(Object.isFrozen(CHAIN_CHILD_ENV)).toBe(true);
    expect(r.fork).toBe(false);
    expect(r.stateDir).toBe(null);
  });
  it('startChain gives the same refusals before anything is started', async () => {
    expect(await startChain({ binaryPath: BINARY, port: 4319 })).toEqual({ ok: false, reason: 'port-reserved' });
    expect(await startChain({ binaryPath: 'anvil', port: 18545 })).toEqual({
      ok: false,
      reason: 'binary-path-not-absolute',
    });
    expect(await startChain({ binaryPath: BINARY, port: 18545, forkBlock: 7 })).toEqual({
      ok: false,
      reason: 'fork-block-without-fork-url',
    });
  });
  it('a validated fork run that writes its state gets exactly the fork and state arguments', () => {
    const state = `${ROOT}/state`;
    const dump = `${state}/run.json`;
    const r = chainLaunch({
      binaryPath: BINARY,
      port: 18546,
      forkUrl: FORK,
      forkBlock: 123,
      allowedForkUrls: [FORK],
      stateDir: state,
      repoRoot: `${ROOT}/repo`,
      dumpStatePath: dump,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.args).toEqual([
      '--host',
      '127.0.0.1',
      '--port',
      '18546',
      '--chain-id',
      '84532',
      '--accounts',
      '0',
      '--fork-url',
      FORK,
      '--fork-block-number',
      '123',
      '--no-fork-node-info',
      '--no-storage-caching',
      '--retries',
      '0',
      '--timeout',
      '10000',
      '--fork-header',
      'User-Agent: repo-check',
      '--dump-state',
      dump,
    ]);
    expect(r.fork).toBe(true);
    expect(r.stateDir).toBe(state);
    expect(r.dumpStatePath).toBe(dump);
    expect(r.loadStatePath).toBe(null);
    expect(r.options).toEqual({ env: { PATH: '/usr/bin:/bin' }, stdio: 'ignore', shell: false });
  });
});

describe('waiting for the chain to answer (a fake clock; nothing is sent)', () => {
  it('the two plans fit the budget of 20: 10 s every 500 ms, and 30 s every 1500 ms for a fork', () => {
    expect(READY_PLANS.plain).toEqual({ deadlineMs: 10_000, everyMs: 500, maxTries: 20 });
    expect(READY_PLANS.fork).toEqual({ deadlineMs: 30_000, everyMs: 1500, maxTries: 20 });
    expect(READY_PLANS.fork.deadlineMs / READY_PLANS.fork.everyMs).toBe(20);
    expect(READY_PLANS.plain.deadlineMs / READY_PLANS.plain.everyMs).toBe(20);
  });
  it('a fork that never answers gets exactly 20 tries over 30 s, try 20 is the last, and no 21st request is made', async () => {
    const clock = fakeClock();
    const budget = new RequestBudget({ requestsPerRoute: 20, burst: 1 });
    const at: number[] = [];
    const r = await pollUntilReady(
      READY_PLANS.fork,
      async () => {
        at.push(clock.now());
        const slot = budget.begin('chain-ready');
        expect(slot.ok).toBe(true);
        if (slot.ok) slot.release();
        return 'no';
      },
      clock,
    );
    expect(r).toEqual({ result: 'not-ready', tries: 20 });
    expect(at).toEqual(Array.from({ length: 20 }, (_, i) => i * 1500));
    expect(at[19]).toBe(28_500);
    // The budget was used exactly up to its limit: a 21st request would have been refused.
    expect(budget.begin('chain-ready')).toEqual({ ok: false, code: 'route-request-limit' });
  });
  it('without a fork the same holds over 10 s every 500 ms', async () => {
    const clock = fakeClock();
    const at: number[] = [];
    const r = await pollUntilReady(
      READY_PLANS.plain,
      async () => {
        at.push(clock.now());
        return 'no';
      },
      clock,
    );
    expect(r).toEqual({ result: 'not-ready', tries: 20 });
    expect(at[0]).toBe(0);
    expect(at[19]).toBe(9500);
  });
  it('slow tries are cut by the deadline: never a try at or after 30 s', async () => {
    const clock = fakeClock();
    const at: number[] = [];
    const r = await pollUntilReady(
      READY_PLANS.fork,
      async () => {
        at.push(clock.now());
        clock.advance(2500);
        return 'no';
      },
      clock,
    );
    expect(r.result).toBe('not-ready');
    expect(r.tries < 20).toBe(true);
    expect(at.every((t) => t < 30_000)).toBe(true);
  });
  it('stops at the first answer and maps each outcome to its fixed result', async () => {
    const outcomes: Array<[ReadyTry, string]> = [
      ['ready', 'ready'],
      ['mismatch', 'chain-id-mismatch'],
      ['exited', 'exited-early'],
      ['failed', 'start-failed'],
    ];
    for (const [answer, result] of outcomes) {
      const clock = fakeClock();
      let n = 0;
      const r = await pollUntilReady(
        READY_PLANS.fork,
        async () => {
          n++;
          return n < 5 ? 'no' : answer;
        },
        clock,
      );
      expect(r).toEqual({ result, tries: 5 });
      expect(n).toBe(5);
    }
  });
});
