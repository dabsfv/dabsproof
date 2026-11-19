// The start-up helper and the fallback: no throw by default, failHard, globalThis, Node.js only,
// Edge refuses, and no path ever gives out an address from an unchecked mapping.
import { brand } from '@dabsproof/brand';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FIXKIT_TEXT, FixkitError, XPUB_VARIABLE } from '../src/index.js';
import {
  getPayToManager,
  payToFor,
  payToState,
  type RegisterOptions,
  registerPayTo,
  resetPayToState,
  STATE_KEY,
} from '../src/next/index.js';
import { allowListed, makeCanaries, TEST_XPUB } from './helpers.js';

const NODE = { NEXT_RUNTIME: 'nodejs', [XPUB_VARIABLE]: TEST_XPUB };
const EDGE = { NEXT_RUNTIME: 'edge', [XPUB_VARIABLE]: TEST_XPUB };
let lines: string[] = [];
const opts = (over: Partial<RegisterOptions> = {}): RegisterOptions => ({
  mapping: allowListed('hd-per-resource'),
  env: NODE,
  log: (l) => lines.push(l),
  ...over,
});
const refusesEverything = (env: Record<string, string>) => {
  for (const route of ['/api/alpha', '/api/beta', '/api/item/[id]', '/api/tiered']) {
    expect(() => payToFor({ route, id: 5, tier: 'pro' }, { ...opts(), env })).toThrow(FixkitError);
  }
};

beforeEach(() => {
  resetPayToState();
  lines = [];
});
afterEach(() => resetPayToState());

describe('start-up in the Node.js runtime', () => {
  it('a passing mapping is checked once and kept on globalThis under Symbol.for', () => {
    const state = registerPayTo(opts());
    expect(state?.status).toBe('ready');
    expect((globalThis as Record<symbol, unknown>)[Symbol.for(`${brand.slug}.fixkit.payto`)]).toBe(state);
    expect(STATE_KEY).toBe(Symbol.for(`${brand.slug}.fixkit.payto`));
    expect(getPayToManager({ ...opts(), env: NODE })).toBe(state?.status === 'ready' ? state.manager : null);
    expect(lines).toEqual([]);
  });
  it('a failed check does not throw by default: it prints the report and refuses every route', () => {
    const state = registerPayTo(opts({ mapping: allowListed('hd-dup-index') }));
    expect(state).toEqual({ status: 'refused', code: 'mapping-refused' });
    expect(lines[0]).toBe(FIXKIT_TEXT.startupStopped);
    expect(lines[1]).toContain('X402-03.dup-index');
    refusesEverything(NODE);
  });
  it('failHard throws, and the refused state is kept too', () => {
    expect(() => registerPayTo(opts({ mapping: allowListed('hd-dup-index'), failHard: true }))).toThrow(
      FIXKIT_TEXT.startupStopped,
    );
    expect(payToState()).toEqual({ status: 'refused', code: 'mapping-refused' });
    refusesEverything(NODE);
  });
  it('could not verify: prints sentence b and the report, and starts; strict refuses', () => {
    expect(registerPayTo(opts({ mapping: allowListed('range-unknown') }))?.status).toBe('ready');
    expect(lines[0]).toBe(FIXKIT_TEXT.mappingUnverified);
    resetPayToState();
    expect(registerPayTo(opts({ mapping: allowListed('range-unknown'), strict: true }))?.status).toBe('refused');
  });
  it('an environment refusal refuses addresses', () => {
    const state = registerPayTo(opts({ env: { ...NODE, NEXT_PUBLIC_KEY: makeCanaries().privateKey } }));
    expect(state).toEqual({ status: 'refused', code: 'environment-refused' });
    expect(lines.at(-1)).toBe(FIXKIT_TEXT.fallbackRefused);
  });
  it('a network or asset refusal, or a bad xpub, refuses addresses', () => {
    const net = allowListed('hd-per-resource', (r) => {
      for (const x of r) x.network = 'eip155:8453';
    });
    expect(registerPayTo(opts({ mapping: net }))).toEqual({ status: 'refused', code: 'network-refused' });
    expect(registerPayTo(opts({ env: { NEXT_RUNTIME: 'nodejs' } }))).toEqual({
      status: 'refused',
      code: 'xpub-refused',
    });
  });
  it('a plain Node.js server (no NEXT_RUNTIME) is treated as the Node.js runtime', () => {
    expect(registerPayTo(opts({ env: { [XPUB_VARIABLE]: TEST_XPUB } }))?.status).toBe('ready');
  });
});

/** Asserts a refusal with sentence q, word for word, and that no address came back. */
const expectQ = (fn: () => unknown): void => {
  let returned: unknown;
  try {
    returned = fn();
  } catch (e) {
    expect(e).toBeInstanceOf(FixkitError);
    expect((e as Error).message).toBe('The start-up check could not run here, so no payment address was given out.');
    expect((e as Error).message).toBe(FIXKIT_TEXT.checkNotRun);
    expect((e as Error).cause).toBeUndefined();
    return;
  }
  throw new Error(`expected a refusal, got ${typeof returned}`);
};

describe('sentence q: checks that cannot load or run', () => {
  // An environment that cannot be read stands in for checks that cannot load or run.
  const broken = () =>
    new Proxy({ NEXT_RUNTIME: 'nodejs' } as Record<string, string>, {
      ownKeys: () => {
        throw new Error('cannot list');
      },
    });
  const throwingLog = () => {
    throw new Error('log broken');
  };

  it('an environment that cannot be read, without failHard', () => {
    expect(registerPayTo(opts({ env: broken() }))).toEqual({ status: 'refused', code: 'check-not-run' });
    expect(lines).toContain(FIXKIT_TEXT.checkNotRun);
    expectQ(() => getPayToManager(opts({ env: broken() })));
    expectQ(() => payToFor({ route: '/api/alpha' }, opts({ env: broken() })));
  });
  it('an environment that cannot be read, with failHard', () => {
    expectQ(() => registerPayTo(opts({ env: broken(), failHard: true })));
    expect(payToState()).toEqual({ status: 'refused', code: 'check-not-run' });
    expectQ(() => payToFor({ route: '/api/alpha' }, opts({ env: broken() })));
  });
  it('an environment that cannot be read, reached only through the fallback', () => {
    expectQ(() => payToFor({ route: '/api/alpha' }, opts({ env: broken() })));
    expectQ(() => payToFor({ route: '/api/alpha' }, opts({ env: broken(), failHard: true })));
  });
  it('a log that throws, without failHard', () => {
    const o = opts({ mapping: allowListed('range-unknown'), log: throwingLog });
    expect(registerPayTo(o)).toEqual({ status: 'refused', code: 'check-not-run' });
    expectQ(() => getPayToManager(o));
    expectQ(() => payToFor({ route: '/api/alpha' }, o));
  });
  it('a log that throws, with failHard', () => {
    expectQ(() => registerPayTo(opts({ mapping: allowListed('range-unknown'), log: throwingLog, failHard: true })));
    expect(payToState()).toEqual({ status: 'refused', code: 'check-not-run' });
    expectQ(() => payToFor({ route: '/api/alpha' }, opts()));
  });
  it('a log that throws, reached only through the fallback', () => {
    expectQ(() => payToFor({ route: '/api/alpha' }, opts({ mapping: allowListed('range-unknown'), log: throwingLog })));
  });
});

describe('sentence q: any NEXT_RUNTIME other than nodejs, unset or edge', () => {
  for (const runtime of ['experimental-edge', 'NODEJS', 'node', '']) {
    it(`"${runtime}": nothing is stored and no address is given out, with or without failHard`, () => {
      const env = { NEXT_RUNTIME: runtime, [XPUB_VARIABLE]: TEST_XPUB };
      expect(registerPayTo(opts({ env }))).toBeUndefined();
      expect(payToState()).toBeUndefined();
      expectQ(() => getPayToManager(opts({ env })));
      expectQ(() => payToFor({ route: '/api/alpha' }, opts({ env })));
      expectQ(() => registerPayTo(opts({ env, failHard: true })));
      expect(payToState()).toBeUndefined();
      registerPayTo(opts());
      expect(payToState()?.status).toBe('ready');
      expectQ(() => payToFor({ route: '/api/alpha' }, opts({ env })));
      expectQ(() => payToFor({ route: '/api/alpha' }, opts({ env, failHard: true })));
    });
  }
});

describe('the Edge runtime', () => {
  it('register does nothing and stores nothing, even with failHard (Edge is not a failure)', () => {
    expect(registerPayTo(opts({ env: EDGE }))).toBeUndefined();
    expect(registerPayTo(opts({ env: EDGE, failHard: true }))).toBeUndefined();
    expect(payToState()).toBeUndefined();
  });
  it('the fallback always refuses with sentence h, even with options and even after a passing check elsewhere', () => {
    registerPayTo(opts());
    try {
      getPayToManager({ ...opts(), env: EDGE });
      throw new Error('expected a refusal');
    } catch (e) {
      expect((e as FixkitError).code).toBe('edge-runtime');
      expect((e as FixkitError).message).toBe(FIXKIT_TEXT.startupSkipped);
    }
    refusesEverything(EDGE);
  });
});

describe('the request-time fallback', () => {
  it('sentence p: with no start-up result and no options, nothing has been set up', () => {
    try {
      getPayToManager();
      throw new Error('expected a refusal');
    } catch (e) {
      expect((e as FixkitError).code).toBe('not-configured');
      expect((e as FixkitError).message).toBe(
        'No payment address mapping has been set up, so no payment address was given out.',
      );
      expect((e as FixkitError).message).toBe(FIXKIT_TEXT.notConfigured);
    }
    expect(() => payToFor({ route: '/api/alpha' })).toThrow(FIXKIT_TEXT.notConfigured);
  });
  it('sentence j only for a check that ran and failed', () => {
    registerPayTo(opts({ mapping: allowListed('hd-dup-index') }));
    expect(() => getPayToManager()).toThrow(FIXKIT_TEXT.fallbackRefused);
  });
  it('with no start-up but with options, it runs the same checks first', () => {
    expect(payToFor({ route: '/api/alpha' }, opts())).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(payToState()?.status).toBe('ready');
  });
  it('with no start-up and a failing mapping, it refuses and never throws past its own refusal', () => {
    expect(() =>
      payToFor({ route: '/api/alpha' }, opts({ mapping: allowListed('hd-dup-index'), failHard: true })),
    ).toThrow(FIXKIT_TEXT.fallbackRefused);
  });
  it('after a refused start-up, options cannot override the refusal', () => {
    registerPayTo(opts({ mapping: allowListed('hd-dup-index') }));
    expect(() => getPayToManager(opts())).toThrow(FIXKIT_TEXT.fallbackRefused);
  });
});

describe('no path gives out an address from an unchecked mapping', () => {
  // Every way to reach an address: createPayToManager, getPayToManager, payToFor, each with and
  // without start-up, in each runtime, with a failing mapping. None may return an address.
  const failing = [
    allowListed('hd-dup-index'),
    allowListed('hd'),
    allowListed('range-unknown'),
    { manifestVersion: 1, routes: [] },
  ];
  for (const [i, mapping] of failing.entries()) {
    it(`failing mapping ${i + 1}: every path refuses`, async () => {
      const { createPayToManager } = await import('../src/index.js');
      const strict = i === 2;
      expect(() => createPayToManager({ mapping, xpub: TEST_XPUB, strict })).toThrow();
      for (const env of [NODE, EDGE]) {
        resetPayToState();
        registerPayTo(opts({ mapping, env, strict }));
        expect(() => getPayToManager(opts({ mapping, env, strict }))).toThrow(FixkitError);
        expect(() => payToFor({ route: '/api/alpha' }, opts({ mapping, env, strict }))).toThrow(FixkitError);
        resetPayToState();
        expect(() => payToFor({ route: '/api/alpha' }, opts({ mapping, env, strict }))).toThrow(FixkitError);
        expect(() => payToFor({ route: '/api/alpha' })).toThrow(FixkitError);
      }
    });
  }
});
