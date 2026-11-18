import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { brand } from '@dabsproof/brand';
import { describe, expect, it } from 'vitest';
import { run } from '../src/index.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const bin = fileURLToPath(new URL('../dist/bin.js', import.meta.url));
const exec = (...args: string[]) => spawnSync(process.execPath, [bin, ...args], { cwd: root, encoding: 'utf8' });

describe('command name', () => {
  it('is cliName from brand.config.json (the second exception in CLAUDE.md)', () => {
    expect(Object.keys(pkg.bin)).toEqual([brand.cliName]);
  });
});

describe('run()', () => {
  it('exits 2 with usage for a wrong command or a missing file', () => {
    expect(run([]).exitCode).toBe(2);
    expect(run(['scan', 'x.json']).exitCode).toBe(2);
    expect(run(['check']).exitCode).toBe(2);
    expect(run(['check', 'a.json', 'b.json']).exitCode).toBe(2);
  });
  it('exits 2 for a file that does not exist, and never reads an environment file', () => {
    expect(run(['check', 'no-such-file.json']).exitCode).toBe(2);
    expect(run(['check', '.env']).stderr).toContain('Environment files are never read.');
  });
});

describe('built command, run as a seller would (step 0.7 exit test)', () => {
  it('shared.json reports the 7-route clash and exits 1', () => {
    const r = exec('check', 'fixtures/manifests/shared.json');
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('### X402-03.cross-route: found a problem (severity: medium)');
    expect(r.stdout.split('(`0x0000…0010`)').length - 1).toBe(7);
  });
  it('hd.json exits 0', () => {
    expect(exec('check', 'fixtures/manifests/hd.json').status).toBe(0);
  });
  it('hd-dup-index.json exits 1', () => {
    expect(exec('check', 'fixtures/manifests/hd-dup-index.json').status).toBe(1);
  });
  it('mainnet.json exits 2: nothing was checked', () => {
    const r = exec('check', 'fixtures/manifests/mainnet.json');
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('Nothing was checked: only Base Sepolia is checked.');
  });
});
