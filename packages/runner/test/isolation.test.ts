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
});
