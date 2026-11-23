// The CLI promises it sends nothing anywhere, so it must not depend on or import the runner.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
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
  });
});
