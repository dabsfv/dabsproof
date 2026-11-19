// Fix-kit canaries: planted key-shaped values and the xpub go through the guard, the start-up
// helper, the fallback and the manager. None may appear in any line written, any state, any
// error (message, stack, cause) or anything written to standard output or standard error.

import { lintWording } from '@dabsproof/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPayToManager, FIXKIT_TEXT, guardEnvironment, KEY_TYPE_LABEL, XPUB_VARIABLE } from '../src/index.js';
import { getPayToManager, payToState, registerPayTo, resetPayToState } from '../src/next/index.js';
import { allowListed, expectNotShown, makeCanaries, printed, secretsOf, TEST_XPRV, TEST_XPUB } from './helpers.js';

let written: string[] = [];
beforeEach(() => {
  written = [];
  resetPayToState();
  const capture = (chunk: unknown) => {
    written.push(String(chunk));
    return true;
  };
  vi.spyOn(process.stdout, 'write').mockImplementation(capture as never);
  vi.spyOn(process.stderr, 'write').mockImplementation(capture as never);
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void written.push(a.map(String).join(' ')));
  }
});
afterEach(() => {
  vi.restoreAllMocks();
  resetPayToState();
});

const caught = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return null;
};

describe('fix-kit canary suite', () => {
  it('a hostile environment: every value stays out of every output', () => {
    const c = makeCanaries();
    const env = {
      NEXT_RUNTIME: 'nodejs',
      NEXT_PUBLIC_A: c.privateKey,
      NEXT_PUBLIC_B: c.mnemonic,
      NEXT_PUBLIC_C: TEST_XPUB,
      SERVER_KEY: c.privateKey0x,
      SERVER_PEM: c.pem,
      WALLET_MNEMONIC: c.token,
      [XPUB_VARIABLE]: c.xprv,
    };
    const g = guardEnvironment(env);
    const state = registerPayTo({ mapping: allowListed('hd-per-resource'), env }); // default sink: stderr
    const e = caught(() => getPayToManager({ mapping: allowListed('hd-per-resource'), env }));
    expect(state?.status).toBe('refused');
    expect(e).not.toBeNull();
    expectNotShown([printed(g), printed(state), printed(payToState()), printed(e), ...written], {
      ...secretsOf(c),
      xpub: TEST_XPUB,
    });
    expect(written.join('')).toContain('NEXT_PUBLIC_A');
    expect(written.join('')).toContain(KEY_TYPE_LABEL['private-key']);
  });

  it('the xpub and its private counterpart never appear, from start-up to a given address', () => {
    const env = { NEXT_RUNTIME: 'nodejs', [XPUB_VARIABLE]: TEST_XPUB };
    const state = registerPayTo({ mapping: allowListed('hd-per-resource'), env });
    const m = getPayToManager({ mapping: allowListed('hd-per-resource'), env });
    const address = m.payToFor({ route: '/api/alpha' });
    expect(address).toMatch(/^0x/);
    const xprvEnv = { NEXT_RUNTIME: 'nodejs', [XPUB_VARIABLE]: TEST_XPRV };
    resetPayToState();
    const refused = registerPayTo({ mapping: allowListed('hd-per-resource'), env: xprvEnv });
    const e = caught(() => createPayToManager({ mapping: allowListed('hd-per-resource'), xpub: TEST_XPRV }));
    expectNotShown([printed(state), printed(m), printed(refused), printed(e), ...written], {
      xpub: TEST_XPUB,
      xprv: TEST_XPRV,
    });
  });

  it('errors carry fixed sentences and no cause', () => {
    const e = caught(() => getPayToManager()) as Error;
    expect(e.message).toBe(FIXKIT_TEXT.notConfigured);
    expect(e.cause).toBeUndefined();
  });

  it('every fix-kit sentence passes the wording lint', () => {
    for (const t of [...Object.values(FIXKIT_TEXT), ...Object.values(KEY_TYPE_LABEL)])
      expect(lintWording(t)).toEqual([]);
  });
});
