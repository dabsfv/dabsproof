// The CLI promises it sends nothing anywhere, so it must not depend on or import the runner.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brand } from '@dabsproof/brand';
import { describe, expect, it } from 'vitest';

const CLI = fileURLToPath(new URL('../../cli/', import.meta.url));
const NAME = '@dabsproof/runner';

describe('isolation', () => {
  it('the CLI does not depend on or import the runner', () => {
    const pkg = JSON.parse(readFileSync(join(CLI, 'package.json'), 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
    expect(Object.keys(deps).includes(NAME)).toBe(false);
    const src = join(CLI, 'src');
    const files = readdirSync(src, { recursive: true })
      .map((f) => join(src, String(f)))
      .filter((f) => statSync(f).isFile());
    expect(files.length > 0).toBe(true);
    expect(files.filter((f) => readFileSync(f, 'utf8').includes(NAME)).length).toBe(0);
    // The runner's own source never reaches into the apps; only its tests may use the demo seller.
    const own = fileURLToPath(new URL('../src/', import.meta.url));
    const ownFiles = readdirSync(own, { recursive: true })
      .map((f) => join(own, String(f)))
      .filter((f) => statSync(f).isFile());
    expect(ownFiles.length > 0).toBe(true);
    expect(ownFiles.filter((f) => readFileSync(f, 'utf8').includes('apps/')).length).toBe(0);
    // The stand-in facilitator stays inside the runner: no tracked file elsewhere calls it, imports the
    // runner, or is named standin.ts, and the runner stays private (never published).
    const root = fileURLToPath(new URL('../../../', import.meta.url));
    const outside = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
      .split('\0')
      .filter((f) => f !== '' && !f.startsWith('packages/runner/'));
    expect(outside.length > 0).toBe(true);
    const IMPORTS_RUNNER = /(?:from|import\()\s*['"`][^'"`]*(?:@dabsproof\/runner|packages\/runner\/)/;
    const texts = outside.map((f) => readFileSync(join(root, f), 'utf8'));
    expect(texts.filter((t) => t.includes('startStandIn')).length).toBe(0);
    expect(texts.filter((t) => IMPORTS_RUNNER.test(t)).length).toBe(0);
    expect(outside.filter((f) => basename(f) === 'standin.ts').length).toBe(0);
    expect(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).private).toBe(true);
    // The wallet stays inside the runner: the CLI does not import it, no tracked file elsewhere names its
    // files, its source makes no network call, and its tests never read the real home folder.
    expect(files.filter((f) => /wallet(\.js|-cli)/.test(readFileSync(f, 'utf8'))).length).toBe(0);
    expect(texts.filter((t) => t.includes('wallet.ts') || t.includes('wallet-cli')).length).toBe(0);
    const NETWORK_USE = /\bfetch\s*\(|['"`](?:node:)?(?:http|https|net|dns)['"`]/;
    for (const name of ['wallet.ts', 'wallet-cli.ts']) {
      expect(NETWORK_USE.test(readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8'))).toBe(false);
    }
    const walletTest = readFileSync(new URL('./wallet.test.ts', import.meta.url), 'utf8');
    expect(walletTest.includes('process.env.HOME') || walletTest.includes('homedir(')).toBe(false);
  });

  it('chain.ts starts nothing, reads no environment, and stays inside the runner', async () => {
    const source = readFileSync(new URL('../src/chain.ts', import.meta.url), 'utf8');
    // (a) No module that starts a process or uses the network, no fetch, and nothing read from HOME or
    // the environment.
    const STARTS_OR_SENDS =
      /['"`](?:node:)?(?:child_process|net|http|https|http2|dns|tls|dgram|cluster|worker_threads)['"`]|\bfetch\s*\(|\bspawn|\bexec(?:File)?(?:Sync)?\s*\(|process\.env|homedir/;
    expect(STARTS_OR_SENDS.test(source)).toBe(false);
    const specifiers = [...source.matchAll(/^import [^;]*? from ['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    expect(specifiers.sort()).toEqual(['@dabsproof/brand', '@dabsproof/registry', 'node:path']);
    // (b) No tracked file outside the runner's src/ and test/ names chain.ts or any of its exports; the
    // CLI's source names none of them either.
    const chain = await import('../src/chain.js');
    const names = ['chain.ts', ...Object.keys(chain), 'ChainOptionsInput', 'ChainOptions', 'ChainReason'];
    expect(names.length > 4).toBe(true);
    const root = fileURLToPath(new URL('../../../', import.meta.url));
    const elsewhere = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
      .split('\0')
      .filter((f) => f !== '' && !f.startsWith('packages/runner/src/') && !f.startsWith('packages/runner/test/'));
    expect(elsewhere.length > 0).toBe(true);
    const named = elsewhere.filter((f) => {
      const t = readFileSync(join(root, f), 'utf8');
      return names.some((n) => t.includes(n));
    });
    expect(named).toEqual([]);
    const cliSrc = join(CLI, 'src');
    const cliFiles = readdirSync(cliSrc, { recursive: true })
      .map((f) => join(cliSrc, String(f)))
      .filter((f) => statSync(f).isFile());
    expect(cliFiles.filter((f) => names.some((n) => readFileSync(f, 'utf8').includes(n))).length).toBe(0);
  });

  it('chain-process.ts sends only through the runner, reads no environment, and stays inside the runner', async () => {
    const source = readFileSync(new URL('../src/chain-process.ts', import.meta.url), 'utf8');
    // No fetch of its own (it polls through sendLocalJson), no HOME and no environment value read at
    // all: process.env is allowed nowhere in this file. The child's environment is exactly the fixed
    // PATH below, and no state, funding or impersonation flag is named.
    expect(/\bfetch\s*\(/.test(source)).toBe(false);
    expect(source.includes('process.env')).toBe(false);
    expect(source.includes('homedir')).toBe(false);
    expect(source.includes("Object.freeze({ PATH: '/usr/bin:/bin' })")).toBe(true);
    for (const flag of [
      '--state',
      '--dump-state',
      '--load-state',
      '--fund-accounts',
      '--auto-impersonate',
      '--no-storage-caching',
      '--retries',
      '--timeout',
      '--fork-header',
    ]) {
      expect(source.includes(flag)).toBe(false);
    }
    expect(source.includes('shell: false')).toBe(true);
    // No tracked file outside the runner's src/ and test/ names chain-process.ts or its exports; the
    // CLI's source names none of them either.
    const mod = await import('../src/chain-process.js');
    const names = [
      'chain-process.ts',
      ...Object.keys(mod),
      'ChainProcessInput',
      'ChainProcessReason',
      'ChainProcess',
      'ChainStopResult',
    ];
    expect(names.length > 4).toBe(true);
    const root = fileURLToPath(new URL('../../../', import.meta.url));
    const elsewhere = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
      .split('\0')
      .filter((f) => f !== '' && !f.startsWith('packages/runner/src/') && !f.startsWith('packages/runner/test/'));
    expect(elsewhere.length > 0).toBe(true);
    const named = elsewhere.filter((f) => {
      const t = readFileSync(join(root, f), 'utf8');
      return names.some((n) => t.includes(n));
    });
    expect(named).toEqual([]);
    const cliSrc = join(CLI, 'src');
    const cliFiles = readdirSync(cliSrc, { recursive: true })
      .map((f) => join(cliSrc, String(f)))
      .filter((f) => statSync(f).isFile());
    expect(cliFiles.filter((f) => names.some((n) => readFileSync(f, 'utf8').includes(n))).length).toBe(0);
  });

  it('facilitator-local stays private and apart: the CLI and evm neither depend on nor import it, @x402/evm or viem', () => {
    const root = fileURLToPath(new URL('../../../', import.meta.url));
    const PKGS = ['@dabsproof/facilitator-local', '@x402/evm', 'viem'];
    // An import or require of one of these packages, or a subpath of one, by its specifier (a comment
    // that only names a package is not an import).
    const IMPORTS =
      /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)['"`](?:@dabsproof\/facilitator-local|@x402\/evm|viem)(?:\/[^'"`]*)?['"`]/m;
    const filesUnder = (dir: string) =>
      readdirSync(dir, { recursive: true })
        .map((f) => join(dir, String(f)))
        .filter((f) => statSync(f).isFile());
    for (const pkgDir of ['packages/cli', 'packages/evm']) {
      const pkg = JSON.parse(readFileSync(join(root, pkgDir, 'package.json'), 'utf8'));
      const deps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
        ...pkg.optionalDependencies,
      };
      expect(Object.keys(deps).filter((d) => PKGS.includes(d))).toEqual([]);
      const src = filesUnder(join(root, pkgDir, 'src'));
      expect(src.length > 0).toBe(true);
      expect(src.filter((f) => IMPORTS.test(readFileSync(f, 'utf8'))).length).toBe(0);
    }
    // It stays private.
    const own = JSON.parse(readFileSync(join(root, 'packages/facilitator-local/package.json'), 'utf8'));
    expect(own.private).toBe(true);
    // Its start function is named only inside its own package and the runner's tests.
    const elsewhere = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
      .split('\0')
      .filter(
        (f) => f !== '' && !f.startsWith('packages/facilitator-local/') && !f.startsWith('packages/runner/test/'),
      );
    expect(elsewhere.length > 0).toBe(true);
    expect(elsewhere.filter((f) => readFileSync(join(root, f), 'utf8').includes('startLocalFacilitator'))).toEqual([]);
    // Its source holds no URL, no host name and no environment read.
    const ownSrc = filesUnder(join(root, 'packages/facilitator-local/src'));
    expect(ownSrc.length > 0).toBe(true);
    const HOST_NAME = /\blocalhost\b|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|io|dev|xyz|app|test|local|sh|co)\b/i;
    for (const f of ownSrc) {
      const t = readFileSync(f, 'utf8');
      expect(/https?:\/\//i.test(t)).toBe(false);
      expect(HOST_NAME.test(t)).toBe(false);
      expect(t.includes('process.env')).toBe(false);
    }
  });

  it('chain-process.ts builds only its loopback origin, touches state files by metadata only, and the fake anvil stays in its test', () => {
    const source = readFileSync(new URL('../src/chain-process.ts', import.meta.url), 'utf8');
    // The file builds its own loopback target text, so exactly one URL form is allowed, once:
    // http://127.0.0.1:<port>, written as http:// followed by ANVIL_HOST and the port. No https://.
    const ORIGIN = `http://${'$'}{ANVIL_HOST}:${'$'}{launch.port}`;
    expect(source.split('://').length - 1).toBe(1);
    expect(source.includes(`\`${ORIGIN}\``)).toBe(true);
    expect(/https:/i.test(source)).toBe(false);
    // No host name of any kind.
    const HOST_NAME = /\blocalhost\b|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|io|dev|xyz|app|test|local|sh|co)\b/i;
    expect(HOST_NAME.test(source)).toBe(false);
    // node:fs is used for lstatSync only: nothing is read, written, created, moved or removed.
    expect(source.match(/^import [^;]*? from 'node:fs';$/gm)).toEqual(["import { lstatSync } from 'node:fs';"]);
    const FS_WRITES_OR_READS =
      /\b(?:readFile|readFileSync|writeFile|writeFileSync|appendFile|mkdir|mkdirSync|rmSync|rmdir|unlink|unlinkSync|openSync|createReadStream|createWriteStream|truncate|truncateSync|copyFile|rename|renameSync|symlink|readdir|readdirSync)\b/;
    expect(FS_WRITES_OR_READS.test(source)).toBe(false);
    // The fake anvil's text lives only in its own test file; the runner's source never names it.
    const BEGIN = ['// fake', 'anvil', 'begins'].join(' ');
    const END = ['// fake', 'anvil', 'ends'].join(' ');
    const fakeFile = readFileSync(new URL('./chain-process.fake.test.ts', import.meta.url), 'utf8');
    const start = fakeFile.indexOf(BEGIN);
    const end = fakeFile.indexOf(END);
    expect(start > 0 && end > start).toBe(true);
    const fakeText = fakeFile.slice(start, end);
    expect(/\bfetch\s*\(/.test(fakeText)).toBe(false);
    expect(/https?:\/\//i.test(fakeText)).toBe(false);
    expect(HOST_NAME.test(fakeText)).toBe(false);
    expect([...new Set(fakeText.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? [])]).toEqual(['127.0.0.1']);
    expect(fakeText.includes("listen(Number(flag('--port')), '127.0.0.1')")).toBe(true);
    const own = fileURLToPath(new URL('../src/', import.meta.url));
    const srcFiles = readdirSync(own, { recursive: true })
      .map((f) => join(own, String(f)))
      .filter((f) => statSync(f).isFile());
    expect(srcFiles.filter((f) => /fake[ -]anvil/i.test(readFileSync(f, 'utf8'))).length).toBe(0);
    // The four fork limits are named only in chain.ts, where buildAnvilArgs adds them; no other source
    // file builds them by hand.
    const FORK_LIMIT_FLAGS = ['--no-storage-caching', '--retries', '--timeout', '--fork-header'];
    const naming = srcFiles.filter((f) => FORK_LIMIT_FLAGS.some((flag) => readFileSync(f, 'utf8').includes(flag)));
    expect(naming.map((f) => basename(f))).toEqual(['chain.ts']);
  });

  it('no runner source file names the product, except as the npm scope in an import specifier', () => {
    // The brand rule: the product name and slugs live in brand.config.json and packages/brand only.
    // The names to look for come from the brand package, not from text written here.
    const names = [...new Set([brand.slug, brand.productName, brand.cliName].map((n) => n.toLowerCase()))];
    const scope = brand.npmScope.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // A quoted specifier that begins with the npm scope and a slash, such as an import's from text.
    const SPECIFIER = new RegExp(`(['"\`])${scope}/[a-z0-9-]+(?:/[^'"\`]*)?\\1`, 'gi');
    const own = fileURLToPath(new URL('../src/', import.meta.url));
    const srcFiles = readdirSync(own, { recursive: true })
      .map((f) => join(own, String(f)))
      .filter((f) => statSync(f).isFile() && f.endsWith('.ts'));
    expect(srcFiles.length > 0).toBe(true);
    const naming = srcFiles.filter((f) => {
      const text = readFileSync(f, 'utf8').replace(SPECIFIER, '').toLowerCase();
      return names.some((n) => text.includes(n));
    });
    expect(naming.map((f) => basename(f))).toEqual([]);
  });

  it('fund.ts talks only to the local chain, owns the funding methods, and its fake stays in its test', () => {
    const source = readFileSync(new URL('../src/fund.ts', import.meta.url), 'utf8');
    // One URL form only, once: the loopback origin built from ANVIL_HOST and the chain's port.
    const ORIGIN = `http://${'$'}{ANVIL_HOST}:${'$'}{input.chain.port}`;
    expect(source.split('://').length - 1).toBe(1);
    expect(source.includes(`\`${ORIGIN}\``)).toBe(true);
    expect(/https:/i.test(source)).toBe(false);
    const HOST_NAME = /\blocalhost\b|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|io|dev|xyz|app|test|local|sh|co)\b/i;
    expect(HOST_NAME.test(source)).toBe(false);
    // No environment, no file use, no fetch of its own, no anvil flag text; only the runner's own modules.
    expect(source.includes('process.env')).toBe(false);
    expect(/\bfetch\s*\(/.test(source)).toBe(false);
    expect(/['"`](?:node:)?fs['"`]/.test(source)).toBe(false);
    expect(/(?:^|[^A-Za-z0-9])--[a-z]/.test(source)).toBe(false);
    const specifiers = [...source.matchAll(/^import [^;]*? from ['"]([^'"]+)['"]/gm)].map((m) => m[1] ?? '');
    expect(specifiers.length > 0).toBe(true);
    expect(specifiers.every((s) => s.startsWith('./'))).toBe(true);
    // The state-changing funding methods are named in fund.ts only; no runner source file names a
    // balance-writing or storage-writing helper, or automatic impersonation.
    const own = fileURLToPath(new URL('../src/', import.meta.url));
    const srcFiles = readdirSync(own, { recursive: true })
      .map((f) => join(own, String(f)))
      .filter((f) => statSync(f).isFile());
    const FUNDING = [
      'anvil_setBalance',
      'anvil_impersonateAccount',
      'anvil_stopImpersonatingAccount',
      'eth_sendTransaction',
      'eth_getTransactionReceipt',
    ];
    const naming = srcFiles.filter((f) => FUNDING.some((m) => readFileSync(f, 'utf8').includes(m)));
    expect(naming.map((f) => basename(f))).toEqual(['fund.ts']);
    const BANNED = ['anvil_dealERC20', 'anvil_setStorageAt', 'anvil_autoImpersonateAccount', 'auto-impersonate'];
    expect(srcFiles.filter((f) => BANNED.some((b) => readFileSync(f, 'utf8').includes(b))).length).toBe(0);
    // The funding fake's text lives only in its own test file, and stays on 127.0.0.1.
    const BEGIN = ['// fake', 'anvil', 'begins'].join(' ');
    const END = ['// fake', 'anvil', 'ends'].join(' ');
    const fakeFile = readFileSync(new URL('./fund.fake.test.ts', import.meta.url), 'utf8');
    const start = fakeFile.indexOf(BEGIN);
    const end = fakeFile.indexOf(END);
    expect(start > 0 && end > start).toBe(true);
    const fakeText = fakeFile.slice(start, end);
    expect(/\bfetch\s*\(/.test(fakeText)).toBe(false);
    expect(/https?:\/\//i.test(fakeText)).toBe(false);
    expect(HOST_NAME.test(fakeText)).toBe(false);
    expect([...new Set(fakeText.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? [])]).toEqual(['127.0.0.1']);
    expect(fakeText.includes("listen(Number(flag('--port')), '127.0.0.1')")).toBe(true);
  });

  it('only the opt-in fork test names the public endpoint and its own port, and it sends just its pin request', () => {
    const root = fileURLToPath(new URL('../../../', import.meta.url));
    const FILE = 'packages/runner/test/fund.fork.test.mjs';
    // Built from parts so that this file does not hold the texts it looks for.
    const HOST = ['sepolia', 'base', 'org'].join('.');
    const PORT_TEXT = String(18549 + 1);
    // Tracked files and new files not yet committed (ignored files excluded), read as text.
    const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd: root,
      encoding: 'utf8',
    })
      .split('\0')
      .filter((f) => f !== '' && existsSync(join(root, f)) && statSync(join(root, f)).isFile());
    expect(files.includes(FILE)).toBe(true);
    const text = (f: string) => readFileSync(join(root, f), 'utf8');
    // The endpoint's host, with or without https://, appears in that one file only: no src/ file, no
    // other test, no tool and no workflow names it.
    expect(files.filter((f) => text(f).includes(HOST))).toEqual([FILE]);
    // The port is named in that one file only (the lockfile is left out: its hashes are not text).
    expect(files.filter((f) => f !== 'pnpm-lock.yaml' && text(f).includes(PORT_TEXT))).toEqual([FILE]);

    const source = text(FILE);
    // Exactly two URL forms: the endpoint, and the loopback origin on its own port.
    const urls = source.match(/\b[a-z][a-z0-9+.-]*:\/\/[^\s'"`]*/gi) ?? [];
    expect(urls).toEqual([`https://${HOST}`, `http://127.0.0.1:${'$'}{PORT}`]);
    expect([...new Set(source.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? [])]).toEqual(['127.0.0.1']);
    expect(source.includes(`const PORT = ${PORT_TEXT};`)).toBe(true);
    // One fetch only, the pin request, with no credentials, no redirect followed and a deadline.
    expect(source.match(/\bfetch\s*\(/g)?.length).toBe(1);
    expect(source.includes('fetch(FORK_URL, {')).toBe(true);
    for (const part of [
      "'User-Agent': 'repo-check'",
      "credentials: 'omit'",
      "redirect: 'manual'",
      'signal: AbortSignal.timeout(PIN_DEADLINE_MS)',
      'const PIN_DEADLINE_MS = 10_000;',
      'const PIN_MAX_BYTES = 64 * 1024;',
    ]) {
      expect(source.includes(part)).toBe(true);
    }
    expect(/authorization|cookie/i.test(source)).toBe(false);
    // It runs only when both variables are set, and is skipped otherwise.
    expect(source.includes("const ASKED = process.env.DABSPROOF_FORK_TEST === '1';")).toBe(true);
    expect(source.includes('const READY = ASKED && typeof BIN === ')).toBe(true);
    expect(source.includes('const run = READY ? describe : describe.skip;')).toBe(true);
    // No viem, no file module, no process started, and no funding method of its own: the funding
    // methods stay in fund.ts.
    const IMPORTS_VIEM = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)['"`]viem(?:\/[^'"`]*)?['"`]/m;
    expect(IMPORTS_VIEM.test(source)).toBe(false);
    expect(/['"`](?:node:)?(?:fs|fs\/promises|child_process)['"`]/.test(source)).toBe(false);
    expect(
      /\b(?:writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|mkdir|mkdirSync)\b/.test(source),
    ).toBe(false);
    for (const m of [
      'anvil_setBalance',
      'anvil_impersonateAccount',
      'anvil_stopImpersonatingAccount',
      'eth_sendTransaction',
      'anvil_dealERC20',
      'anvil_setStorageAt',
    ]) {
      expect(source.includes(m)).toBe(false);
    }
  });

  it('typed-data.ts imports only hashing and the shared constants, does no input or output, and stays inside the runner', () => {
    const source = readFileSync(new URL('../src/typed-data.ts', import.meta.url), 'utf8');
    const specifiers = [...source.matchAll(/^import [^;]*? from ['"]([^'"]+)['"]/gm)].map((m) => m[1] ?? '');
    expect(specifiers.length > 0).toBe(true);
    const ALLOWED = ['@dabsproof/evm', '@dabsproof/registry', '@dabsproof/brand', 'node:buffer'];
    for (const s of specifiers) {
      const ok = ALLOWED.includes(s) || s === '@noble/hashes' || s.startsWith('@noble/hashes/') || s.startsWith('./');
      expect(ok, s).toBe(true);
    }
    // No dynamic import or require either, so the list above is the whole list.
    expect(/\bimport\s*\(|\brequire\s*\(/.test(source)).toBe(false);
    for (const banned of [
      'console',
      'process.stdout',
      'process.stderr',
      'process.env',
      'node:fs',
      'node:child_process',
      'node:net',
    ]) {
      expect(source.includes(banned), banned).toBe(false);
    }
    expect(/\bfetch\s*\(/.test(source)).toBe(false);
    // Nothing outside the runner names the file or its exports: tracked files and new files not yet
    // committed, ignored files left out.
    const root = fileURLToPath(new URL('../../../', import.meta.url));
    const outside = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd: root,
      encoding: 'utf8',
    })
      .split('\0')
      .filter((f) => f !== '' && !f.startsWith('packages/runner/') && existsSync(join(root, f)))
      .filter((f) => statSync(join(root, f)).isFile());
    expect(outside.length > 0).toBe(true);
    const NAMES = ['typed-data', 'transferDigest', 'TRANSFER_DOMAIN_SEPARATOR', 'TRANSFER_DOMAIN'];
    expect(outside.filter((f) => NAMES.some((n) => readFileSync(join(root, f), 'utf8').includes(n)))).toEqual([]);
  });

  it('authorise.ts imports only the allowed modules, has no time, randomness or output of its own, and stays inside the runner', () => {
    const source = readFileSync(new URL('../src/authorise.ts', import.meta.url), 'utf8');
    const specifiers = [...source.matchAll(/^import [^;]*? from ['"]([^'"]+)['"]/gm)].map((m) => m[1] ?? '');
    expect(specifiers.length > 0).toBe(true);
    const ALLOWED = ['@dabsproof/registry', '@dabsproof/evm', '@dabsproof/brand'];
    for (const s of specifiers) expect(ALLOWED.includes(s) || s.startsWith('./'), s).toBe(true);
    expect(/\bimport\s*\(|\brequire\s*\(/.test(source)).toBe(false);
    for (const banned of [
      'node:crypto',
      'node:fs',
      'node:child_process',
      'node:net',
      'console',
      'process.stdout',
      'process.stderr',
      'process.env',
      'Date.now',
      'Math.random',
    ]) {
      expect(source.includes(banned), banned).toBe(false);
    }
    expect(/\bfetch\s*\(/.test(source)).toBe(false);
    // The nonce and digest are read through readPlanForSigning only. For now no other runner source
    // file names it; when the signer is written, only signer.ts may.
    const own = fileURLToPath(new URL('../src/', import.meta.url));
    const srcFiles = readdirSync(own, { recursive: true })
      .map((f) => join(own, String(f)))
      .filter((f) => statSync(f).isFile());
    expect(
      srcFiles.filter((f) => readFileSync(f, 'utf8').includes('readPlanForSigning')).map((f) => basename(f)),
    ).toEqual(['authorise.ts']);
    // Nothing outside the runner names the file or its exports (tracked and new files, ignored left out).
    const root = fileURLToPath(new URL('../../../', import.meta.url));
    const outside = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd: root,
      encoding: 'utf8',
    })
      .split('\0')
      .filter((f) => f !== '' && !f.startsWith('packages/runner/') && existsSync(join(root, f)))
      .filter((f) => statSync(join(root, f)).isFile());
    expect(outside.length > 0).toBe(true);
    const NAMES = ['authorise.ts', 'readPlanForSigning', 'isCheckedPlan', 'CheckedPlan', 'AuthoriseReason'];
    expect(outside.filter((f) => NAMES.some((n) => readFileSync(join(root, f), 'utf8').includes(n)))).toEqual([]);
  });
});
