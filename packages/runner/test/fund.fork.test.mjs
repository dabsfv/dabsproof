// Opt-in, against a real fork: funds a made-up buyer with USDC through the token's own mint path on a
// local anvil that forks Base Sepolia at a pinned block. It runs only when BOTH DABSPROOF_FORK_TEST=1
// and DABSPROOF_ANVIL_BIN (the binary's absolute path) are set on the command line; otherwise every
// test here is skipped with the reason "fork test not asked for (needs DABSPROOF_FORK_TEST=1 and
// DABSPROOF_ANVIL_BIN)". CI sets neither. This file holds the one pin request: one batch POST of
// eth_chainId and eth_blockNumber to the public Base Sepolia endpoint, no credentials, no redirect
// followed, a 10 s deadline, the reply read in memory under 64 KiB and nothing saved. The fork starts
// 20 blocks behind the head it reports. The chain listens on 127.0.0.1:18550 only and is always
// stopped. Buyer and relayer are random addresses with no key; nothing is signed and no file is read
// or written. Only the pinned block, the masterMinter address and the amount are printed. This says
// nothing about a real facilitator, real money or mainnet.
import { randomBytes } from 'node:crypto';
import { createConnection } from 'node:net';
import { describe, expect, it } from 'vitest';
import {
  checkTarget,
  FUND_SELECTORS,
  FUND_USDC_ADDRESS,
  fundBuyer,
  MAX_USDC_UNITS,
  RequestBudget,
  sendLocalJson,
  startChain,
} from '../src/index.ts';

const ASKED = process.env.DABSPROOF_FORK_TEST === '1';
const BIN = process.env.DABSPROOF_ANVIL_BIN;
const READY = ASKED && typeof BIN === 'string' && BIN !== '';
const run = READY ? describe : describe.skip;

const FORK_URL = 'https://sepolia.base.org';
const PORT = 18550;
const PIN_DEADLINE_MS = 10_000;
const PIN_MAX_BYTES = 64 * 1024;
const BLOCKS_BEHIND = 20n;
const UNITS = 10_000_000n;

const address = () => `0x${randomBytes(20).toString('hex')}`;
const pad = (hex) => hex.toLowerCase().replace(/^0x/, '').padStart(64, '0');

const portRefuses = (port) =>
  new Promise((resolve) => {
    const s = createConnection({ host: '127.0.0.1', port });
    s.once('connect', () => {
      s.destroy();
      resolve(false);
    });
    s.once('error', () => resolve(true));
  });

/** Reads a reply body in memory, refusing anything over the cap. */
async function readCapped(res, cap) {
  const reader = res.body.getReader();
  const parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > cap) {
      await reader.cancel();
      throw new Error('pin-reply-too-large');
    }
    parts.push(value);
  }
  return Buffer.concat(parts).toString('utf8');
}

/** The one pin request: chain id and head block in one batch, matched by id. */
async function pinBlock() {
  const res = await fetch(FORK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'repo-check' },
    body: JSON.stringify([
      { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] },
      { jsonrpc: '2.0', id: 2, method: 'eth_blockNumber', params: [] },
    ]),
    credentials: 'omit',
    redirect: 'manual',
    signal: AbortSignal.timeout(PIN_DEADLINE_MS),
  });
  if (res.status !== 200) throw new Error(`pin-request-status-${res.status}`);
  const answers = JSON.parse(await readCapped(res, PIN_MAX_BYTES));
  if (!Array.isArray(answers)) throw new Error('pin-reply-not-a-batch');
  const byId = (id) => answers.find((a) => a && a.id === id)?.result;
  const chainId = byId(1);
  const head = byId(2);
  if (typeof chainId !== 'string' || typeof head !== 'string' || !/^0x[0-9a-f]+$/i.test(head)) {
    throw new Error('pin-reply-bad-shape');
  }
  return { chainId: BigInt(chainId), block: BigInt(head) - BLOCKS_BEHIND };
}

run(
  READY
    ? 'funding a buyer on a fork of Base Sepolia at 127.0.0.1:18550'
    : 'fork test not asked for (needs DABSPROOF_FORK_TEST=1 and DABSPROOF_ANVIL_BIN)',
  () => {
    it('mints exactly 10 USDC to a made-up buyer through the masterMinter, then stops the chain', async () => {
      expect(UNITS).toBe(MAX_USDC_UNITS);
      expect(await portRefuses(PORT)).toBe(true);
      const pin = await pinBlock();
      expect(pin.chainId).toBe(84532n);
      expect(pin.block > 0n).toBe(true);
      const forkBlock = Number(pin.block);

      let chain;
      try {
        const started = await startChain({
          binaryPath: BIN,
          port: PORT,
          forkUrl: FORK_URL,
          forkBlock,
          allowedForkUrls: [FORK_URL],
        });
        if (!started.ok) throw new Error(`chain-not-started: ${started.reason}`);
        chain = started;
        expect(chain.fork).toBe(true);

        // The test's own reads, through the runner's local send only, with their own budget.
        const target = checkTarget(`http://127.0.0.1:${PORT}`, { local: true });
        expect(target.ok).toBe(true);
        const budget = new RequestBudget({ requestsPerRoute: 20, burst: 1 });
        let id = 0;
        const read = async (data) => {
          id += 1;
          const r = await sendLocalJson(target.target, budget, 'fork-read', '/', {
            jsonrpc: '2.0',
            id,
            method: 'eth_call',
            params: [{ to: FUND_USDC_ADDRESS, data }, 'latest'],
          });
          expect(r.ok && r.status).toBe(200);
          const result = JSON.parse(Buffer.from(r.body).toString('utf8')).result;
          expect(typeof result === 'string' && /^0x[0-9a-fA-F]{64}$/.test(result)).toBe(true);
          return BigInt(result);
        };

        const buyer = address();
        const relayer = address();
        expect(await read(FUND_SELECTORS.paused)).toBe(0n);
        const supplyBefore = await read(FUND_SELECTORS.totalSupply);
        expect(await read(`${FUND_SELECTORS.balanceOf}${pad(buyer)}`)).toBe(0n);

        const funded = await fundBuyer({ chain, buyer, relayer, usdcUnits: UNITS, relayerEthWei: 10n ** 17n });
        expect(funded.ok).toBe(true);

        expect(await read(`${FUND_SELECTORS.balanceOf}${pad(buyer)}`)).toBe(UNITS);
        expect(await read(FUND_SELECTORS.totalSupply)).toBe(supplyBefore + UNITS);
        expect(await read(FUND_SELECTORS.paused)).toBe(0n);
        console.log(`fork funding: pinned block ${forkBlock}, masterMinter ${funded.masterMinter}, amount ${UNITS}`);
      } finally {
        if (chain) await chain.stop();
      }
      expect(await portRefuses(PORT)).toBe(true);
    }, 180_000);
  },
);
