// Unit tests for funding a buyer on a local fork. No chain is started: a stub server on 127.0.0.1,
// on a port the operating system picks, only counts requests, to show that every refusal here comes
// before anything is sent. Addresses are made up at run time. These tests say nothing about a real
// chain or a real token.
import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ALLOWED_NETWORKS, BASE_SEPOLIA } from '@dabsproof/evm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FUND_METHODS,
  FUND_SELECTORS,
  FUND_USDC_ADDRESS,
  type FundChain,
  fundBuyer,
  MAX_ETH_WEI,
  MAX_USDC_UNITS,
} from '../src/index.js';

const address = () => `0x${randomBytes(20).toString('hex')}`;
let server: Server | undefined;
let hits = 0;

/** A stub on 127.0.0.1 that counts requests and answers nothing useful. */
function stub(): Promise<number> {
  hits = 0;
  return new Promise((resolve) => {
    const s = createServer((_req, res) => {
      hits++;
      res.writeHead(500);
      res.end();
    });
    server = s;
    s.listen(0, '127.0.0.1', () => resolve((s.address() as AddressInfo).port));
  });
}

afterEach(async () => {
  const s = server;
  server = undefined;
  if (!s) return;
  s.closeAllConnections();
  await new Promise<void>((done) => s.close(() => done()));
});

describe('funding a buyer: constants (nothing is sent)', () => {
  it('the selectors are the ones computed from their signatures', () => {
    expect(FUND_SELECTORS).toEqual({
      masterMinter: '0x35d99f35',
      paused: '0x5c975abb',
      isBlacklisted: '0xfe575a87',
      configureMinter: '0x4e44d956',
      mint: '0x40c10f19',
      balanceOf: '0x70a08231',
      totalSupply: '0x18160ddd',
    });
    expect(Object.isFrozen(FUND_SELECTORS)).toBe(true);
  });
  it('the USDC address is the asset the evm package allows on Base Sepolia', () => {
    const allowed = ALLOWED_NETWORKS[BASE_SEPOLIA]?.assets.map((a) => a.address.toLowerCase()) ?? [];
    expect(allowed).toContain(FUND_USDC_ADDRESS.toLowerCase());
  });
  it('the caps are 10 USDC per chain and 1 ETH per account', () => {
    expect(MAX_USDC_UNITS).toBe(10_000_000n);
    expect(MAX_ETH_WEI).toBe(10n ** 18n);
  });
  it('the method allow-list is fixed, and holds no balance-writing or storage-writing helper', () => {
    expect([...FUND_METHODS]).toEqual([
      'eth_chainId',
      'eth_call',
      'anvil_setBalance',
      'anvil_impersonateAccount',
      'eth_sendTransaction',
      'eth_getTransactionReceipt',
      'anvil_stopImpersonatingAccount',
    ]);
    expect(Object.isFrozen(FUND_METHODS)).toBe(true);
    for (const m of ['anvil_dealERC20', 'anvil_setStorageAt', 'anvil_autoImpersonateAccount']) {
      expect(FUND_METHODS.includes(m)).toBe(false);
    }
  });
});

describe('funding a buyer: refusals come before anything is sent', () => {
  const ok = (port: number, o: Record<string, unknown> = {}) => ({
    chain: { port, fork: true } as FundChain,
    buyer: address(),
    relayer: address(),
    usdcUnits: 1_000_000n,
    relayerEthWei: 10n ** 17n,
    ...o,
  });

  it('a chain that is not a validated fork is refused', async () => {
    const port = await stub();
    for (const chain of [{ port, fork: false }, { port }, null, undefined]) {
      expect(await fundBuyer({ ...ok(port), chain: chain as FundChain })).toEqual({ ok: false, reason: 'not-a-fork' });
    }
    expect(hits).toBe(0);
  });
  it('a bad port or address is refused', async () => {
    const port = await stub();
    for (const p of [0, 80, 65536, 1.5]) {
      expect(await fundBuyer(ok(port, { chain: { port: p, fork: true } }))).toEqual({
        ok: false,
        reason: 'port-invalid',
      });
    }
    for (const bad of ['x', '', null, 42, `0x${'g'.repeat(40)}`, `0x${randomBytes(19).toString('hex')}`]) {
      expect(await fundBuyer(ok(port, { buyer: bad }))).toEqual({ ok: false, reason: 'address-invalid' });
      expect(await fundBuyer(ok(port, { relayer: bad }))).toEqual({ ok: false, reason: 'address-invalid' });
    }
    expect(hits).toBe(0);
  });
  it('USDC must be a bigint above 0 and at most 10 USDC', async () => {
    const port = await stub();
    for (const usdcUnits of [0n, -1n, 1, '1', null]) {
      expect(await fundBuyer(ok(port, { usdcUnits }))).toEqual({ ok: false, reason: 'usdc-amount-invalid' });
    }
    expect(await fundBuyer(ok(port, { usdcUnits: MAX_USDC_UNITS + 1n }))).toEqual({
      ok: false,
      reason: 'usdc-over-cap',
    });
    expect(hits).toBe(0);
  });
  it('ETH for the relayer must be a bigint above 0 and at most 1 ETH', async () => {
    const port = await stub();
    for (const relayerEthWei of [0n, -1n, 1, null]) {
      expect(await fundBuyer(ok(port, { relayerEthWei }))).toEqual({ ok: false, reason: 'eth-amount-invalid' });
    }
    expect(await fundBuyer(ok(port, { relayerEthWei: MAX_ETH_WEI + 1n }))).toEqual({
      ok: false,
      reason: 'eth-over-cap',
    });
    expect(hits).toBe(0);
  });
});
