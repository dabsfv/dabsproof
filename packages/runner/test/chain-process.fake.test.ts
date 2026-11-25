// startChain and stop() against a fake anvil: a small Node script written at run time into a
// temporary folder outside the repo, started with only PATH=/usr/bin:/bin (its first line names the
// running Node by full path). The fake listens on 127.0.0.1:18546 only, answers eth_chainId, ignores
// any fork URL and never connects anywhere, and on a normal termination writes "{}" to the dump path
// if one was given. Every start is stopped and the temporary folder removed after each test and at
// the end, even when a test fails. This proves what startChain passes and how it waits and stops; it
// says nothing about what real anvil does with a fork, a saved state or the network, which could not
// be verified here.
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type ChainProcess, MAX_LOAD_STATE_BYTES, startChain } from '../src/chain-process.js';

const PORT = 18546;
const FORK = `https://rpc-${randomBytes(4).toString('hex')}.example.test/`;
const REPO = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');
type Mode = 'ready' | 'wrong-chain' | 'ignore-term' | 'exit-early';

let dir = '';
let state = '';
const running: ChainProcess[] = [];

/** True if nothing accepts a connection on 127.0.0.1 at this port. */
const portRefuses = (port: number) =>
  new Promise<boolean>((resolve) => {
    const s = createConnection({ host: '127.0.0.1', port });
    s.once('connect', () => {
      s.destroy();
      resolve(false);
    });
    s.once('error', () => resolve(true));
  });

/** Writes the fake anvil for one mode into the temporary folder and returns its path. */
function fake(mode: Mode): { bin: string; argsFile: string } {
  const bin = join(dir, `fake-anvil-${mode}`);
  const argsFile = join(dir, `args-${mode}.json`);
  const script = `#!${process.execPath}
// fake anvil begins
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const MODE = ${JSON.stringify(mode)};
const args = process.argv.slice(2);
const flag = (f) => { const i = args.indexOf(f); return i === -1 ? null : args[i + 1]; };
fs.writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(args));
if (MODE === 'exit-early') process.exit(3);
if (flag('--host') !== '127.0.0.1') process.exit(4);
const load = flag('--load-state');
if (load !== null && !fs.existsSync(load)) process.exit(5);
const dump = flag('--dump-state');
const chainId = MODE === 'wrong-chain' ? '0x1' : '0x14a34';
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    let id = null;
    try { id = JSON.parse(body).id; } catch {}
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id, result: chainId }));
  });
});
server.listen(Number(flag('--port')), '127.0.0.1');
process.on('SIGTERM', () => {
  if (MODE === 'ignore-term') return;
  if (dump !== null) fs.writeFileSync(dump, '{}');
  server.close();
  process.exit(0);
});
// fake anvil ends
`;
  writeFileSync(bin, script);
  chmodSync(bin, 0o755);
  return { bin, argsFile };
}
const argsOf = (argsFile: string) => JSON.parse(readFileSync(argsFile, 'utf8')) as string[];
const forkInputs = () => ({ forkUrl: FORK, forkBlock: 123, allowedForkUrls: [FORK] });

beforeAll(async () => {
  expect(await portRefuses(PORT)).toBe(true);
  dir = mkdtempSync(join(tmpdir(), 'dabsproof-fake-anvil-'));
  // The temporary folder must lie outside the repo.
  expect(dir.startsWith(`${REPO}/`)).toBe(false);
});

afterEach(async () => {
  for (const c of running.splice(0)) await c.stop();
  if (state !== '') rmSync(state, { recursive: true, force: true });
  state = join(dir, `state-${randomBytes(4).toString('hex')}`);
  mkdirSync(state);
});

afterAll(async () => {
  for (const c of running.splice(0)) await c.stop();
  if (dir !== '') rmSync(dir, { recursive: true, force: true });
});

describe('startChain against a fake anvil on 127.0.0.1:18546 (no fork is contacted)', () => {
  beforeAll(() => {
    state = join(dir, `state-${randomBytes(4).toString('hex')}`);
    mkdirSync(state);
  });

  it('a validated fork run that writes its state passes exactly those arguments, and stop() waits for the file', async () => {
    const { bin, argsFile } = fake('ready');
    const dump = join(state, 'run.anvil-state.json');
    const r = await startChain({
      binaryPath: bin,
      port: PORT,
      ...forkInputs(),
      stateDir: state,
      repoRoot: REPO,
      dumpStatePath: dump,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    running.push(r);
    expect(argsOf(argsFile)).toEqual([
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
      '123',
      '--no-fork-node-info',
      '--dump-state',
      dump,
    ]);
    const stopped = await r.stop();
    expect(stopped).toEqual({ exited: true, forced: false, portClosed: true, dumpWritten: true });
    // Checked by metadata only, as stop() does.
    expect(lstatSync(dump).isFile()).toBe(true);
    expect(lstatSync(dump).size > 0).toBe(true);
  });

  it('an offline start from a saved state passes --load-state and no fork argument', async () => {
    const { bin, argsFile } = fake('ready');
    const load = join(state, 'saved.json');
    writeFileSync(load, '{}');
    const r = await startChain({ binaryPath: bin, port: PORT, stateDir: state, repoRoot: REPO, loadStatePath: load });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    running.push(r);
    const args = argsOf(argsFile);
    expect(args.slice(-2)).toEqual(['--load-state', load]);
    expect(args.includes('--fork-url')).toBe(false);
    expect(await r.stop()).toEqual({ exited: true, forced: false, portClosed: true });
  });

  it('a wrong chain id is refused and the process is stopped', async () => {
    const { bin } = fake('wrong-chain');
    expect(await startChain({ binaryPath: bin, port: PORT })).toEqual({ ok: false, reason: 'chain-id-mismatch' });
    expect(await portRefuses(PORT)).toBe(true);
  });

  it('a process that exits before answering gives exited-early', async () => {
    const { bin } = fake('exit-early');
    expect(await startChain({ binaryPath: bin, port: PORT })).toEqual({ ok: false, reason: 'exited-early' });
    expect(await portRefuses(PORT)).toBe(true);
  });

  it('a process that ignores the termination signal is killed by force and its port is closed', async () => {
    const { bin } = fake('ignore-term');
    const r = await startChain({ binaryPath: bin, port: PORT });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    running.push(r);
    expect(await r.stop()).toEqual({ exited: true, forced: true, portClosed: true });
  }, 20_000);

  it('state folder problems are refused by metadata before anything starts', async () => {
    const { bin } = fake('ready');
    const missing = join(dir, 'no-such-folder');
    expect(
      await startChain({
        binaryPath: bin,
        port: PORT,
        ...forkInputs(),
        stateDir: missing,
        repoRoot: REPO,
        dumpStatePath: join(missing, 'x.json'),
      }),
    ).toEqual({ ok: false, reason: 'state-dir-not-found' });
    const plain = join(dir, 'plain-file');
    writeFileSync(plain, '');
    expect(
      await startChain({
        binaryPath: bin,
        port: PORT,
        ...forkInputs(),
        stateDir: plain,
        repoRoot: REPO,
        dumpStatePath: join(plain, 'x.json'),
      }),
    ).toEqual({ ok: false, reason: 'state-dir-not-folder' });
    // Only the state folder itself is checked for a link; folders above it could not be verified here.
    const linked = join(dir, `state-link-${randomBytes(4).toString('hex')}`);
    symlinkSync(state, linked);
    expect(
      await startChain({
        binaryPath: bin,
        port: PORT,
        ...forkInputs(),
        stateDir: linked,
        repoRoot: REPO,
        dumpStatePath: join(linked, 'x.json'),
      }),
    ).toEqual({ ok: false, reason: 'state-path-is-link' });
    const exists = join(state, 'exists.json');
    writeFileSync(exists, '{}');
    expect(
      await startChain({
        binaryPath: bin,
        port: PORT,
        ...forkInputs(),
        stateDir: state,
        repoRoot: REPO,
        dumpStatePath: exists,
      }),
    ).toEqual({ ok: false, reason: 'dump-state-exists' });
    expect(await portRefuses(PORT)).toBe(true);
  });

  it('saved state problems are refused by metadata before anything starts', async () => {
    const { bin } = fake('ready');
    const base = { binaryPath: bin, port: PORT, stateDir: state, repoRoot: REPO };
    expect(await startChain({ ...base, loadStatePath: join(state, 'missing.json') })).toEqual({
      ok: false,
      reason: 'load-state-not-found',
    });
    const folder = join(state, 'folder.json');
    mkdirSync(folder);
    expect(await startChain({ ...base, loadStatePath: folder })).toEqual({ ok: false, reason: 'load-state-not-file' });
    // Only the state file itself is checked for a link; folders above it could not be verified here.
    const real = join(state, 'real.json');
    writeFileSync(real, '{}');
    const link = join(state, 'link.json');
    symlinkSync(real, link);
    expect(await startChain({ ...base, loadStatePath: link })).toEqual({ ok: false, reason: 'state-path-is-link' });
    // A sparse file one byte over the cap: its size is read from metadata, its contents never.
    const big = join(state, 'big.json');
    writeFileSync(big, '');
    truncateSync(big, MAX_LOAD_STATE_BYTES + 1);
    expect(await startChain({ ...base, loadStatePath: big })).toEqual({ ok: false, reason: 'load-state-too-large' });
    expect(await portRefuses(PORT)).toBe(true);
  });
});
