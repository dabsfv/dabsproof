// End-to-end: starts a real anvil on 127.0.0.1:18545 (no fork), checks it, and stops it. It runs only
// when DABSPROOF_ANVIL_BIN names the binary on the command line; otherwise every test here is skipped
// with the reason "no anvil binary path given". The path is never looked for in HOME or anywhere else.
// One start for this whole file, on port 18545 only. Nothing anvil prints is read, kept or shown.
import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkTarget, RequestBudget, sendLocalJson, startChain } from '../src/index.ts';

const BIN = process.env.DABSPROOF_ANVIL_BIN;
const PORT = 18545;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const run = typeof BIN === 'string' && BIN !== '' ? describe : describe.skip;

/** The addresses listening on this port, from lsof; an empty list if none. */
const listeners = (port) => {
  try {
    return execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .slice(1)
      .map((l) => l.trim().split(/\s+/)[8]);
  } catch {
    return [];
  }
};
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

let chain;
let readyMs;

run(BIN ? 'the local chain on 127.0.0.1:18545' : 'no anvil binary path given', () => {
  beforeAll(async () => {
    expect(listeners(PORT)).toEqual([]);
    const t0 = Date.now();
    const r = await startChain({ binaryPath: BIN, port: PORT });
    readyMs = Date.now() - t0;
    if (!r.ok) throw new Error(`chain-not-started: ${r.reason}`);
    chain = r;
  }, 20_000);

  afterAll(async () => {
    if (chain) await chain.stop();
  }, 20_000);

  it('answers eth_chainId with 0x14a34 (84532)', async () => {
    const target = checkTarget(ORIGIN, { local: true });
    expect(target.ok).toBe(true);
    const r = await sendLocalJson(target.target, new RequestBudget({ requestsPerRoute: 1, burst: 1 }), 'check', '/', {
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_chainId',
      params: [],
    });
    expect(r.ok && r.status).toBe(200);
    expect(JSON.parse(Buffer.from(r.body).toString('utf8')).result).toBe('0x14a34');
    expect(readyMs < 10_000).toBe(true);
  });

  it('listens on 127.0.0.1:18545 only', () => {
    expect(listeners(PORT)).toEqual([`127.0.0.1:${PORT}`]);
  });

  it('stops by its process ID: no forced kill, the port is closed and no child is left', async () => {
    const t0 = Date.now();
    const stopped = await chain.stop();
    const stopMs = Date.now() - t0;
    expect(stopped).toEqual({ exited: true, forced: false, portClosed: true });
    expect(listeners(PORT)).toEqual([]);
    expect(alive(chain.pid)).toBe(false);
    // A second stop is harmless and gives the same result.
    expect(await chain.stop()).toEqual(stopped);
    console.log(
      `chain e2e timings: ready ${readyMs} ms, stop ${stopMs} ms, forced kill: ${stopped.forced ? 'yes' : 'no'}`,
    );
  });
});
