// Unit tests for starting the local chain. No process is started here: every input below is refused
// before anything starts, or only builds the launch object. The binary path is only a string. These
// tests say nothing about anvil's own behaviour.
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CHAIN_CHILD_ENV, chainLaunch, startChain } from '../src/index.js';

const BINARY = `/fake-${randomBytes(4).toString('hex')}/bin/anvil`;
const reasonOf = (input: Parameters<typeof chainLaunch>[0]) => {
  const r = chainLaunch(input);
  return r.ok ? 'ok' : r.reason;
};

describe('starting the local chain (nothing is started here)', () => {
  it('refuses a fork URL or a fork block in this version', () => {
    expect(reasonOf({ binaryPath: BINARY, port: 18545, forkUrl: 'https://rpc.example.test/' })).toBe(
      'fork-not-allowed-yet',
    );
    expect(reasonOf({ binaryPath: BINARY, port: 18545, forkBlock: 1 })).toBe('fork-not-allowed-yet');
    expect(reasonOf({ binaryPath: BINARY, port: 18545, forkUrl: null })).toBe('fork-not-allowed-yet');
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
  });
  it('startChain gives the same refusals before anything is started', async () => {
    expect(await startChain({ binaryPath: BINARY, port: 4319 })).toEqual({ ok: false, reason: 'port-reserved' });
    expect(await startChain({ binaryPath: 'anvil', port: 18545 })).toEqual({
      ok: false,
      reason: 'binary-path-not-absolute',
    });
    expect(await startChain({ binaryPath: BINARY, port: 18545, forkBlock: 7 })).toEqual({
      ok: false,
      reason: 'fork-not-allowed-yet',
    });
  });
});
