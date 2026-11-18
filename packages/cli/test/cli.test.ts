import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { brand } from '@dabsproof/brand';
import { describe, expect, it } from 'vitest';
import { run } from '../src/index.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const bin = fileURLToPath(new URL('../dist/bin.js', import.meta.url));
const spawn = (...args: string[]) => spawnSync(process.execPath, [bin, ...args], { cwd: root, encoding: 'utf8' });
/** Markdown output unless a test names a format: the earlier tests check Markdown text. */
const exec = (...args: string[]) => spawn(...args, ...(args.includes('--format') ? [] : ['--format', 'markdown']));

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
    const start = r.stdout.indexOf('### X402-03.cross-route');
    const section = r.stdout.slice(start, r.stdout.indexOf('###', start + 4));
    expect(section.split('(`0x0000…0010`)').length - 1).toBe(7);
  });
  it('hd-per-resource.json exits 0 (moved here from hd.json in step 1.3)', () => {
    expect(exec('check', 'fixtures/manifests/hd-per-resource.json').status).toBe(0);
  });
  it('hd.json exits 1: its dynamic route has one address for every item', () => {
    const r = exec('check', 'fixtures/manifests/hd.json');
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('### X402-03.dynamic-per-pattern: found a problem');
  });
  it('hd-dup-index.json exits 1', () => {
    expect(exec('check', 'fixtures/manifests/hd-dup-index.json').status).toBe(1);
  });
  it('mainnet.json is checked from the manifest and exits 1, with the other-networks line', () => {
    const r = exec('check', 'fixtures/manifests/mainnet.json');
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('These routes are on networks other than Base Sepolia.');
  });
});

describe('step 1.1 fixtures through the built command', () => {
  it('schemes.json exits 0 and says schemes were compared separately', () => {
    const r = exec('check', 'fixtures/manifests/schemes.json');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Routes with different payment schemes were compared separately.');
  });
  it('tiers.json exits 1', () => {
    expect(exec('check', 'fixtures/manifests/tiers.json').status).toBe(1);
  });
  it('not-exported.json exits 2', () => {
    expect(exec('check', 'fixtures/manifests/not-exported.json').status).toBe(2);
  });
});

describe('step 1.3: --previous', () => {
  it('stale-reuse.json with --previous stale-previous.json exits 1', () => {
    const r = exec(
      'check',
      'fixtures/manifests/stale-reuse.json',
      '--previous',
      'fixtures/manifests/stale-previous.json',
    );
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('### X402-03.stale-mapping: found a problem');
    expect(r.stdout).toContain('- `stale-previous.json`');
  });
  it('accepts --previous more than once', () => {
    const r = exec(
      'check',
      'fixtures/manifests/stale-reuse.json',
      '--previous',
      'fixtures/manifests/stale-previous.json',
      '--previous',
      'fixtures/manifests/stale-reuse.json',
    );
    expect(r.status).toBe(1);
  });
  it('an unreadable earlier manifest is named, and makes the result could not verify (exit 2)', () => {
    const r = exec(
      'check',
      'fixtures/manifests/dynamic-per-item.json',
      '--previous',
      'fixtures/manifests/no-such-file.json',
    );
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('These earlier manifests could not be read:');
    expect(r.stdout).toContain('- `no-such-file.json`: The manifest file could not be opened.');
  });
  it('usage errors: --previous without a file, or an unknown option', () => {
    expect(run(['check', 'a.json', '--previous']).exitCode).toBe(2);
    expect(run(['check', 'a.json', '--other', 'b.json']).exitCode).toBe(2);
  });
});

describe('step 1.3: one fixture per finding', () => {
  const cases: [string, number][] = [
    ['range-overlap', 1],
    ['range-unknown', 2],
    ['dynamic-per-item', 0],
    ['tiers-same-terms', 1],
    ['hd-moved', 1],
  ];
  for (const [f, code] of cases) {
    it(`${f}.json exits ${code}`, () => {
      expect(exec('check', `fixtures/manifests/${f}.json`).status).toBe(code);
    });
  }
});

describe('step 1.4: --format', () => {
  it('the default is terminal: plain text, no Markdown markers, same exit code', () => {
    const r = spawn('check', 'fixtures/manifests/shared.json');
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('X402-03.cross-route: found a problem (severity: medium)');
    expect(r.stdout).not.toMatch(/`|\*\*|^#|^\|/m);
    expect(r.stdout).toBe(spawn('check', 'fixtures/manifests/shared.json', '--format', 'terminal').stdout);
  });
  it('markdown and json give the same exit codes as terminal', () => {
    for (const [f, code] of [
      ['shared', 1],
      ['hd-per-resource', 0],
      ['not-exported', 2],
    ] as const) {
      for (const format of ['terminal', 'markdown', 'json']) {
        expect(spawn('check', `fixtures/manifests/${f}.json`, '--format', format).status, `${f} ${format}`).toBe(code);
      }
    }
  });
  it('an unknown or repeated --format is a usage error', () => {
    expect(run(['check', 'a.json', '--format', 'html']).exitCode).toBe(2);
    expect(run(['check', 'a.json', '--format']).exitCode).toBe(2);
    expect(run(['check', 'a.json', '--format', 'json', '--format', 'json']).exitCode).toBe(2);
  });
});

describe('step 1.4: with --format json, standard output holds only the JSON document', () => {
  const onlyJson = (args: string[], code: number, kind: string) => {
    const r = spawn(...args, '--format', 'json');
    expect(r.status).toBe(code);
    expect(r.stderr).toBe('');
    expect(r.stdout.endsWith('}\n')).toBe(true);
    const doc = JSON.parse(r.stdout);
    expect(doc.formatVersion).toBe(1);
    expect(doc.kind).toBe(kind);
    expect(doc.exitCode).toBe(code);
  };
  it('a report', () => onlyJson(['check', 'fixtures/manifests/shared.json'], 1, 'report'));
  it('a report that found no problem', () =>
    onlyJson(['check', 'fixtures/manifests/hd-per-resource.json'], 0, 'report'));
  it('a usage error', () => onlyJson(['check'], 2, 'usage-error'));
  it('a usage error with --format json first', () => {
    const r = spawn('--format', 'json', 'scan');
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout).kind).toBe('usage-error');
    expect(r.stderr).toBe('');
  });
  it('a manifest that does not exist', () => onlyJson(['check', 'fixtures/manifests/no-such-file.json'], 2, 'refused'));
  it('an environment file', () => onlyJson(['check', '.env'], 2, 'refused'));
  it('an invalid manifest', () => onlyJson(['check', 'package.json'], 2, 'invalid-manifest'));
});

describe('step 1.4: the CLI names manifests by file name only', () => {
  it('the main manifest, an earlier one and a refused one, in every format', () => {
    for (const format of ['terminal', 'markdown', 'json']) {
      const r = spawn(
        'check',
        './fixtures/manifests/stale-reuse.json',
        '--previous',
        'fixtures/manifests/stale-previous.json',
        '--format',
        format,
      );
      expect(r.stdout).toContain('stale-reuse.json');
      expect(r.stdout).toContain('stale-previous.json');
      expect(r.stdout).not.toContain('fixtures/');
    }
    const refused = JSON.parse(spawn('check', 'fixtures/manifests/no-such-file.json', '--format', 'json').stdout);
    expect(refused.manifest).toBe('no-such-file.json');
  });
});
