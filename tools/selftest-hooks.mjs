#!/usr/bin/env node
// Self-tests for the leak protection: .githooks/*, tools/scan.mjs and tools/check-identity.mjs.
// Run from anywhere: node tools/selftest-hooks.mjs   (--keep keeps the temp folder for inspection)
// In CI: node tools/selftest-hooks.mjs --ci   skips the tests that need the maintainer's machine
// (core-hooks-path, live-config) and names them in the summary.
//
// Everything runs in throwaway git repos in the system temp folder, with a fake config and git
// isolated from your global config. Fake secrets are generated at run time, so this file holds
// none. The hooks are reached through small wrapper hooks in each temp repo, so no temp repo
// changes the hook path. Only two tests look at the real setup: core-hooks-path (this repo's git
// config) and live-config (the scanner's --check-config, which prints counts only).
//
// Claude Code's settings.json denials cannot be enforced from a script. The settings test only
// checks that each rule is present and matches sample commands (an approximation of Claude Code's
// matching); live enforcement has to be probed from a Claude Code session.

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOKS_DIR = path.join(REPO, '.githooks');
const SCAN = path.join(REPO, 'tools', 'scan.mjs');
const HOOK_NAMES = ['pre-commit', 'commit-msg', 'pre-push'];
const ID = { name: 'dabsfv', email: 'dabsfv@users.noreply.github.com' };
const HOME = os.homedir();
const KEEP = process.argv.includes('--keep');
const CI = process.argv.includes('--ci');
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dabsproof-selftest-')));
if (HOOKS_DIR.includes("'")) throw new Error('the repo path contains a quote; move the repo');

// ---------- fakes, generated now ----------

const pick = (alphabet, n) => Array.from(crypto.randomBytes(n), (b) => alphabet[b % alphabet.length]).join('');
const hex = (bytes) => crypto.randomBytes(bytes).toString('hex');
const alnum = (n) => pick('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', n);
const word = () => pick('abcdefghijklmnopqrstuvwxyz', 3 + (crypto.randomBytes(1)[0] % 6));
const words = (n) => Array.from({ length: n }, word).join(' ');
const b64url = (s) => Buffer.from(s).toString('base64url');
const HARDHAT = Array(11).fill('test').concat('junk').join(' ');

const SECRETS = [];
const secret = (s) => (SECRETS.push(s), s);
const FAKE = {
  key: secret(`0x${hex(32)}`),
  token: secret(`fk${alnum(30)}`),
  deny: secret(`zqdeny${pick('abcdefghijklmnopqrstuvwxyz', 8)}`),
};

// True if any 5 characters in a row of a fake secret appear in the output
// (secret values may show their first 4). Commit ids and temp paths are removed first.
function leaked(out) {
  const text = out.split(TMP).join('').replace(/commit [0-9a-f]{7,40}/g, '');
  return SECRETS.some((s) => {
    for (let i = 0; i + 5 <= s.length; i++) if (text.includes(s.slice(i, i + 5))) return true;
    return false;
  });
}
const tail = (r) => (leaked(r.out) ? '(output withheld: it contained fake secret text)' : r.out.trim().split('\n').slice(-5).join(' | '));

// ---------- harness ----------

const results = [];
const notes = [];
// machine: true marks a test that needs the maintainer's machine; --ci skips it by name.
function test(name, fn, { machine = false } = {}) {
  if (CI && machine) {
    results.push({ skipped: true, name });
    return;
  }
  try {
    fn();
    results.push({ ok: true, name });
  } catch (e) {
    results.push({ ok: false, name, why: e.message });
  }
}
function check(cond, why) {
  if (!cond) throw new Error(why);
}
function blocked(r, type, what) {
  check(r.code !== 0, `${what}: not blocked`);
  check(!leaked(r.out), `${what}: output contained fake secret text`);
  if (type) check(r.out.includes(type), `${what}: expected "${type}" in the output; got: ${tail(r)}`);
}
function passed(r, what) {
  check(r.code === 0, `${what}: expected to pass; got: ${tail(r)}`);
}

function cleanEnv(extra = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_') && !k.startsWith('DABSPROOF_')) env[k] = v;
  const emptyGlobal = path.join(TMP, 'empty-gitconfig');
  if (!fs.existsSync(emptyGlobal)) fs.writeFileSync(emptyGlobal, '');
  return { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: emptyGlobal, GIT_TERMINAL_PROMPT: '0', ...extra };
}

function makeConfig(name, { deny = true, sources = true, shortDeny = false, sourcesMode = 0o600 } = {}) {
  const dir = path.join(TMP, `config-${name}`);
  fs.mkdirSync(dir);
  const envFile = path.join(dir, 'fake-demo.env.test');
  fs.writeFileSync(envFile, `NETWORK=base-sepolia\nCHAIN_ID=84532\nPAY_TO=0x${hex(20)}\nFAKE_API_TOKEN=${FAKE.token}\n`);
  if (sources) {
    const f = path.join(dir, 'secret-sources.txt');
    fs.writeFileSync(f, `# fake sources\n${envFile}\n`);
    fs.chmodSync(f, sourcesMode);
  }
  if (deny) {
    const f = path.join(dir, 'deny-list.txt');
    fs.writeFileSync(f, `# fake deny-list\n${shortDeny ? 'zq\n' : ''}${FAKE.deny}\n`);
    fs.chmodSync(f, 0o600);
  }
  return dir;
}

function runIn(cwd, cmd, args, env, input) {
  const r = spawnSync(cmd, args, { cwd, env, input, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

function scanFile(config, name, content) {
  const dir = path.join(TMP, `files-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, name), content);
  return runIn(dir, process.execPath, [SCAN, 'files', name], cleanEnv({ DABSPROOF_CONFIG_DIR: config }));
}

let repoCount = 0;
function makeRepo(config, { hooks = true } = {}) {
  const dir = path.join(TMP, `repo-${++repoCount}`);
  fs.mkdirSync(dir);
  const env = cleanEnv({ DABSPROOF_CONFIG_DIR: config });
  const run = (args, extra = {}) => runIn(dir, 'git', args, { ...env, ...extra });
  const must = (args, extra) => {
    const r = run(args, extra);
    if (r.code !== 0) throw new Error(`setup step failed: git ${args[0]}: ${tail(r)}`);
    return r;
  };
  must(['init', '-q', '-b', 'main']);
  must(['config', 'user.name', ID.name]);
  must(['config', 'user.email', ID.email]);
  must(['config', 'commit.gpgsign', 'false']);
  must(['config', 'tag.gpgsign', 'false']);
  const repo = {
    dir,
    run,
    must,
    write(rel, content) {
      const f = path.join(dir, rel);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, content);
    },
    installHooks() {
      for (const h of HOOK_NAMES) {
        fs.writeFileSync(path.join(dir, '.git', 'hooks', h), `#!/bin/sh\nexec '${path.join(HOOKS_DIR, h)}' "$@"\n`, { mode: 0o755 });
      }
    },
    commit(rel, content, message = 'add file', extra = {}) {
      repo.write(rel, content);
      must(['add', '-f', '--', rel]);
      return run(['commit', '-q', '-m', message], extra);
    },
    unstage(rel) {
      run(['reset', '-q', '--', rel]);
    },
    count() {
      const r = run(['rev-list', '--count', 'HEAD']);
      return r.code === 0 ? Number(r.out.trim()) : 0;
    },
  };
  if (hooks) repo.installHooks();
  return repo;
}

function makeRemote() {
  const dir = path.join(TMP, `remote-${++repoCount}.git`);
  const r = runIn(TMP, 'git', ['init', '-q', '--bare', '-b', 'main', dir], cleanEnv());
  if (r.code !== 0) throw new Error('could not create a bare remote');
  return dir;
}
const remoteRefs = (remote) => runIn(TMP, 'git', ['ls-remote', remote], cleanEnv()).out.trim();

const CFG = makeConfig('main');
const CFG_NO_DENY = makeConfig('no-deny', { deny: false });
const CFG_NO_SOURCES = makeConfig('no-sources', { sources: false });
const CFG_SHORT = makeConfig('short-entry', { shortDeny: true });
const CFG_OPEN = makeConfig('open-mode', { sourcesMode: 0o644 });

// ---------- real setup ----------

test('core-hooks-path: this repo has core.hooksPath set to .githooks', () => {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k];
  const r = runIn(REPO, 'git', ['config', '--get', 'core.hooksPath'], env);
  const v = r.out.trim();
  check(r.code === 0 && v, 'core.hooksPath is not set. Run: git config core.hooksPath .githooks');
  check(v === '.githooks' || v === '.githooks/' || path.resolve(REPO, v) === HOOKS_DIR, 'core.hooksPath is set, but not to .githooks');
}, { machine: true });

test('hook-files: the three hooks and the tools exist, and the hooks are executable', () => {
  for (const h of HOOK_NAMES) {
    const f = path.join(HOOKS_DIR, h);
    check(fs.existsSync(f), `.githooks/${h} is missing`);
    check((fs.statSync(f).mode & 0o111) !== 0, `.githooks/${h} is not executable`);
  }
  for (const t of ['scan.mjs', 'check-identity.mjs']) check(fs.existsSync(path.join(REPO, 'tools', t)), `tools/${t} is missing`);
});

// ---------- settings.json denials (pattern check only) ----------

const REQUIRED_RULES = [
  'Read(**/.env)', 'Read(**/.env.*)', 'Read(~/.config/dabsproof/**)', 'Read(~/x402-security/demo/.env*)',
  'Read(~/x402-backup-*/**)', 'Read(~/Documents/dabsproof-private/**)',
  'Bash(cat *.env*)', 'Bash(less *.env*)', 'Bash(more *.env*)', 'Bash(head *.env*)', 'Bash(tail *.env*)',
  'Bash(grep *.env*)', 'Bash(sed *.env*)', 'Bash(awk *.env*)', 'Bash(strings *.env*)', 'Bash(xxd *.env*)',
  'Bash(od *.env*)', 'Bash(*.config/dabsproof*)', 'Bash(*x402-backup-*)', 'Bash(*dabsproof-private*)',
  'Bash(git push --tags*)', 'Bash(git push * --tags*)', 'Bash(git push --all*)', 'Bash(git push * --all*)',
  'Bash(git push --mirror*)', 'Bash(git push * --mirror*)', 'Bash(git push --follow-tags*)',
  'Bash(git push * --follow-tags*)', 'Bash(git push --force*)', 'Bash(git push * --force*)',
  'Bash(git push -f*)', 'Bash(git push * -f*)', 'Bash(git push *+*)',
  'Bash(git commit -n*)', 'Bash(git commit * -n*)', 'Bash(git commit -an*)', 'Bash(git commit * -an*)',
  'Bash(git commit -sn*)', 'Bash(git commit * -sn*)', 'Bash(git commit -vn*)', 'Bash(git commit * -vn*)',
  'Bash(git commit -qn*)', 'Bash(git commit * -qn*)',
  'Bash(*--no-verify*)', 'Bash(*--no-veri*)', 'Bash(*hooksPath*)',
];
const MUST_BLOCK = [
  ['Read', `${HOME}/Documents/dabsproof-private/notes.md`],
  ['Read', `${HOME}/.config/dabsproof/secret-sources.txt`],
  ['Read', '/work/app/.env'],
  ['Read', '/work/app/.env.local'],
  ['Read', `${HOME}/x402-security/demo/.env.test`],
  ['Read', `${HOME}/x402-backup-2026-11-18/MANIFEST.txt`],
  ...['cat', 'less', 'more', 'head', 'tail', 'strings', 'xxd'].map((c) => ['Bash', `${c} demo/.env.test`]),
  ['Bash', 'grep KEY demo/.env.test'], ['Bash', 'sed -n 1p demo/.env.test'], ['Bash', 'awk 1 demo/.env.test'],
  ['Bash', 'od -c demo/.env.test'],
  ['Bash', 'ls ~/.config/dabsproof'], ['Bash', 'ls ~/x402-backup-2026-11-18'], ['Bash', 'ls ~/Documents/dabsproof-private'],
  ['Bash', 'git push --tags origin'], ['Bash', 'git push origin --tags'],
  ['Bash', 'git push --all origin'], ['Bash', 'git push origin --all'],
  ['Bash', 'git push --mirror origin'], ['Bash', 'git push origin --mirror'],
  ['Bash', 'git push --follow-tags origin main'], ['Bash', 'git push origin main --follow-tags'],
  ['Bash', 'git push --force origin main'], ['Bash', 'git push origin main --force'],
  ['Bash', 'git push --force-with-lease origin main'],
  ['Bash', 'git push -f origin main'], ['Bash', 'git push origin main -f'], ['Bash', 'git push origin +main'],
  ['Bash', 'git commit -n -m wip'], ['Bash', 'git commit -m wip -n'],
  ['Bash', 'git commit -an -m wip'], ['Bash', 'git commit -anm wip'], ['Bash', 'git commit -m wip -an'],
  ['Bash', 'git commit -sn -m wip'], ['Bash', 'git commit -m wip -sn'],
  ['Bash', 'git commit -vn -m wip'], ['Bash', 'git commit -m wip -vn'],
  ['Bash', 'git commit -qn -m wip'], ['Bash', 'git commit -m wip -qn'],
  ['Bash', 'git commit --no-verify -m wip'], ['Bash', 'git push --no-verify origin main'],
  ['Bash', 'git commit --no-veri -m wip'],
  ['Bash', 'git config core.hooksPath /dev/null'], ['Bash', 'git -c core.hooksPath=/dev/null commit -m wip'],
];
const MUST_ALLOW = [
  ['Read', `${REPO}/CLAUDE.md`],
  ['Bash', 'git push origin main'], ['Bash', 'git push -u origin main'], ['Bash', 'git push -n origin main'],
  ['Bash', 'git push --no-follow-tags origin main'], ['Bash', 'git commit -m "add scanner"'],
  ['Bash', 'git commit -am "tidy notes"'], ['Bash', 'git commit -s -m wip'], ['Bash', 'git status --short'],
  ['Bash', 'node tools/selftest-hooks.mjs'], ['Bash', 'cat README.md'],
];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function ruleMatches(rule, tool, input) {
  const m = /^(\w+)\((.*)\)$/s.exec(rule);
  if (!m || m[1] !== tool) return false;
  let pat = m[2];
  if (tool === 'Read') {
    if (pat.startsWith('~/')) pat = HOME + pat.slice(1);
    const re = pat.split('**').map((seg) => seg.split('*').map(esc).join('[^/]*')).join('.*');
    return new RegExp(`^${re}$`).test(input);
  }
  return new RegExp(`^${pat.split('*').map(esc).join('.*')}$`, 's').test(input);
}

test('settings-denials: required rules present and matching sample commands (pattern check, not live)', () => {
  const settings = JSON.parse(fs.readFileSync(path.join(REPO, '.claude', 'settings.json'), 'utf8'));
  const deny = settings?.permissions?.deny ?? [];
  const missing = REQUIRED_RULES.filter((r) => !deny.includes(r));
  check(!missing.length, `missing rules: ${missing.join(', ')}`);
  const notBlocked = MUST_BLOCK.filter(([t, i]) => !deny.some((r) => ruleMatches(r, t, i)));
  check(!notBlocked.length, `not matched: ${notBlocked.map(([t, i]) => `${t}(${i})`).join('; ')}`);
  const wrongly = MUST_ALLOW.filter(([t, i]) => deny.some((r) => ruleMatches(r, t, i)));
  check(!wrongly.length, `matched but should not be: ${wrongly.map(([t, i]) => `${t}(${i})`).join('; ')}`);
});

// ---------- pre-commit and commit-msg ----------

test('clean-commit: a clean commit passes', () => {
  const r = makeRepo(CFG);
  passed(r.commit('README.md', 'hello\n'), 'clean commit');
  check(r.count() === 1, 'the commit was not created');
});

test('fake-key: a planted fake private key is blocked and no key text is printed', () => {
  const r = makeRepo(CFG);
  blocked(r.commit('config.ts', `export const signerKey = "${FAKE.key}";\n`), 'private-key-hex', 'fake key');
  check(r.count() === 0, 'a commit was created');
});

test('secret-value: a value from the secret sources is blocked, showing at most 4 characters', () => {
  const r = makeRepo(CFG);
  blocked(r.commit('notes.md', `token is ${FAKE.token} here\n`), 'secret-value', 'secret value');
  check(r.count() === 0, 'a commit was created');
});

test('deny-content: a fake deny-list entry in content is blocked (any case), by entry number only', () => {
  const r = makeRepo(CFG);
  blocked(r.commit('notes.md', `Compare with ${FAKE.deny.toUpperCase()} later.\n`), 'deny-list entry 2', 'deny entry in content');
});

test('deny-filename: a deny-list entry in a file name is blocked and the name is withheld', () => {
  const r = makeRepo(CFG);
  const res = r.commit(`docs/${FAKE.deny}-notes.md`, 'plain text\n');
  blocked(res, 'deny-list entry 2', 'deny entry in file name');
  check(res.out.includes('a file name (withheld)'), 'the file name was not withheld');
});

test('deny-short: a deny-list entry under 6 characters makes the scanner refuse, by entry number', () => {
  const r = makeRepo(CFG_SHORT);
  const res = r.commit('README.md', 'hello\n');
  blocked(res, 'deny-list entry 2 is shorter than 6 characters', 'short entry');
  check(!res.out.includes('"zq"'), 'the short entry text was printed');
});

test('deny-missing: a missing deny-list gives the notice and the other checks still run', () => {
  const r = makeRepo(CFG_NO_DENY);
  const bad = r.commit('config.ts', `const k = "${FAKE.key}";\n`);
  blocked(bad, 'private-key-hex', 'fake key without a deny-list');
  check(bad.out.includes('no deny-list loaded'), 'the "no deny-list loaded" notice is missing');
  r.unstage('config.ts');
  const good = r.commit('README.md', 'hello\n');
  passed(good, 'clean commit without a deny-list');
  check(good.out.includes('no deny-list loaded'), 'the notice is missing on a clean commit');
});

test('sources-missing: a missing secret-sources.txt is refused', () => {
  const r = makeRepo(CFG_NO_SOURCES);
  blocked(r.commit('README.md', 'hello\n'), 'secret-sources.txt is missing', 'missing sources');
  check(r.count() === 0, 'a commit was created');
});

test('sources-mode: a secret-sources.txt readable by others is refused', () => {
  const r = makeRepo(CFG_OPEN);
  blocked(r.commit('README.md', 'hello\n'), 'chmod 600', 'open sources file');
});

test('identity-author: a wrong author name is refused without printing it', () => {
  const r = makeRepo(CFG);
  const res = r.commit('README.md', 'hello\n', 'add readme', { GIT_AUTHOR_NAME: 'someone-else-zq' });
  blocked(res, 'author name is not dabsfv', 'wrong author');
  check(!res.out.includes('someone-else'), 'the wrong name was printed');
});

test('identity-committer: a wrong committer email is refused without printing it', () => {
  const r = makeRepo(CFG);
  const res = r.commit('README.md', 'hello\n', 'add readme', { GIT_COMMITTER_EMAIL: 'probe-zq@example.com' });
  blocked(res, 'committer email is not the GitHub no-reply address', 'wrong committer');
  check(!res.out.includes('probe-zq'), 'the wrong email was printed');
});

test('identity-flag: a wrong author given with --author is refused (by commit-msg)', () => {
  const r = makeRepo(CFG);
  r.write('README.md', 'hello\n');
  r.must(['add', 'README.md']);
  const res = r.run(['commit', '-q', '-m', 'add readme', '--author=someone-else-zq <probe-zq@example.com>']);
  blocked(res, 'author name is not dabsfv', '--author');
  check(!res.out.includes('someone-else') && !res.out.includes('probe-zq'), 'the wrong identity was printed');
  check(r.count() === 0, 'a commit was created');
});

test('commit-msg: a fake key or deny-list entry in the message is blocked', () => {
  const r = makeRepo(CFG);
  r.write('README.md', 'hello\n');
  r.must(['add', 'README.md']);
  blocked(r.run(['commit', '-q', '-m', `use ${FAKE.key}`]), 'commit message', 'key in message');
  blocked(r.run(['commit', '-q', '-m', `compare ${FAKE.deny}`]), 'deny-list entry 2', 'deny entry in message');
  check(r.count() === 0, 'a commit was created');
});

test('file-names: forbidden file names are refused even with git add -f; others are not', () => {
  const r = makeRepo(CFG);
  passed(r.commit('README.md', 'hello\n'), 'first commit');
  const forbidden = ['.env', 'app/.env.local', '.envrc', 'certs/server.pem', 'id.key', 'wallet.keystore',
    'keystore-1.json', 'my-keystore.json', 'HANDOFF.md', 'private/notes.md', 'old.bundle'];
  for (const f of forbidden) {
    const res = r.commit(f, 'nothing secret\n');
    check(res.code !== 0 && res.out.includes('forbidden-file'), `${f}: not refused`);
    r.unstage(f);
  }
  for (const f of ['src/mnemonic-guard.ts', 'src/xprv-check.ts', 'docs/keystore.md']) {
    passed(r.commit(f, 'export {};\n'), f);
  }
});

// ---------- detection rules (scanner files mode) ----------

test('patterns: each pattern type is detected without printing it; hash-labelled hex passes', () => {
  const base58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const payment = Buffer.from(JSON.stringify({
    x402Version: 1, scheme: 'exact', network: 'base-sepolia',
    payload: { signature: `0x${hex(65)}`, authorization: { nonce: `0x${hex(32)}` } },
  })).toString('base64');
  const cases = [
    ['private-key-hex', `PRIVATE_KEY=${hex(32)}`],
    ['signature-hex', `sig: 0x${hex(65)}`],
    ['pem-private-key', `${'-----BEGIN '}EC PRIVATE KEY-----\n${alnum(40)}`],
    ['extended-private-key', `root = ${'xp'}rv${pick(base58, 107)}`],
    ['stripe-secret-key', `${'sk_'}${'test_'}${alnum(24)}`],
    ['stripe-webhook-secret', `${'wh'}sec_${alnum(32)}`],
    ['supabase-secret-key', `${'sb_'}secret_${alnum(32)}`],
    ['supabase-access-token', `${'sb'}p_${hex(20)}`],
    ['jwt', `${b64url('{"alg":"HS256"}')}.${b64url(`{"role":"service_role","n":"${alnum(10)}"}`)}.${alnum(43)}`],
    ['base64-json-with-signature', `X-PAYMENT: ${payment}`],
  ];
  for (const [type, content] of cases) {
    SECRETS.push(content.slice(-20));
    blocked(scanFile(CFG, 'sample.txt', `${content}\n`), type, type);
  }
  passed(scanFile(CFG, 'hashes.json', `{"bodySha256": "${hex(32)}",\n "fingerprint": "0x${hex(32)}"}\nsha256: ${hex(32)}\n`), 'hash-labelled hex');
});

test('mnemonic-shape: whole quoted string, whole value and whole line are blocked; the rest passes', () => {
  const blockedCases = [
    `const phrase = "${words(12)}";`,
    `SEED_WORDS=${words(15)}`,
    `phrase: ${words(18)}`,
    `  ${words(24)}`,
    `x = '${words(21)}'`,
  ];
  for (const c of blockedCases) blocked(scanFile(CFG, 'm.txt', `${c}\n`), 'mnemonic-like-word-run', c.slice(0, 18));
  const passing = [
    `We keep ${words(12)} out of here.`,
    `"${words(13)}"`,
    words(11),
    `MNEMONIC="${HARDHAT}"`,
    HARDHAT,
    `See the list ${words(12)}`,
  ].join('\n');
  passed(scanFile(CFG, 'm.txt', `${passing}\n`), 'non-mnemonic lines');
});

// ---------- pre-push ----------

test('push-rules: clean main passes; tags, --follow-tags, other branches, force and deletion are refused', () => {
  const remote = makeRemote();
  const r = makeRepo(CFG);
  passed(r.commit('README.md', 'hello\n'), 'first commit');
  passed(r.run(['push', '-q', remote, 'main']), 'clean push of main');
  const pushed = remoteRefs(remote);

  r.must(['tag', '-a', 'v0.0.1', '-m', 'tag']);
  blocked(r.run(['push', remote, 'refs/tags/v0.0.1']), 'tags are never pushed', 'tag push');
  passed(r.commit('b.md', 'b\n'), 'second commit');
  blocked(r.run(['push', '--follow-tags', remote, 'main']), 'tags are never pushed', '--follow-tags');
  r.must(['branch', 'feature']);
  blocked(r.run(['push', remote, 'feature']), 'only refs/heads/main may be pushed', 'other branch');
  blocked(r.run(['push', remote, 'main', 'feature']), 'updates 2 refs', 'two refs');
  check(remoteRefs(remote) === pushed, 'the remote changed after a refused push');

  passed(r.run(['push', '-q', remote, 'main']), 'fast-forward push of main');
  const before = remoteRefs(remote);
  r.must(['commit', '-q', '--amend', '-m', 'rewritten']);
  blocked(r.run(['push', remote, '+main']), 'not a fast-forward', 'force push');
  blocked(r.run(['push', remote, ':main']), 'deleting a branch', 'delete');
  check(remoteRefs(remote) === before, 'the remote changed after a refused push');
});

test('push-scan: commits made without the hooks are caught at push (key, identity, deny-list in message)', () => {
  const scenarios = [
    ['fake key in content', (r) => r.commit('config.ts', `const k = "${FAKE.key}";\n`), 'private-key-hex'],
    ['wrong author', (r) => r.commit('README.md', 'hi\n', 'add', { GIT_AUTHOR_NAME: 'someone-else-zq' }), 'author name is not dabsfv'],
    ['deny entry in message', (r) => r.commit('README.md', 'hi\n', `about ${FAKE.deny}`), 'deny-list entry 2'],
    ['secret value in a later commit', (r) => { r.commit('a.md', 'a\n'); r.commit('b.md', `${FAKE.token}\n`); }, 'secret-value'],
  ];
  for (const [what, make, type] of scenarios) {
    const remote = makeRemote();
    const r = makeRepo(CFG, { hooks: false });
    make(r);
    check(r.count() >= 1, `${what}: setup commit missing`);
    r.installHooks();
    const res = r.run(['push', remote, 'main']);
    blocked(res, type, what);
    check(!res.out.includes('someone-else'), `${what}: the wrong name was printed`);
    check(remoteRefs(remote) === '', `${what}: something reached the remote`);
  }
});

// ---------- the files to be committed, and the real config ----------

test('self-scan: the leak-protection files and repo config scan clean (fake config)', () => {
  const files = ['CLAUDE.md', '.gitignore', '.claude/settings.json', 'tools/scan.mjs', 'tools/check-identity.mjs',
    'tools/selftest-hooks.mjs', ...HOOK_NAMES.map((h) => `.githooks/${h}`)].filter((f) => fs.existsSync(path.join(REPO, f)));
  const r = runIn(REPO, process.execPath, [SCAN, 'files', ...files], cleanEnv({ DABSPROOF_CONFIG_DIR: CFG }));
  passed(r, 'self-scan');
});

test('live-config: the real config loads (counts and notices only)', () => {
  const r = runIn(REPO, process.execPath, [SCAN, '--check-config'], cleanEnv());
  for (const line of r.out.trim().split('\n')) notes.push(`live-config: ${line}`);
  check(r.code === 0, 'the scanner refused to load the real config (see the notes)');
}, { machine: true });

// ---------- scan.mjs ci (patterns only), in both directions ----------

const CI_NOTICE = 'patterns only, by-value scan did not run';

test('ci-scan-finds-patterns: ci mode blocks a planted fake key and says the by-value scan did not run', () => {
  const r = makeRepo(CFG, { hooks: false });
  r.write('config.ts', `const k = "${FAKE.key}";\n`);
  r.must(['add', '--', 'config.ts']);
  const res = runIn(r.dir, process.execPath, [SCAN, 'ci'], cleanEnv());
  blocked(res, 'private-key-hex', 'ci mode');
  check(res.out.includes(CI_NOTICE), `the "${CI_NOTICE}" notice is missing`);
});

test('ci-scan-reads-no-config: ci mode ignores the deny-list and secret values, even when a config is named', () => {
  const r = makeRepo(CFG, { hooks: false });
  r.write('notes.md', `token ${FAKE.token} and ${FAKE.deny}\n`);
  r.must(['add', '--', 'notes.md']);
  for (const env of [cleanEnv({ DABSPROOF_CONFIG_DIR: CFG }), cleanEnv({ DABSPROOF_CONFIG_DIR: CFG_NO_SOURCES })]) {
    const res = runIn(r.dir, process.execPath, [SCAN, 'ci'], env);
    check(res.code === 0, `ci mode used the config (or refused without one): ${tail(res)}`);
    check(res.out.includes(CI_NOTICE) && res.out.includes('deny-list check did not run'), 'the ci notices are missing');
    check(!res.out.includes('test mode'), 'ci mode looked at DABSPROOF_CONFIG_DIR');
  }
});

test('ci-scan-never-in-hooks: every hook calls scan.mjs only in a hook mode, never ci', () => {
  const allowed = new Set(['pre-commit', 'commit-msg', 'pre-push']);
  for (const h of HOOK_NAMES) {
    const text = fs.readFileSync(path.join(HOOKS_DIR, h), 'utf8');
    const calls = [...text.matchAll(/scan\.mjs["']?\s+(\S+)/g)].map((m) => m[1].replace(/["']/g, ''));
    check(calls.length > 0, `.githooks/${h} does not call the scanner`);
    const bad = calls.filter((m) => !allowed.has(m));
    check(!bad.length, `.githooks/${h} calls scan.mjs with: ${bad.join(', ')}`);
    check(!/\bci\b/.test(text.replace(/^#.*$/gm, '')), `.githooks/${h} mentions ci outside a comment`);
  }
  const identity = fs.readFileSync(path.join(REPO, 'tools', 'check-identity.mjs'), 'utf8');
  check(!identity.includes('scan.mjs'), 'check-identity.mjs calls the scanner');
});

test('ci-scan-hooks-still-need-config: with no secret-sources.txt the hooks refuse, they do not fall back to patterns only', () => {
  const r = makeRepo(CFG_NO_SOURCES);
  const res = r.commit('README.md', 'hello\n');
  blocked(res, 'secret-sources.txt is missing', 'hook without sources');
  check(!res.out.includes(CI_NOTICE), 'a hook ran the patterns-only scan');
  check(r.count() === 0, 'a commit was created');
});

// ---------- report ----------

if (!KEEP) fs.rmSync(TMP, { recursive: true, force: true });
for (const r of results) {
  const label = r.skipped ? 'SKIP' : r.ok ? 'PASS' : 'FAIL';
  const extra = r.skipped ? "  (needs the maintainer's machine)" : r.ok ? '' : `\n      ${r.why}`;
  process.stdout.write(`${label}  ${r.name}${extra}\n`);
}
for (const n of notes) process.stdout.write(`note  ${n}\n`);
const skipped = results.filter((r) => r.skipped);
const ran = results.filter((r) => !r.skipped);
const failed = ran.filter((r) => !r.ok).length;
const skipText = skipped.length
  ? `${skipped.length} skipped: need the maintainer's machine (${skipped.map((r) => r.name.split(':')[0]).join(', ')})`
  : '0 skipped';
process.stdout.write(
  `\n${ran.length} run, ${skipText}. Of those run: ${ran.length - failed} passed, ${failed} failed.${KEEP ? ` Temp folder kept: ${TMP}` : ''}\n`,
);
process.stdout.write('Live enforcement of the settings.json denials is not tested here; probe it from a Claude Code session.\n');
process.exitCode = failed ? 1 : 0;
