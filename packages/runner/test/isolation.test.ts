// The CLI promises it sends nothing anywhere, so it must not depend on or import the runner.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
    expect(specifiers.sort()).toEqual(['@dabsproof/registry', 'node:path']);
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
});
