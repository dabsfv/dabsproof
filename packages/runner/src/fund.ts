// Funding a buyer with USDC on a local fork, for tests only. It works only on a chain that startChain
// started as a validated fork, and it talks only to that chain on 127.0.0.1, one JSON-RPC call at a
// time through checkTarget and sendLocalJson, so the request budget applies. USDC comes through the
// token's own mint path: the masterMinter address is read from the chain, impersonated on the local
// fork only, made a minter with an allowance of exactly the amount, and used to mint to the buyer.
// Each transaction's receipt is asked for a few times, a fixed short time apart, while it is not there
// yet, on a route of its own with its own budget; a receipt whose status is not success is never
// asked about again. Impersonation is stopped in every case. The relayer gets ETH for gas, and so
// does the masterMinter for its own two transactions; the buyer gets USDC only. Caps are checked
// before anything is sent: at most 10 USDC per chain across all mints, and at most 1 ETH per
// account. Nothing is signed, no key is used, nothing is read from or written to any file, and no
// environment value is read. This says nothing about how a real network or a real facilitator
// behaves.
import { RequestBudget } from './budget.js';
import { ANVIL_CHAIN_ID, ANVIL_HOST } from './chain.js';
import { sendLocalJson } from './send.js';
import { checkTarget } from './target.js';

/** USDC on Base Sepolia, the asset the evm package allows (a test checks the two agree). */
export const FUND_USDC_ADDRESS = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
/** At most 10 USDC (6 decimals) per chain, across every mint. */
export const MAX_USDC_UNITS = 10_000_000n;
/** At most 1 ETH per account. */
export const MAX_ETH_WEI = 1_000_000_000_000_000_000n;
/** Gas money for the masterMinter's two transactions: 0.1 ETH, within the cap. */
const MASTER_MINTER_ETH_WEI = 100_000_000_000_000_000n;
/** Function selectors, computed from their signatures with viem's toFunctionSelector. */
export const FUND_SELECTORS = Object.freeze({
  masterMinter: '0x35d99f35',
  paused: '0x5c975abb',
  isBlacklisted: '0xfe575a87',
  configureMinter: '0x4e44d956',
  mint: '0x40c10f19',
  balanceOf: '0x70a08231',
  totalSupply: '0x18160ddd',
});
/** The only JSON-RPC methods this module sends. */
export const FUND_METHODS: readonly string[] = Object.freeze([
  'eth_chainId',
  'eth_call',
  'anvil_setBalance',
  'anvil_impersonateAccount',
  'eth_sendTransaction',
  'eth_getTransactionReceipt',
  'anvil_stopImpersonatingAccount',
]);
/** At most this many receipt requests per transaction, asked again only while the reply is null. */
export const FUND_RECEIPT_TRIES = 5;
/** The fixed wait between two receipt requests for one transaction. */
export const FUND_RECEIPT_SPACING_MS = 200;
const FUND_ROUTE = 'fund';
/** Receipt requests go on their own route with their own budget, apart from the funding route. */
const RECEIPT_ROUTE = 'fund-receipt';
const RECEIPT_METHOD = 'eth_getTransactionReceipt';
const HEX = /^0x[0-9a-fA-F]+$/;
const EXPECTED_CHAIN_ID = `0x${ANVIL_CHAIN_ID.toString(16)}`;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const WORD = /^0x[0-9a-fA-F]{64}$/;

export type FundReason =
  | 'not-a-fork'
  | 'port-invalid'
  | 'address-invalid'
  | 'usdc-amount-invalid'
  | 'usdc-over-cap'
  | 'eth-amount-invalid'
  | 'eth-over-cap'
  | 'method-not-allowed'
  | 'send-not-allowed'
  | 'impersonation-not-allowed'
  | 'request-failed'
  | 'reply-bad-shape'
  | 'chain-id-mismatch'
  | 'master-minter-invalid'
  | 'token-paused'
  | 'buyer-blacklisted'
  | 'transaction-failed'
  | 'receipt-missing'
  | 'receipt-malformed'
  | 'stop-impersonation-failed'
  | 'read-back-mismatch';

export interface FundChain {
  readonly port: number;
  readonly fork: boolean;
}

export interface FundInput {
  /** The result of startChain; only a validated fork is accepted. */
  chain: FundChain;
  buyer: unknown;
  relayer: unknown;
  /** USDC base units to mint to the buyer, as a bigint: more than 0, at most the cap. */
  usdcUnits: unknown;
  /** ETH for the relayer, in wei, as a bigint: more than 0, at most 1 ETH. */
  relayerEthWei: unknown;
}

export type FundResult =
  | { ok: true; masterMinter: string; minted: bigint; buyerBalance: bigint; totalSupply: bigint }
  | { ok: false; reason: FundReason; step?: string };

/** USDC minted so far on each chain, so the cap holds across calls. */
const mintedOn = new WeakMap<FundChain, bigint>();

class Refusal extends Error {
  constructor(
    readonly reason: FundReason,
    readonly step?: string,
  ) {
    super(reason);
  }
}

const word = (hex: string) => hex.toLowerCase().replace(/^0x/, '').padStart(64, '0');
const addressWord = (address: string) => word(address);
const uintWord = (n: bigint) => word(n.toString(16));
const hexQuantity = (n: bigint) => `0x${n.toString(16)}`;

interface Context {
  target: Parameters<typeof sendLocalJson>[0];
  budget: RequestBudget;
  receiptBudget: RequestBudget;
  id: number;
  masterMinter: string | null;
}

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

async function rpc(ctx: Context, method: string, params: unknown[]): Promise<unknown> {
  if (!FUND_METHODS.includes(method)) throw new Refusal('method-not-allowed', method);
  // Receipt requests, and only they, go on the receipt route with the receipt budget.
  const onReceiptRoute = method === RECEIPT_METHOD;
  if (method === 'anvil_impersonateAccount' || method === 'anvil_stopImpersonatingAccount') {
    if (ctx.masterMinter === null || String(params[0]).toLowerCase() !== ctx.masterMinter) {
      throw new Refusal('impersonation-not-allowed', method);
    }
  }
  if (method === 'eth_sendTransaction') {
    const tx = params[0] as { from?: unknown; to?: unknown; data?: unknown } | undefined;
    const data = typeof tx?.data === 'string' ? tx.data.toLowerCase() : '';
    const allowedData = data.startsWith(FUND_SELECTORS.configureMinter) || data.startsWith(FUND_SELECTORS.mint);
    if (
      ctx.masterMinter === null ||
      String(tx?.from).toLowerCase() !== ctx.masterMinter ||
      String(tx?.to).toLowerCase() !== FUND_USDC_ADDRESS.toLowerCase() ||
      !allowedData
    ) {
      throw new Refusal('send-not-allowed', method);
    }
  }
  ctx.id += 1;
  const budget = onReceiptRoute ? ctx.receiptBudget : ctx.budget;
  const route = onReceiptRoute ? RECEIPT_ROUTE : FUND_ROUTE;
  const r = await sendLocalJson(ctx.target, budget, route, '/', {
    jsonrpc: '2.0',
    id: ctx.id,
    method,
    params,
  });
  if (!r.ok || r.status !== 200) throw new Refusal('request-failed', method);
  let reply: unknown;
  try {
    reply = JSON.parse(Buffer.from(r.body).toString('utf8'));
  } catch {
    throw new Refusal('request-failed', method);
  }
  if (reply === null || typeof reply !== 'object' || ('error' in reply && (reply as { error: unknown }).error)) {
    throw new Refusal('request-failed', method);
  }
  return (reply as { result?: unknown }).result;
}

async function readWord(ctx: Context, step: string, data: string): Promise<string> {
  const result = await rpc(ctx, 'eth_call', [{ to: FUND_USDC_ADDRESS, data }, 'latest']);
  if (typeof result !== 'string' || WORD.exec(result) === null) throw new Refusal('reply-bad-shape', step);
  return result;
}

async function sendAndConfirm(ctx: Context, step: string, data: string): Promise<void> {
  const hash = await rpc(ctx, 'eth_sendTransaction', [{ from: ctx.masterMinter, to: FUND_USDC_ADDRESS, data }]);
  if (typeof hash !== 'string' || WORD.exec(hash) === null) throw new Refusal('reply-bad-shape', step);
  const receipt = await waitForReceipt(ctx, step, hash);
  if (typeof receipt !== 'object' || receipt === null || Array.isArray(receipt)) {
    throw new Refusal('receipt-malformed', step);
  }
  const status = (receipt as { status?: unknown }).status;
  if (typeof status !== 'string' || HEX.exec(status) === null) throw new Refusal('receipt-malformed', step);
  // Any status but 0x1 is a failed transaction, and is never asked about again.
  if (status !== '0x1') throw new Refusal('transaction-failed', step);
}

/**
 * Asks for the receipt up to FUND_RECEIPT_TRIES times, FUND_RECEIPT_SPACING_MS apart, and only while
 * the reply is null (not mined yet). The first reply that is not null is returned as it is, for the
 * caller to check. When no try is left, the reason is receipt-missing.
 */
async function waitForReceipt(ctx: Context, step: string, hash: string): Promise<unknown> {
  for (let attempt = 1; attempt <= FUND_RECEIPT_TRIES; attempt++) {
    const receipt = await rpc(ctx, RECEIPT_METHOD, [hash]);
    if (receipt !== null) return receipt;
    if (attempt < FUND_RECEIPT_TRIES) await sleep(FUND_RECEIPT_SPACING_MS);
  }
  throw new Refusal('receipt-missing', step);
}

/** Checks every input before anything is sent; returns the amounts as bigints or a reason code. */
function checkInput(
  input: FundInput,
): { ok: true; buyer: string; relayer: string; units: bigint; ethWei: bigint } | { ok: false; reason: FundReason } {
  if (input?.chain?.fork !== true) return { ok: false, reason: 'not-a-fork' };
  const port = input.chain.port;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return { ok: false, reason: 'port-invalid' };
  if (typeof input.buyer !== 'string' || ADDRESS.exec(input.buyer) === null) {
    return { ok: false, reason: 'address-invalid' };
  }
  if (typeof input.relayer !== 'string' || ADDRESS.exec(input.relayer) === null) {
    return { ok: false, reason: 'address-invalid' };
  }
  const units = input.usdcUnits;
  if (typeof units !== 'bigint' || units <= 0n) return { ok: false, reason: 'usdc-amount-invalid' };
  if (units + (mintedOn.get(input.chain) ?? 0n) > MAX_USDC_UNITS) return { ok: false, reason: 'usdc-over-cap' };
  const ethWei = input.relayerEthWei;
  if (typeof ethWei !== 'bigint' || ethWei <= 0n) return { ok: false, reason: 'eth-amount-invalid' };
  if (ethWei > MAX_ETH_WEI) return { ok: false, reason: 'eth-over-cap' };
  return { ok: true, buyer: input.buyer.toLowerCase(), relayer: input.relayer.toLowerCase(), units, ethWei };
}

/**
 * Funds the buyer with USDC through the masterMinter on a validated local fork, and the relayer with
 * ETH. Every refusal comes with a fixed reason code and, after something was sent, the step it
 * stopped at. Impersonation, once begun, is always stopped.
 */
export async function fundBuyer(input: FundInput): Promise<FundResult> {
  const checked = checkInput(input);
  if (!checked.ok) return checked;
  const { buyer, relayer, units, ethWei } = checked;
  const target = checkTarget(`http://${ANVIL_HOST}:${input.chain.port}`, { local: true });
  if (!target.ok) return { ok: false, reason: 'port-invalid' };
  const ctx: Context = {
    target: target.target,
    budget: new RequestBudget({ requestsPerRoute: 20, burst: 1 }),
    receiptBudget: new RequestBudget({ requestsPerRoute: 20, burst: 1 }),
    id: 0,
    masterMinter: null,
  };
  try {
    if ((await rpc(ctx, 'eth_chainId', [])) !== EXPECTED_CHAIN_ID)
      throw new Refusal('chain-id-mismatch', 'eth_chainId');
    const minterWord = await readWord(ctx, 'masterMinter', FUND_SELECTORS.masterMinter);
    const masterMinter = `0x${minterWord.slice(-40)}`.toLowerCase();
    if (BigInt(masterMinter) === 0n) throw new Refusal('master-minter-invalid', 'masterMinter');
    ctx.masterMinter = masterMinter;
    if (BigInt(await readWord(ctx, 'paused', FUND_SELECTORS.paused)) !== 0n)
      throw new Refusal('token-paused', 'paused');
    const blacklisted = await readWord(ctx, 'isBlacklisted', `${FUND_SELECTORS.isBlacklisted}${addressWord(buyer)}`);
    if (BigInt(blacklisted) !== 0n) throw new Refusal('buyer-blacklisted', 'isBlacklisted');
    const supplyBefore = BigInt(await readWord(ctx, 'totalSupply', FUND_SELECTORS.totalSupply));
    const balanceBefore = BigInt(await readWord(ctx, 'balanceOf', `${FUND_SELECTORS.balanceOf}${addressWord(buyer)}`));
    await rpc(ctx, 'anvil_setBalance', [relayer, hexQuantity(ethWei)]);
    await rpc(ctx, 'anvil_setBalance', [masterMinter, hexQuantity(MASTER_MINTER_ETH_WEI)]);
    await rpc(ctx, 'anvil_impersonateAccount', [masterMinter]);
    // A failed stop is reported only when nothing failed before it: an earlier error leaves the
    // finally block unchanged and still wins.
    let stopFailed = false;
    try {
      await sendAndConfirm(
        ctx,
        'configureMinter',
        `${FUND_SELECTORS.configureMinter}${addressWord(masterMinter)}${uintWord(units)}`,
      );
      await sendAndConfirm(ctx, 'mint', `${FUND_SELECTORS.mint}${addressWord(buyer)}${uintWord(units)}`);
      mintedOn.set(input.chain, (mintedOn.get(input.chain) ?? 0n) + units);
    } finally {
      try {
        await rpc(ctx, 'anvil_stopImpersonatingAccount', [masterMinter]);
      } catch {
        stopFailed = true;
      }
    }
    if (stopFailed) throw new Refusal('stop-impersonation-failed', 'anvil_stopImpersonatingAccount');
    const balanceAfter = BigInt(await readWord(ctx, 'balanceOf', `${FUND_SELECTORS.balanceOf}${addressWord(buyer)}`));
    const supplyAfter = BigInt(await readWord(ctx, 'totalSupply', FUND_SELECTORS.totalSupply));
    if (balanceAfter !== balanceBefore + units || supplyAfter !== supplyBefore + units) {
      throw new Refusal('read-back-mismatch', 'read-back');
    }
    return { ok: true, masterMinter, minted: units, buyerBalance: balanceAfter, totalSupply: supplyAfter };
  } catch (e) {
    if (e instanceof Refusal)
      return e.step === undefined ? { ok: false, reason: e.reason } : { ok: false, reason: e.reason, step: e.step };
    return { ok: false, reason: 'request-failed' };
  }
}
