// Signing a checked plan with a fake buyer key made at run time in a temporary home folder. The real
// home folder and the real buyer key are never named or opened: every file opened through node:fs is
// recorded and checked to lie in this test's temporary folders. The key is 32 random bytes checked
// valid, written as 0x plus 64 hex plus a newline; it is never written here as a literal. node:fs and
// the curve library are wrapped for this file only, passing every call through, so that the test can
// see which files were opened and check that the read buffer and the key array are zero afterwards.
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspect } from 'node:util';
import { publicKeyToAddress } from '@dabsproof/evm';
import { BASE_SEPOLIA } from '@dabsproof/registry';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authorise, readPlanForSigning } from '../src/authorise.js';
import { signPlan } from '../src/signer.js';
import { TRANSFER_DOMAIN } from '../src/typed-data.js';
import { walletFolderParts } from '../src/wallet.js';

const seen = vi.hoisted(() => ({
  opened: [] as string[],
  readBuffers: [] as Uint8Array[],
  keys: [] as Uint8Array[],
  /** Key arrays the test made itself; calls with them are not recorded. */
  mine: new WeakSet<Uint8Array>(),
}));

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();
  const openSync = ((path: unknown, ...rest: unknown[]) => {
    seen.opened.push(String(path));
    return (real.openSync as (...a: unknown[]) => number)(path, ...rest);
  }) as typeof real.openSync;
  const readSync = ((fd: number, buffer: Uint8Array, ...rest: unknown[]) => {
    seen.readBuffers.push(buffer);
    return (real.readSync as (...a: unknown[]) => number)(fd, buffer, ...rest);
  }) as typeof real.readSync;
  return { ...real, default: { ...real, openSync, readSync }, openSync, readSync };
});
vi.mock('@noble/curves/secp256k1.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('@noble/curves/secp256k1.js')>();
  const c = real.secp256k1;
  // The library's object is frozen, so the two wrapped functions are defined on a new object that
  // inherits everything else from it.
  const wrapped = Object.create(c, {
    getPublicKey: {
      value: (k: Uint8Array, ...rest: unknown[]) => {
        if (!seen.mine.has(k)) seen.keys.push(k);
        return (c.getPublicKey as (...a: unknown[]) => Uint8Array)(k, ...rest);
      },
    },
    sign: {
      value: (m: Uint8Array, k: Uint8Array, ...rest: unknown[]) => {
        if (!seen.mine.has(k)) seen.keys.push(k);
        return (c.sign as (...a: unknown[]) => Uint8Array)(m, k, ...rest);
      },
    },
  });
  return { ...real, secp256k1: wrapped };
});

const PREFIX = 'signer-test-';
const TMP = realpathSync(tmpdir());
const PAYEE = `0x${'2'.repeat(40)}`;
const FP = `fp1:${'C'.repeat(43)}`;
const fingerprint = () => FP;
const N = secp256k1.Point.Fn.ORDER;

/** A valid secp256k1 secret key from random bytes, as bytes and as lower-case hex. */
function fakeKey(): { bytes: Uint8Array; hex: string; address: string } {
  for (;;) {
    const bytes = new Uint8Array(randomBytes(32));
    if (!secp256k1.utils.isValidSecretKey(bytes)) continue;
    seen.mine.add(bytes);
    return { bytes, hex: bytesToHex(bytes), address: publicKeyToAddress(secp256k1.getPublicKey(bytes, true)) };
  }
}
/** A checked plan for this payer; seed picks the fake random bytes, so two seeds give two nonces. */
function planFor(payer: string, seed = 1) {
  const r = authorise({
    requirements: {
      scheme: 'exact',
      network: BASE_SEPOLIA,
      asset: TRANSFER_DOMAIN.verifyingContract,
      amount: '1000',
      payTo: PAYEE,
      maxTimeoutSeconds: 300,
      extra: { name: 'USDC', version: '2' },
    },
    payer,
    policy: { payees: [PAYEE], perSignatureCap: '100000', perRunCap: '1000000', spentSoFar: '0', excluded: [] },
    clock: () => 1_700_000_000,
    random: (n) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + seed) & 0xff),
  });
  if (!r.ok) throw new Error(r.reason);
  return r.plan;
}

type Home = { home: string; folder: string; file: string; key: ReturnType<typeof fakeKey> };
/** A temp home with the key folder (0700) and a fake buyer.key (0600); removed afterwards. */
function withHome(fn: (h: Home) => void, content?: (k: ReturnType<typeof fakeKey>) => string | Uint8Array) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), PREFIX)));
  try {
    const folder = join(home, ...walletFolderParts());
    mkdirSync(folder, { recursive: true });
    chmodSync(folder, 0o700);
    const key = fakeKey();
    const file = join(folder, 'buyer.key');
    writeFileSync(file, content ? content(key) : `0x${key.hex}\n`);
    chmodSync(file, 0o600);
    fn({ home, folder, file, key });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}
const reasonOf = (r: { ok: boolean; reason?: string }) => (r.ok ? 'ok' : r.reason);
const allZero = (b: Uint8Array) => b.every((x) => x === 0);
/** Every buffer and key array the signer used is zero afterwards. */
function expectWiped() {
  for (const b of seen.readBuffers) expect(allZero(b)).toBe(true);
  for (const k of seen.keys) expect(allZero(k)).toBe(true);
}
/** The 65-byte recovered form (recovery byte first) from a 0x r s v signature. */
const toRecovered = (sig: string) => {
  const b = hexToBytes(sig.slice(2));
  return Uint8Array.from([(b[64] as number) - 27, ...b.subarray(0, 64)]);
};
const take = (payment: { take: () => unknown }) =>
  payment.take() as { authorization: Record<string, string>; signature: string };

beforeEach(() => {
  seen.readBuffers.length = 0;
  seen.keys.length = 0;
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => {
  // No file outside this test's temporary homes was opened, so no real key file was.
  expect(seen.opened.length > 0).toBe(true);
  expect(seen.opened.filter((p) => !p.startsWith(join(TMP, PREFIX)))).toEqual([]);
});

describe('signer: a good plan', () => {
  it('signs the plan digest itself, low s, v 27 or 28, as 0x plus 130 hex, recovering to the payer', () => {
    withHome(({ home, key }) => {
      const plan = planFor(key.address);
      const r = signPlan({ home, plan, fingerprint });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expectWiped();
      const { authorization, signature } = take(r.payment);
      expect(/^0x[0-9a-f]{130}$/.test(signature)).toBe(true);
      const v = Number.parseInt(signature.slice(130), 16);
      expect(v === 27 || v === 28).toBe(true);
      expect(BigInt(`0x${signature.slice(66, 130)}`) <= N / 2n).toBe(true);
      const p = readPlanForSigning(plan);
      if (p === null) throw new Error('plan');
      const digest = hexToBytes(p.digestHex.slice(2));
      const rec = toRecovered(signature);
      const back = publicKeyToAddress(secp256k1.recoverPublicKey(rec, digest, { prehash: false }));
      expect(back).toBe(key.address);
      // Not a signature over a hash of the digest: recovering against sha256 or keccak-256 of the
      // digest gives another address, and the library's default (which hashes first) gives another
      // signature.
      for (const rehashed of [sha256(digest), keccak_256(digest)]) {
        const other = publicKeyToAddress(secp256k1.recoverPublicKey(rec, rehashed, { prehash: false }));
        expect(other).not.toBe(key.address);
      }
      const hashedFirst = secp256k1.sign(digest, key.bytes, { format: 'recovered' });
      expect(bytesToHex(hashedFirst)).not.toBe(bytesToHex(rec));
      expect(authorization).toEqual({
        from: p.from,
        to: p.to,
        value: p.value,
        validAfter: p.validAfter,
        validBefore: p.validBefore,
        nonce: p.nonce,
      });
      expect([r.payment.fp, r.payment.network, r.payment.asset, r.payment.payTo, r.payment.value]).toEqual([
        FP,
        BASE_SEPOLIA,
        TRANSFER_DOMAIN.verifyingContract,
        PAYEE,
        '1000',
      ]);
      expect(Object.isFrozen(r.payment)).toBe(true);
    });
  });

  it('is deterministic for one digest, refuses the same plan twice, and gives two plans two signatures', () => {
    withHome(({ home, key }) => {
      const plan = planFor(key.address, 1);
      const a = signPlan({ home, plan, fingerprint });
      expect(reasonOf(a)).toBe('ok');
      expect(reasonOf(signPlan({ home, plan, fingerprint }))).toBe('plan-already-signed');
      // Another plan object with the same terms, nonce and digest gives the same signature.
      const twin = planFor(key.address, 1);
      const b = signPlan({ home, plan: twin, fingerprint });
      const other = signPlan({ home, plan: planFor(key.address, 2), fingerprint });
      if (!a.ok || !b.ok || !other.ok) throw new Error('sign');
      const sa = take(a.payment).signature;
      expect(take(b.payment).signature).toBe(sa);
      expect(take(other.payment).signature).not.toBe(sa);
    });
  });

  it('take gives the authorization and signature once, then already-sent', () => {
    withHome(({ home, key }) => {
      const r = signPlan({ home, plan: planFor(key.address), fingerprint });
      if (!r.ok) throw new Error(r.reason);
      expect(typeof take(r.payment).signature).toBe('string');
      expect(r.payment.take()).toEqual({ ok: false, reason: 'already-sent' });
      expect(r.payment.take()).toEqual({ ok: false, reason: 'already-sent' });
    });
  });

  it('the payer address agrees with an independent derivation through node:crypto', async () => {
    // The public key from node:crypto, not the curve library; the address computed here, not by the
    // evm package: keccak-256 of the 64-byte public key (without its 0x04 prefix), last 20 bytes.
    const { createECDH } = await import('node:crypto');
    withHome(({ home, key }) => {
      const ecdh = createECDH('secp256k1');
      ecdh.setPrivateKey(Buffer.from(key.bytes));
      const uncompressed = new Uint8Array(ecdh.getPublicKey());
      expect([uncompressed.length, uncompressed[0]]).toEqual([65, 4]);
      const independent = `0x${bytesToHex(keccak_256(uncompressed.subarray(1)).subarray(12))}`;
      expect(independent).toBe(key.address.toLowerCase());
      const good = signPlan({ home, plan: planFor(independent), fingerprint });
      expect(reasonOf(good)).toBe('ok');
      // One character changed at the end gives another address, which the key does not match.
      const last = independent.at(-1);
      const offByOne = `${independent.slice(0, -1)}${last === '0' ? '1' : '0'}`;
      expect(offByOne).not.toBe(independent);
      expect(reasonOf(signPlan({ home, plan: planFor(offByOne), fingerprint }))).toBe('payer-mismatch');
    });
  });
});

describe('signer: each refusal', () => {
  it('a look-alike plan is plan-not-checked', () => {
    withHome(({ home, key }) => {
      const real = planFor(key.address);
      const fake = { ...readPlanForSigning(real), network: BASE_SEPOLIA, asset: real.asset };
      for (const plan of [fake, Object.create(real), null, JSON.parse(JSON.stringify({ real }))]) {
        expect(reasonOf(signPlan({ home, plan, fingerprint }))).toBe('plan-not-checked');
      }
      expect(seen.keys.length).toBe(0);
    });
  });

  it('a home that is not a plain absolute path is key-path-invalid', () => {
    withHome(({ home, key }) => {
      for (const h of ['relative', `${home}/..`, `${home}/`, `${home}\0x`, 7]) {
        expect(reasonOf(signPlan({ home: h, plan: planFor(key.address), fingerprint }))).toBe('key-path-invalid');
      }
    });
  });

  it('a key folder with mode 0755, or one that is a link, is key-folder-mode-wrong', () => {
    withHome(({ home, folder, key }) => {
      chmodSync(folder, 0o755);
      expect(reasonOf(signPlan({ home, plan: planFor(key.address), fingerprint }))).toBe('key-folder-mode-wrong');
      chmodSync(folder, 0o700);
      // Another home whose key folder is a link to the real-looking one.
      const other = realpathSync(mkdtempSync(join(tmpdir(), PREFIX)));
      try {
        const linkHome = join(other, ...walletFolderParts().slice(0, -1));
        mkdirSync(linkHome, { recursive: true });
        symlinkSync(folder, join(linkHome, walletFolderParts().at(-1) ?? ''));
        expect(reasonOf(signPlan({ home: other, plan: planFor(key.address), fingerprint }))).toBe(
          'key-folder-mode-wrong',
        );
      } finally {
        rmSync(other, { recursive: true, force: true });
      }
    });
  });

  it('a key file with mode 0644 is key-file-mode-wrong', () => {
    withHome(({ home, file, key }) => {
      chmodSync(file, 0o644);
      expect(reasonOf(signPlan({ home, plan: planFor(key.address), fingerprint }))).toBe('key-file-mode-wrong');
    });
  });

  it('a key file that is a link is key-file-is-link, and its target is untouched', () => {
    withHome(({ home, folder, file, key }) => {
      const target = join(folder, 'target');
      writeFileSync(target, `0x${key.hex}\n`);
      chmodSync(target, 0o600);
      const before = lstatSync(target).mtimeMs;
      rmSync(file);
      symlinkSync(target, file);
      expect(reasonOf(signPlan({ home, plan: planFor(key.address), fingerprint }))).toBe('key-file-is-link');
      expect(readFileSync(target, 'utf8')).toBe(`0x${key.hex}\n`);
      expect(lstatSync(target).mtimeMs).toBe(before);
    });
  });

  it('a missing key file is key-file-missing', () => {
    withHome(({ home, file, key }) => {
      rmSync(file);
      expect(reasonOf(signPlan({ home, plan: planFor(key.address), fingerprint }))).toBe('key-file-missing');
    });
  });

  it('a key file of the wrong size is key-file-mode-wrong (an extra byte, no 0x, or no newline that shortens it)', () => {
    for (const content of [
      (k: { hex: string }) => `0x${k.hex}\n\n`,
      (k: { hex: string }) => `${k.hex}\n`,
      (k: { hex: string }) => `0x${k.hex}`,
      () => '',
    ]) {
      withHome(({ home, key }) => {
        expect(reasonOf(signPlan({ home, plan: planFor(key.address), fingerprint }))).toBe('key-file-mode-wrong');
      }, content);
    }
  });

  const malformed: [string, (k: { hex: string }) => string][] = [
    ['upper-case hex', (k) => `0x${k.hex.toUpperCase()}\n`],
    ['no 0x at the start, length kept', (k) => `00${k.hex}\n`],
    ['no newline at the end, length kept', (k) => `0x${k.hex}x`],
    ['an extra byte in place of the newline', (k) => `0x${k.hex}0`],
    ['a non-hex character', (k) => `0x${k.hex.slice(0, 63)}g\n`],
    ['a key of zero', () => `0x${'0'.repeat(64)}\n`],
    ['a key equal to the curve order', () => `0x${N.toString(16).padStart(64, '0')}\n`],
    ['a key above the curve order', () => `0x${'f'.repeat(64)}\n`],
  ];
  for (const [name, content] of malformed) {
    it(`a key file with ${name} is key-file-malformed`, () => {
      withHome(({ home, key }) => {
        expect(reasonOf(signPlan({ home, plan: planFor(key.address), fingerprint }))).toBe('key-file-malformed');
        expectWiped();
      }, content);
    });
  }

  it('a key for another address is payer-mismatch, and the key array is zeroed', () => {
    withHome(({ home, key }) => {
      const other = fakeKey();
      expect(other.address).not.toBe(key.address);
      expect(reasonOf(signPlan({ home, plan: planFor(other.address), fingerprint }))).toBe('payer-mismatch');
      expect(seen.keys.length).toBe(1);
      expectWiped();
    });
  });

  it('a fingerprint function that throws, or gives the wrong shape, is sign-failed before the key is opened', () => {
    withHome(({ home, key }) => {
      const bad: unknown[] = [
        () => {
          throw new Error('zz marker zz');
        },
        () => 'fp1:short',
        () => `fp2:${'C'.repeat(43)}`,
        () => 42,
        'not a function',
        undefined,
      ];
      for (const f of bad) {
        const opened = seen.opened.length;
        const r = signPlan({ home, plan: planFor(key.address), fingerprint: f });
        expect(r).toEqual({ ok: false, reason: 'sign-failed' });
        expect(seen.opened.length).toBe(opened);
      }
      expect(seen.keys.length).toBe(0);
    });
  });
});

describe('signer: what can be seen', () => {
  it('no key, signature, nonce or digest appears in any result, form or output; take is the only way out', () => {
    withHome(({ home, file, key }) => {
      const out: string[] = [];
      const grab = (...a: unknown[]) => {
        out.push(a.map((x) => (typeof x === 'string' ? x : inspect(x))).join(' '));
        return true;
      };
      for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, m).mockImplementation(grab);
      vi.spyOn(process.stdout, 'write').mockImplementation(grab);
      vi.spyOn(process.stderr, 'write').mockImplementation(grab);

      const plan = planFor(key.address);
      const p = readPlanForSigning(plan);
      if (p === null) throw new Error('plan');
      const ok = signPlan({ home, plan, fingerprint });
      if (!ok.ok) throw new Error(ok.reason);
      const failures: unknown[] = [
        signPlan({ home, plan, fingerprint }),
        signPlan({ home, plan: { ...p }, fingerprint }),
        signPlan({ home: 'x', plan: planFor(key.address, 3), fingerprint }),
        signPlan({ home, plan: planFor(fakeKey().address, 4), fingerprint }),
        signPlan({ home, plan: planFor(key.address, 5), fingerprint: () => p.nonce }),
      ];
      chmodSync(file, 0o644);
      failures.push(signPlan({ home, plan: planFor(key.address, 6), fingerprint }));
      const forms = [ok, ok.payment, ...failures].flatMap((x) => [
        JSON.stringify(x),
        String(x),
        inspect(x, { depth: 9 }),
      ]);
      const { signature, authorization } = take(ok.payment);
      expect(authorization.nonce).toBe(p.nonce);
      const canaries = [
        key.hex,
        `0x${key.hex}`,
        signature,
        signature.slice(2),
        p.nonce,
        p.nonce.slice(2),
        p.digestHex,
        p.digestHex.slice(2),
        String.fromCharCode(...key.bytes),
        key.bytes.join(','),
      ];
      const text = [...forms, ...out].join('\n');
      for (const c of canaries) expect(text.includes(c)).toBe(false);
      expect(forms.slice(3, 6)).toEqual(['"[SignedPayment]"', '[SignedPayment]', '[SignedPayment]']);
    });
  });

  it('no result holds the temp path or any error text', () => {
    withHome(({ home, folder, file, key }) => {
      const results: unknown[] = [signPlan({ home, plan: planFor(key.address), fingerprint })];
      chmodSync(folder, 0o755);
      results.push(signPlan({ home, plan: planFor(key.address, 2), fingerprint }));
      chmodSync(folder, 0o700);
      rmSync(file);
      results.push(signPlan({ home, plan: planFor(key.address, 3), fingerprint }));
      results.push(signPlan({ home: `${home}/missing`, plan: planFor(key.address, 4), fingerprint }));
      results.push(
        signPlan({
          home,
          plan: planFor(key.address, 5),
          fingerprint: () => {
            throw new Error(home);
          },
        }),
      );
      const text = JSON.stringify(results);
      expect(text.includes(home) || text.includes(TMP)).toBe(false);
      expect(/Error|errno|syscall|ENOENT|ELOOP|EACCES/.test(text)).toBe(false);
    });
  });

  it('the key file is unchanged in bytes and mtime after every call, and no other file is made in the home', () => {
    withHome(({ home, file, key }) => {
      const bytes = readFileSync(file);
      const mtime = lstatSync(file).mtimeMs;
      const listing = () => readdirSync(home, { recursive: true }).map(String).sort();
      const names = listing();
      const plans = [planFor(key.address, 1), planFor(key.address, 1), planFor(key.address, 2)];
      for (const plan of plans) {
        signPlan({ home, plan, fingerprint });
        signPlan({ home, plan, fingerprint });
        expect(readFileSync(file).equals(bytes)).toBe(true);
        expect(lstatSync(file).mtimeMs).toBe(mtime);
      }
      signPlan({ home, plan: planFor(fakeKey().address), fingerprint });
      expect(readFileSync(file).equals(bytes)).toBe(true);
      expect(lstatSync(file).mtimeMs).toBe(mtime);
      expect(listing()).toEqual(names);
      expect(names).toEqual([
        '.config',
        walletFolderParts().slice(0, 2).join('/'),
        walletFolderParts().slice(0, 3).join('/'),
        walletFolderParts().join('/'),
        `${walletFolderParts().join('/')}/buyer.key`,
      ]);
    });
  });

  it('the read buffer and the key array are zero after a successful call', () => {
    withHome(({ home, key }) => {
      const r = signPlan({ home, plan: planFor(key.address), fingerprint });
      expect(r.ok).toBe(true);
      expect(seen.readBuffers.length > 0).toBe(true);
      expect(seen.keys.length).toBe(2);
      expectWiped();
    });
  });
});
