// fundBuyer against a fake anvil: a small Node script written at run time into a temporary folder
// outside the repo, started by startChain with only PATH=/usr/bin:/bin. The fake listens on
// 127.0.0.1:18549 only, ignores any fork URL and never connects anywhere. It answers the funding
// calls with canned replies, keeps a pretend balance and supply, and logs every request body (method
// and params) to a file in its temporary folder. Every start is stopped and the folder removed after
// each test and at the end, even when a test fails. This proves what fundBuyer sends, in what order,
// and when it refuses; it says nothing about a real token, a real chain or a real network.
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { FUND_RECEIPT_TRIES } from '../src/fund.js';
import {
  type ChainProcess,
  FUND_SELECTORS,
  FUND_USDC_ADDRESS,
  fundBuyer,
  MAX_USDC_UNITS,
  startChain,
} from '../src/index.js';

const PORT = 18549;
const FORK = `https://rpc-${randomBytes(4).toString('hex')}.example.test/`;
const REPO = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');
const START_SUPPLY = 1_000_000_000n;
type Mode =
  | 'ok'
  | 'paused'
  | 'blacklisted'
  | 'send-error'
  | 'no-effect'
  | 'stop-error'
  | 'send-and-stop-error'
  | 'receipt-late'
  | 'receipt-never'
  | 'receipt-failed'
  | 'receipt-malformed'
  | 'receipt-realistic';
type Entry = { method: string; params: unknown[] };

let dir = '';
const running: ChainProcess[] = [];
const address = () => `0x${randomBytes(20).toString('hex')}`;
const pad = (hex: string) => hex.toLowerCase().replace(/^0x/, '').padStart(64, '0');

const portRefuses = (port: number) =>
  new Promise<boolean>((resolve) => {
    const s = createConnection({ host: '127.0.0.1', port });
    s.once('connect', () => {
      s.destroy();
      resolve(false);
    });
    s.once('error', () => resolve(true));
  });

/** Writes the fake for one mode, with its own masterMinter address and log file. */
function fake(mode: Mode): { bin: string; log: string; master: string } {
  const tag = randomBytes(4).toString('hex');
  const bin = join(dir, `fake-anvil-fund-${mode}-${tag}`);
  const log = join(dir, `log-${mode}-${tag}.jsonl`);
  const master = address();
  const script = `#!${process.execPath}
// fake anvil begins
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const MODE = ${JSON.stringify(mode)};
const LOG = ${JSON.stringify(log)};
const MASTER = ${JSON.stringify(master)};
const args = process.argv.slice(2);
const flag = (f) => { const i = args.indexOf(f); return i === -1 ? null : args[i + 1]; };
let supply = ${START_SUPPLY}n;
const balances = new Map();
let impersonating = null;
let asked = 0;
const word = (n) => '0x' + n.toString(16).padStart(64, '0');
const reply = (res, id, body) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(Object.assign({ jsonrpc: '2.0', id }, body)));
};
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    let msg = {};
    try { msg = JSON.parse(body); } catch {}
    fs.appendFileSync(LOG, JSON.stringify({ method: msg.method, params: msg.params }) + '\\n');
    const p = msg.params || [];
    if (msg.method === 'eth_chainId') return reply(res, msg.id, { result: '0x14a34' });
    if (msg.method === 'eth_call') {
      const data = String((p[0] && p[0].data) || '');
      const sel = data.slice(0, 10);
      if (sel === '0x35d99f35') return reply(res, msg.id, { result: '0x' + MASTER.slice(2).padStart(64, '0') });
      if (sel === '0x5c975abb') return reply(res, msg.id, { result: word(MODE === 'paused' ? 1n : 0n) });
      if (sel === '0xfe575a87') return reply(res, msg.id, { result: word(MODE === 'blacklisted' ? 1n : 0n) });
      if (sel === '0x18160ddd') return reply(res, msg.id, { result: word(supply) });
      if (sel === '0x70a08231') return reply(res, msg.id, { result: word(balances.get(data.slice(-40)) || 0n) });
      return reply(res, msg.id, { error: { code: -32000, message: 'unknown call' } });
    }
    if (msg.method === 'anvil_setBalance') return reply(res, msg.id, { result: true });
    if (msg.method === 'anvil_impersonateAccount') {
      impersonating = String(p[0]).toLowerCase();
      return reply(res, msg.id, { result: true });
    }
    if (msg.method === 'anvil_stopImpersonatingAccount') {
      if (MODE === 'stop-error' || MODE === 'send-and-stop-error') {
        return reply(res, msg.id, { error: { code: -32005, message: 'refused' } });
      }
      impersonating = null;
      return reply(res, msg.id, { result: true });
    }
    if (msg.method === 'eth_sendTransaction') {
      const tx = p[0] || {};
      if (MODE === 'send-error' || MODE === 'send-and-stop-error') {
        return reply(res, msg.id, { error: { code: -32003, message: 'refused' } });
      }
      if (String(tx.from).toLowerCase() !== impersonating) return reply(res, msg.id, { error: { code: -32004, message: 'no' } });
      asked = 0;
      const data = String(tx.data);
      if (data.startsWith('0x40c10f19') && MODE !== 'no-effect') {
        const to = data.slice(34, 74);
        const amount = BigInt('0x' + data.slice(74));
        balances.set(to, (balances.get(to) || 0n) + amount);
        supply += amount;
      }
      return reply(res, msg.id, { result: '0x' + 'ab'.repeat(32) });
    }
    if (msg.method === 'eth_getTransactionReceipt') {
      asked += 1;
      if (MODE === 'receipt-never') return reply(res, msg.id, { result: null });
      if (MODE === 'receipt-late' && asked <= 2) return reply(res, msg.id, { result: null });
      if (MODE === 'receipt-failed') return reply(res, msg.id, { result: { status: '0x0' } });
      if (MODE === 'receipt-malformed') return reply(res, msg.id, { result: { blockNumber: '0x1' } });
      if (MODE === 'receipt-realistic') {
        return reply(res, msg.id, {
          result: {
            type: '0x2',
            status: '0x1',
            cumulativeGasUsed: '0x1358d',
            logs: [{ address: '0x036cbd53842c5426634e7929541ec2318f3dcf7e', topics: ['0x' + 'cd'.repeat(32)], data: '0x' + '00'.repeat(32), blockHash: '0x' + 'ef'.repeat(32), blockNumber: '0x3ca1f48', transactionHash: p[0], transactionIndex: '0x0', logIndex: '0x0', removed: false }],
            logsBloom: '0x' + '00'.repeat(256),
            transactionHash: p[0],
            transactionIndex: '0x0',
            blockHash: '0x' + 'ef'.repeat(32),
            blockNumber: '0x3ca1f48',
            gasUsed: '0x1358d',
            effectiveGasPrice: '0x3b9aca00',
            from: impersonating,
            to: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
            contractAddress: null,
            l1GasPrice: '0x1',
            l1GasUsed: '0x640',
            l1Fee: '0x640',
            l1BaseFeeScalar: '0x1',
            l1BlobBaseFee: '0x1',
            l1BlobBaseFeeScalar: '0x1',
            depositNonce: null,
            depositReceiptVersion: null,
          },
        });
      }
      return reply(res, msg.id, { result: { status: '0x1' } });
    }
    return reply(res, msg.id, { error: { code: -32601, message: 'not found' } });
  });
});
server.listen(Number(flag('--port')), '127.0.0.1');
process.on('SIGTERM', () => { server.close(); process.exit(0); });
// fake anvil ends
`;
  writeFileSync(bin, script);
  chmodSync(bin, 0o755);
  return { bin, log, master };
}

const entries = (log: string): Entry[] =>
  existsSync(log)
    ? readFileSync(log, 'utf8')
        .split('\n')
        .filter((l) => l !== '')
        .map((l) => JSON.parse(l) as Entry)
    : [];

async function startFork(bin: string): Promise<ChainProcess> {
  const r = await startChain({ binaryPath: bin, port: PORT, forkUrl: FORK, forkBlock: 123, allowedForkUrls: [FORK] });
  if (!r.ok) throw new Error(r.reason);
  running.push(r);
  return r;
}

beforeAll(async () => {
  expect(await portRefuses(PORT)).toBe(true);
  dir = mkdtempSync(join(tmpdir(), 'dabsproof-fake-anvil-fund-'));
  expect(dir.startsWith(`${REPO}/`)).toBe(false);
});

afterEach(async () => {
  for (const c of running.splice(0)) await c.stop();
});

afterAll(async () => {
  for (const c of running.splice(0)) await c.stop();
  if (dir !== '') rmSync(dir, { recursive: true, force: true });
});

describe('fundBuyer against a fake anvil on 127.0.0.1:18549 (no fork is contacted)', () => {
  it('funds the buyer through the masterMinter with exactly these requests, in this order', async () => {
    const { bin, log, master } = fake('ok');
    const chain = await startFork(bin);
    expect(chain.fork).toBe(true);
    const before = entries(log).length;
    const buyer = address();
    const relayer = address();
    const units = 5_000_000n;
    const ethWei = 3n * 10n ** 17n;
    const r = await fundBuyer({ chain, buyer, relayer, usdcUnits: units, relayerEthWei: ethWei });
    expect(r).toEqual({
      ok: true,
      masterMinter: master,
      minted: units,
      buyerBalance: units,
      totalSupply: START_SUPPLY + units,
    });
    const call = (data: string) => ({ method: 'eth_call', params: [{ to: FUND_USDC_ADDRESS, data }, 'latest'] });
    const send = (data: string) => ({
      method: 'eth_sendTransaction',
      params: [{ from: master, to: FUND_USDC_ADDRESS, data }],
    });
    const receipt = { method: 'eth_getTransactionReceipt', params: [`0x${'ab'.repeat(32)}`] };
    expect(entries(log).slice(before)).toEqual([
      { method: 'eth_chainId', params: [] },
      call(FUND_SELECTORS.masterMinter),
      call(FUND_SELECTORS.paused),
      call(`${FUND_SELECTORS.isBlacklisted}${pad(buyer)}`),
      call(FUND_SELECTORS.totalSupply),
      call(`${FUND_SELECTORS.balanceOf}${pad(buyer)}`),
      { method: 'anvil_setBalance', params: [relayer, `0x${ethWei.toString(16)}`] },
      { method: 'anvil_setBalance', params: [master, `0x${(10n ** 17n).toString(16)}`] },
      { method: 'anvil_impersonateAccount', params: [master] },
      send(`${FUND_SELECTORS.configureMinter}${pad(master)}${pad(units.toString(16))}`),
      receipt,
      send(`${FUND_SELECTORS.mint}${pad(buyer)}${pad(units.toString(16))}`),
      receipt,
      { method: 'anvil_stopImpersonatingAccount', params: [master] },
      call(`${FUND_SELECTORS.balanceOf}${pad(buyer)}`),
      call(FUND_SELECTORS.totalSupply),
    ]);
    // Only the address the chain named as masterMinter is impersonated or sent from.
    const after = entries(log).slice(before);
    for (const e of after.filter((x) => x.method.includes('mpersonat'))) expect(e.params).toEqual([master]);
    for (const e of after.filter((x) => x.method === 'eth_sendTransaction')) {
      expect((e.params[0] as { from: string }).from).toBe(master);
    }
    // The buyer gets USDC only: no balance is set for the buyer.
    expect(after.filter((x) => x.method === 'anvil_setBalance' && x.params[0] === buyer)).toEqual([]);
  });

  it('the 10 USDC cap holds across calls on one chain, refused before anything is sent', async () => {
    const { bin, log } = fake('ok');
    const chain = await startFork(bin);
    const buyer = address();
    const first = await fundBuyer({ chain, buyer, relayer: address(), usdcUnits: MAX_USDC_UNITS, relayerEthWei: 1n });
    expect(first.ok).toBe(true);
    const before = entries(log).length;
    expect(await fundBuyer({ chain, buyer, relayer: address(), usdcUnits: 1n, relayerEthWei: 1n })).toEqual({
      ok: false,
      reason: 'usdc-over-cap',
    });
    expect(entries(log).length).toBe(before);
  });

  it('a paused token is refused before any balance, impersonation or mint', async () => {
    const { bin, log } = fake('paused');
    const chain = await startFork(bin);
    const before = entries(log).length;
    expect(await fundBuyer({ chain, buyer: address(), relayer: address(), usdcUnits: 1n, relayerEthWei: 1n })).toEqual({
      ok: false,
      reason: 'token-paused',
      step: 'paused',
    });
    const methods = entries(log)
      .slice(before)
      .map((e) => e.method);
    expect(methods).toEqual(['eth_chainId', 'eth_call', 'eth_call']);
  });

  it('a blacklisted buyer is refused before any balance, impersonation or mint', async () => {
    const { bin, log } = fake('blacklisted');
    const chain = await startFork(bin);
    const before = entries(log).length;
    expect(await fundBuyer({ chain, buyer: address(), relayer: address(), usdcUnits: 1n, relayerEthWei: 1n })).toEqual({
      ok: false,
      reason: 'buyer-blacklisted',
      step: 'isBlacklisted',
    });
    const methods = entries(log)
      .slice(before)
      .map((e) => e.method);
    expect(methods).toEqual(['eth_chainId', 'eth_call', 'eth_call', 'eth_call']);
  });

  it('a failed transaction still ends the impersonation', async () => {
    const { bin, log, master } = fake('send-error');
    const chain = await startFork(bin);
    const before = entries(log).length;
    expect(await fundBuyer({ chain, buyer: address(), relayer: address(), usdcUnits: 1n, relayerEthWei: 1n })).toEqual({
      ok: false,
      reason: 'request-failed',
      step: 'eth_sendTransaction',
    });
    const after = entries(log).slice(before);
    const methods = after.map((e) => e.method);
    expect(methods.slice(-3)).toEqual([
      'anvil_impersonateAccount',
      'eth_sendTransaction',
      'anvil_stopImpersonatingAccount',
    ]);
    expect(after.at(-1)?.params).toEqual([master]);
  });

  it('a failed stop after a successful mint is reported with its own reason code, and nothing is read after it', async () => {
    const { bin, log, master } = fake('stop-error');
    const chain = await startFork(bin);
    const before = entries(log).length;
    expect(await fundBuyer({ chain, buyer: address(), relayer: address(), usdcUnits: 1n, relayerEthWei: 1n })).toEqual({
      ok: false,
      reason: 'stop-impersonation-failed',
      step: 'anvil_stopImpersonatingAccount',
    });
    const after = entries(log).slice(before);
    expect(after.map((e) => e.method).slice(-5)).toEqual([
      'eth_sendTransaction',
      'eth_getTransactionReceipt',
      'eth_sendTransaction',
      'eth_getTransactionReceipt',
      'anvil_stopImpersonatingAccount',
    ]);
    expect(after.at(-1)?.params).toEqual([master]);
  });

  it('when a transaction and then the stop both fail, the earlier failure is the one reported', async () => {
    const { bin, log, master } = fake('send-and-stop-error');
    const chain = await startFork(bin);
    const before = entries(log).length;
    expect(await fundBuyer({ chain, buyer: address(), relayer: address(), usdcUnits: 1n, relayerEthWei: 1n })).toEqual({
      ok: false,
      reason: 'request-failed',
      step: 'eth_sendTransaction',
    });
    const after = entries(log).slice(before);
    expect(after.map((e) => e.method).slice(-3)).toEqual([
      'anvil_impersonateAccount',
      'eth_sendTransaction',
      'anvil_stopImpersonatingAccount',
    ]);
    expect(after.at(-1)?.params).toEqual([master]);
  });

  it('a balance or supply that does not move by the amount gives read-back-mismatch', async () => {
    const { bin, log } = fake('no-effect');
    const chain = await startFork(bin);
    const before = entries(log).length;
    expect(await fundBuyer({ chain, buyer: address(), relayer: address(), usdcUnits: 1n, relayerEthWei: 1n })).toEqual({
      ok: false,
      reason: 'read-back-mismatch',
      step: 'read-back',
    });
    expect(
      entries(log)
        .slice(before)
        .some((e) => e.method === 'anvil_stopImpersonatingAccount'),
    ).toBe(true);
  });

  it('a receipt that is not there for the first 2 tries is waited for, and funding succeeds', async () => {
    const { bin, log } = fake('receipt-late');
    const chain = await startFork(bin);
    const before = entries(log).length;
    const r = await fundBuyer({ chain, buyer: address(), relayer: address(), usdcUnits: 1n, relayerEthWei: 1n });
    expect(r.ok).toBe(true);
    const methods = entries(log)
      .slice(before)
      .map((e) => e.method);
    const receipts = (from: number) => {
      let n = 0;
      for (let i = from + 1; i < methods.length && methods[i] === 'eth_getTransactionReceipt'; i++) n++;
      return n;
    };
    const sends = methods.flatMap((m, i) => (m === 'eth_sendTransaction' ? [i] : []));
    expect(sends.length).toBe(2);
    expect(sends.map(receipts)).toEqual([3, 3]);
  });

  it('a receipt that never comes gives receipt-missing after the last try, the stop is still sent, and nothing after it', async () => {
    const { bin, log, master } = fake('receipt-never');
    const chain = await startFork(bin);
    const before = entries(log).length;
    const t0 = Date.now();
    expect(await fundBuyer({ chain, buyer: address(), relayer: address(), usdcUnits: 1n, relayerEthWei: 1n })).toEqual({
      ok: false,
      reason: 'receipt-missing',
      step: 'configureMinter',
    });
    expect(Date.now() - t0 >= (FUND_RECEIPT_TRIES - 1) * 200 - 50).toBe(true);
    const after = entries(log).slice(before);
    expect(after.map((e) => e.method).slice(-(FUND_RECEIPT_TRIES + 3))).toEqual([
      'anvil_impersonateAccount',
      'eth_sendTransaction',
      ...Array.from({ length: FUND_RECEIPT_TRIES }, () => 'eth_getTransactionReceipt'),
      'anvil_stopImpersonatingAccount',
    ]);
    expect(after.at(-1)?.params).toEqual([master]);
  });

  it('a receipt with status 0x0 gives transaction-failed at once: asked about once, never again', async () => {
    const { bin, log } = fake('receipt-failed');
    const chain = await startFork(bin);
    const before = entries(log).length;
    expect(await fundBuyer({ chain, buyer: address(), relayer: address(), usdcUnits: 1n, relayerEthWei: 1n })).toEqual({
      ok: false,
      reason: 'transaction-failed',
      step: 'configureMinter',
    });
    const methods = entries(log)
      .slice(before)
      .map((e) => e.method);
    expect(methods.slice(-3)).toEqual([
      'eth_sendTransaction',
      'eth_getTransactionReceipt',
      'anvil_stopImpersonatingAccount',
    ]);
    expect(methods.filter((m) => m === 'eth_getTransactionReceipt').length).toBe(1);
  });

  it('a receipt with no status gives receipt-malformed, asked about once', async () => {
    const { bin, log } = fake('receipt-malformed');
    const chain = await startFork(bin);
    const before = entries(log).length;
    expect(await fundBuyer({ chain, buyer: address(), relayer: address(), usdcUnits: 1n, relayerEthWei: 1n })).toEqual({
      ok: false,
      reason: 'receipt-malformed',
      step: 'configureMinter',
    });
    const methods = entries(log)
      .slice(before)
      .map((e) => e.method);
    expect(methods.slice(-3)).toEqual([
      'eth_sendTransaction',
      'eth_getTransactionReceipt',
      'anvil_stopImpersonatingAccount',
    ]);
  });

  it('a receipt in a realistic shape, with logs, fees and the extra fields of an OP-stack chain, succeeds', async () => {
    const { bin } = fake('receipt-realistic');
    const chain = await startFork(bin);
    const units = 2_000_000n;
    const r = await fundBuyer({ chain, buyer: address(), relayer: address(), usdcUnits: units, relayerEthWei: 1n });
    expect(r.ok && r.minted).toBe(units);
  });

  it('the receipt wait stays within its budget, and the funding route stays at 14 requests', async () => {
    const { bin, log } = fake('receipt-never');
    const chain = await startFork(bin);
    const before = entries(log).length;
    await fundBuyer({ chain, buyer: address(), relayer: address(), usdcUnits: 1n, relayerEthWei: 1n });
    const receiptCount = entries(log)
      .slice(before)
      .filter((e) => e.method === 'eth_getTransactionReceipt').length;
    expect(receiptCount).toBe(FUND_RECEIPT_TRIES);
    expect(2 * FUND_RECEIPT_TRIES <= 20).toBe(true);
    // Both fakes use the one port, so the first is stopped before the second starts.
    await chain.stop();
    // A full success on the funding route, without its receipts: 14 of the 20 allowed.
    const ok = fake('ok');
    const okChain = await startFork(ok.bin);
    const okBefore = entries(ok.log).length;
    expect(
      (await fundBuyer({ chain: okChain, buyer: address(), relayer: address(), usdcUnits: 1n, relayerEthWei: 1n })).ok,
    ).toBe(true);
    const okEntries = entries(ok.log).slice(okBefore);
    expect(okEntries.filter((e) => e.method !== 'eth_getTransactionReceipt').length).toBe(14);
    expect(okEntries.filter((e) => e.method === 'eth_getTransactionReceipt').length).toBe(2);
  });

  it('nothing at all is sent for a chain that was not started as a fork', async () => {
    const { bin, log } = fake('ok');
    const r = await startChain({ binaryPath: bin, port: PORT });
    if (!r.ok) throw new Error(r.reason);
    running.push(r);
    expect(r.fork).toBe(false);
    const before = entries(log).length;
    expect(
      await fundBuyer({ chain: r, buyer: address(), relayer: address(), usdcUnits: 1n, relayerEthWei: 1n }),
    ).toEqual({
      ok: false,
      reason: 'not-a-fork',
    });
    expect(entries(log).length).toBe(before);
  });
});
