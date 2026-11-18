// The run context: a per-run salt, the run's register of secrets, and how much output was
// withheld. Salt and register live in private fields; the context prints and serialises as a
// fixed label only, so neither can reach a log, a report or an error by accident.
import { createHmac, randomBytes } from 'node:crypto';
import { inspect } from 'node:util';
import { LIMITS } from './limits.js';

const LABEL = '[RunContext]';
const stripHex = (v: string): string => (/^0x[0-9a-fA-F]+$/.test(v) ? v.slice(2) : v);

function windowsOf(text: string, out: Set<string>): void {
  for (let i = 0; i + LIMITS.secretWindow <= text.length; i++) out.add(text.slice(i, i + LIMITS.secretWindow));
}

export class RunContext {
  readonly runId: string;
  #salt: Buffer;
  /** Every LIMITS.secretWindow-character run of every registered secret, lower case. */
  #windows = new Set<string>();
  /** Whole encoded forms of every registered secret (hex and base64 of its bytes), lower case. */
  #forms = new Set<string>();
  #withheld = 0;

  constructor(runId?: string) {
    this.runId = runId ?? randomBytes(8).toString('hex');
    this.#salt = randomBytes(32);
  }

  /**
   * Registers a value that must never appear in any output. Values shorter than
   * LIMITS.minSecretLength are not registered. Returns whether the value was registered.
   */
  registerSecret(value: unknown): boolean {
    if (typeof value !== 'string' || value.length < LIMITS.minSecretLength) return false;
    const lower = value.toLowerCase();
    windowsOf(stripHex(lower), this.#windows);
    windowsOf(JSON.stringify(lower).slice(1, -1), this.#windows);
    windowsOf(encodeURIComponent(value).toLowerCase(), this.#windows);
    const bytes = Buffer.from(value, 'utf8');
    for (const f of [bytes.toString('hex'), bytes.toString('base64'), bytes.toString('base64url')]) {
      this.#forms.add(f.toLowerCase());
    }
    return true;
  }

  /**
   * True if the text holds a registered secret: in any letter case, as any run of
   * LIMITS.secretWindow characters, or as the hex or base64 form of the whole value.
   * Says nothing about which secret.
   */
  holdsSecret(text: string): boolean {
    if (this.#windows.size === 0) return false;
    const lower = text.toLowerCase();
    for (let i = 0; i + LIMITS.secretWindow <= lower.length; i++) {
      if (this.#windows.has(lower.slice(i, i + LIMITS.secretWindow))) return true;
    }
    for (const f of this.#forms) if (lower.includes(f)) return true;
    return false;
  }

  /** How many outputs were withheld in this run. */
  get withheld(): number {
    return this.#withheld;
  }
  noteWithheld(): void {
    this.#withheld++;
  }

  /**
   * fp1: base64url HMAC-SHA256 under the per-run salt, from the decoded payer, nonce and
   * validBefore. Never from the header text. Equal within a run, unrelated across runs.
   */
  fingerprint(payer: string, nonce: string, validBefore: string): string {
    const mac = createHmac('sha256', this.#salt);
    mac.update(`${payer.toLowerCase()}\n${nonce.toLowerCase()}\n${validBefore}`);
    return `fp1:${mac.digest('base64url')}`;
  }

  toJSON(): string {
    return LABEL;
  }
  toString(): string {
    return LABEL;
  }
  [inspect.custom](): string {
    return LABEL;
  }
}

export const createRunContext = (runId?: string): RunContext => new RunContext(runId);
