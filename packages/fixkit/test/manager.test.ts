// The payment address manager: only the addresses the mapping names, network and asset refusals,
// xpub refusals, and no xpub in any printed form.
import { inspect } from 'node:util';
import { deriveAddress, EVM_TEXT, EvmInputError, parseAccountXpub, toChecksumAddress } from '@dabsproof/evm';
import { describe, expect, it } from 'vitest';
import { createPayToManager, FIXKIT_TEXT, FixkitError } from '../src/index.js';
import { allowListed, readFixture, TEST_XPRV, TEST_XPUB, WRONG_DEPTH_XPUB } from './helpers.js';

const account = parseAccountXpub(TEST_XPUB);
const at = (i: number) => deriveAddress(account, i);
const manager = () => createPayToManager({ mapping: allowListed('hd-per-resource'), xpub: TEST_XPUB });

const refusedWith = (fn: () => unknown, code: string, message: string) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(FixkitError);
    expect((e as FixkitError).code).toBe(code);
    expect((e as FixkitError).message).toBe(message);
    expect((e as Error).cause).toBeUndefined();
    return;
  }
  throw new Error('expected a refusal');
};

describe('addresses', () => {
  it('an index route gets the address at that index', () => {
    const m = manager();
    expect(m.payToFor({ route: '/api/alpha' })).toBe(at(0));
    expect(m.payToFor({ route: '/api/gamma' })).toBe(at(2));
    expect(m.payToFor({ route: '/api/agg/seller2' })).toBe(at(11));
  });
  it('an item route gets baseIndex plus the item number, as a number or digits', () => {
    const m = manager();
    expect(m.payToFor({ route: '/api/item/[id]', id: 1 })).toBe(at(1001));
    expect(m.payToFor({ route: '/api/item/[id]', id: '9999' })).toBe(at(10999));
  });
  it('each tier is looked up by its tier name', () => {
    expect(manager().payToFor({ route: '/api/tiered', tier: 'pro' })).toBe(at(4));
  });
  it('a fixed-address route gets its address, checksummed', () => {
    const fixed = allowListed('hd-per-resource', (routes) => {
      routes.splice(0, routes.length, {
        route: '/api/alpha',
        price: '1000',
        network: 'eip155:84532',
        address: `0x${'ab'.repeat(20)}`,
      });
    });
    const m = createPayToManager({ mapping: fixed });
    expect(m.payToFor({ route: '/api/alpha' })).toBe(toChecksumAddress(`0x${'ab'.repeat(20)}`));
  });
});

describe('refusals at request time', () => {
  it('a route not in the mapping, with no shared or default address', () => {
    const m = manager();
    refusedWith(() => m.payToFor({ route: '/api/delta' }), 'unknown-route', FIXKIT_TEXT.unknownRoute);
    refusedWith(() => m.payToFor({ route: '/api/alpha', scheme: 'upto' }), 'unknown-route', FIXKIT_TEXT.unknownRoute);
    refusedWith(() => m.payToFor({ route: '/api/alpha', tier: 'pro' }), 'unknown-route', FIXKIT_TEXT.unknownRoute);
  });
  it('sentence n: a tiered route asked for with no tier, or a tier not in the mapping', () => {
    const m = manager();
    refusedWith(() => m.payToFor({ route: '/api/tiered' }), 'tier-not-given', FIXKIT_TEXT.tierNotGiven);
    refusedWith(() => m.payToFor({ route: '/api/tiered', tier: 'gold' }), 'tier-not-given', FIXKIT_TEXT.tierNotGiven);
    expect(FIXKIT_TEXT.tierNotGiven).toBe(
      'This route has tiers, and the request did not name one that is in the mapping, so no payment address was given out.',
    );
  });
  it('sentence o: an item route with a missing or non-whole item number', () => {
    const m = manager();
    for (const id of [1.5, 'abc', '', '-1', '1e3', Number.NaN, undefined]) {
      refusedWith(
        () => m.payToFor({ route: '/api/item/[id]', ...(id === undefined ? {} : { id }) }),
        'item-not-given',
        FIXKIT_TEXT.itemNotGiven,
      );
    }
    expect(FIXKIT_TEXT.itemNotGiven).toBe(
      'This route needs a whole item number, and the request did not give one, so no payment address was given out.',
    );
  });
  it('sentence g: a whole item number outside the range', () => {
    const m = manager();
    for (const id of [0, 10000, -1, '0', '10000']) {
      refusedWith(() => m.payToFor({ route: '/api/item/[id]', id }), 'id-out-of-range', FIXKIT_TEXT.idOutOfRange);
    }
  });
  it('without a declared range, an item number is refused only past the last index', () => {
    const m = createPayToManager({ mapping: allowListed('range-unknown'), xpub: TEST_XPUB });
    expect(m.payToFor({ route: '/api/item/[id]', id: 5 })).toBe(at(1005));
    refusedWith(
      () => m.payToFor({ route: '/api/item/[id]', id: 2 ** 31 }),
      'id-out-of-range',
      FIXKIT_TEXT.idOutOfRange,
    );
  });
});

describe('refusals when building the manager', () => {
  it('a duplicate index refuses, with the existing report attached', () => {
    try {
      createPayToManager({ mapping: allowListed('hd-dup-index'), xpub: TEST_XPUB });
      throw new Error('expected a refusal');
    } catch (e) {
      expect((e as FixkitError).code).toBe('mapping-refused');
      expect((e as FixkitError).message).toBe(FIXKIT_TEXT.mappingRefused);
      expect((e as FixkitError & { report: string }).report).toContain('X402-03.dup-index');
    }
  });
  it('could not verify refuses only with strict', () => {
    expect(() => createPayToManager({ mapping: allowListed('range-unknown'), xpub: TEST_XPUB })).not.toThrow();
    refusedWith(
      () => createPayToManager({ mapping: allowListed('range-unknown'), xpub: TEST_XPUB, strict: true }),
      'mapping-refused',
      FIXKIT_TEXT.mappingRefused,
    );
  });
  it('a network other than Base Sepolia is refused (tested separately from the asset)', () => {
    const m = allowListed('hd-per-resource', (routes) => {
      for (const r of routes) r.network = 'eip155:8453';
    });
    refusedWith(
      () => createPayToManager({ mapping: m, xpub: TEST_XPUB }),
      'network-refused',
      FIXKIT_TEXT.networkRefused,
    );
  });
  it('an asset not on the allow-list is refused (the fixtures use fake assets)', () => {
    refusedWith(
      () => createPayToManager({ mapping: readFixture('hd-per-resource'), xpub: TEST_XPUB }),
      'asset-refused',
      FIXKIT_TEXT.assetRefused,
    );
  });
  it('an xprv, the wrong depth, or no xpub is refused with evm sentences', () => {
    const cases: [string, string][] = [
      [TEST_XPRV, EVM_TEXT.privateKeyRefused],
      [WRONG_DEPTH_XPUB, EVM_TEXT.wrongDepth],
      ['', EVM_TEXT.notExtendedKey],
    ];
    for (const [xpub, message] of cases) {
      try {
        createPayToManager({ mapping: allowListed('hd-per-resource'), xpub });
        throw new Error('expected a refusal');
      } catch (e) {
        expect(e).toBeInstanceOf(EvmInputError);
        expect((e as Error).message).toBe(message);
      }
    }
  });
});

describe('the manager never prints the xpub', () => {
  it('prints and serialises as a fixed label', () => {
    const m = manager();
    expect(JSON.stringify(m)).toBe('"[PayToManager]"');
    expect(String(m)).toBe('[PayToManager]');
    expect(inspect(m, { showHidden: true, depth: null })).toBe('[PayToManager]');
    expect(inspect({ m }, { depth: null })).not.toContain(TEST_XPUB.slice(4, 20));
    expect(Object.keys(m)).toEqual(['validation']);
    expect(JSON.stringify(m.validation)).not.toContain(TEST_XPUB.slice(4, 20));
  });
});
