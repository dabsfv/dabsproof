#!/usr/bin/env node
// DabsProof leak scanner, used by the git hooks in .githooks. Node built-ins only.
//
// Usage:
//   node tools/scan.mjs pre-commit                scan the staged content and file names
//   node tools/scan.mjs commit-msg <file>         scan a commit message
//   node tools/scan.mjs pre-push <remote> <url>   check the refs (on stdin) and scan every commit being pushed
//   node tools/scan.mjs files <path>...           scan files in the working tree
//   node tools/scan.mjs --check-config            load the config and report counts only
//
// Config, outside the repo, readable by the owner only (chmod 600):
//   ~/.config/dabsproof/secret-sources.txt  required: one file path per line; the secret values in
//                                           those files (KEY=VALUE lines) must never be committed
//   ~/.config/dabsproof/deny-list.txt       optional: one entry per line, at least 6 characters,
//                                           matched ignoring case
// Lines starting with # are comments. "Entry N" means line N of the file.
// DABSPROOF_CONFIG_DIR points at another config folder; the self-tests use it, and the scanner
// says so whenever it is set.
//
// Output never shows matched text:
//   deny-list hit     the entry number and the location (a file name that matches is withheld)
//   secret-value hit  the type, the location and at most the first 4 characters
//   pattern hit       the type and the location
// Exit codes: 0 no problem found, 1 problem found, 2 refused (configuration or scanner error).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { commitIdentity, identityProblems } from './check-identity.mjs';

const TAG = '[dabsproof-scan]';
const HOME = os.homedir();
const CONFIG_OVERRIDE = process.env.DABSPROOF_CONFIG_DIR || '';
const CONFIG_DIR = CONFIG_OVERRIDE ? path.resolve(CONFIG_OVERRIDE) : path.join(HOME, '.config', 'dabsproof');
const PUSH_REF = 'refs/heads/main';
const ZERO_SHA = /^0+$/;

class Refusal extends Error {}

const tidy = (s) => (HOME ? String(s).split(HOME).join('~') : String(s));
const say = (msg) => process.stderr.write(`${TAG} ${tidy(msg)}\n`);
const git = (args) => execFileSync('git', args, { maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'pipe'] });
const gitText = (args) => git(args).toString('utf8');

// ---------- config ----------

function readPrivateLines(file, label) {
  if ((fs.statSync(file).mode & 0o077) !== 0) {
    throw new Refusal(`${label} must be readable by you only: run chmod 600 on it.`);
  }
  return fs.readFileSync(file, 'utf8').split(/\r?\n/);
}

export function loadDenyList(dir = CONFIG_DIR) {
  const file = path.join(dir, 'deny-list.txt');
  if (!fs.existsSync(file)) return [];
  const entries = [];
  const tooShort = [];
  readPrivateLines(file, 'deny-list.txt').forEach((raw, i) => {
    const t = raw.trim();
    if (!t || t.startsWith('#')) return;
    if (t.length < 6) tooShort.push(i + 1);
    else entries.push({ n: i + 1, lower: t.toLowerCase() });
  });
  if (tooShort.length) {
    throw new Refusal(`deny-list entry ${tooShort.join(', ')} is shorter than 6 characters. Fix deny-list.txt.`);
  }
  return entries;
}

const HARDHAT_MNEMONIC = Array(11).fill('test').concat('junk').join(' ');
const SECRET_NAME = /KEY|SECRET|TOKEN|PASS|PWD|PRIVATE|MNEMONIC|SEED|XPRV|XPUB|AUTH|CREDENTIAL|SALT|COOKIE|SESSION|SIGNATURE|WEBHOOK|DSN/i;
const looksRandom = (s) => /[0-9]/.test(s) && /[A-Za-z]/.test(s) && !/\s/.test(s);

function isPublicValue(v) {
  return (
    /^(true|false|yes|no|on|off|null|none)$/i.test(v) ||
    /^-?\d+(\.\d+)?$/.test(v) ||
    /^0x[0-9a-fA-F]{40}$/.test(v) || // an address is public
    /^eip155:\d+$/.test(v) ||
    v === HARDHAT_MNEMONIC
  );
}

function unquote(v) {
  v = v.trim();
  if (v[0] === '"' || v[0] === "'") {
    const end = v.indexOf(v[0], 1);
    if (end > 0) return v.slice(1, end);
  }
  const comment = v.search(/\s#/);
  return (comment >= 0 ? v.slice(0, comment) : v).trim();
}

function candidates(name, value) {
  if (!value || isPublicValue(value)) return [];
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    // A URL: the secret parts are credentials and long random-looking tokens in it.
    const parts = value.split(/[/?&=#:@]+/).filter((p) => p.length >= 12 && looksRandom(p));
    if (SECRET_NAME.test(name)) parts.push(value);
    return parts;
  }
  if (SECRET_NAME.test(name)) return value.length >= 8 ? [value] : [];
  return value.length >= 16 && looksRandom(value) ? [value] : [];
}

function valuesFromFile(text) {
  const out = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/.exec(line);
    const name = m ? m[1] : `line ${i + 1}`;
    const value = m ? unquote(m[2]) : line;
    for (const v of candidates(name, value)) out.push({ name, value: v });
  });
  return out;
}

export function loadSecretValues(dir = CONFIG_DIR) {
  const file = path.join(dir, 'secret-sources.txt');
  if (!fs.existsSync(file)) {
    throw new Refusal('secret-sources.txt is missing from the config folder. The by-value secret scan is required.');
  }
  const values = new Map();
  let files = 0;
  for (const [i, raw] of readPrivateLines(file, 'secret-sources.txt').entries()) {
    const t = raw.trim();
    if (!t || t.startsWith('#')) continue;
    const p = path.resolve(dir, t === '~' ? HOME : t.startsWith('~/') ? path.join(HOME, t.slice(2)) : t);
    let text;
    try {
      text = fs.readFileSync(p, 'utf8');
    } catch {
      throw new Refusal(`the file on line ${i + 1} of secret-sources.txt could not be read.`);
    }
    files++;
    for (const c of valuesFromFile(text)) {
      if (!values.has(c.value)) values.set(c.value, `source line ${i + 1}, ${c.name}`);
    }
  }
  if (files === 0) throw new Refusal('secret-sources.txt lists no files. The by-value secret scan is required.');
  return { files, values: [...values].map(([value, label]) => ({ value, label })) };
}

// ---------- detection ----------

const HASH_CONTEXT = /sha-?(?:1|224|256|384|512)|hash|digest|fingerprint|checksum|integrity/i;
const PATTERNS = [
  // 32-byte hex; skipped when the 48 characters before it on the line name a hash.
  { type: 'private-key-hex', re: /(?<![0-9A-Za-z])(?:0x)?[0-9a-fA-F]{64}(?![0-9A-Za-z])/g, hashOk: true },
  { type: 'signature-hex', re: /(?<![0-9A-Za-z])0x[0-9a-fA-F]{130}(?![0-9A-Za-z])/g },
  { type: 'pem-private-key', re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/g },
  { type: 'extended-private-key', re: /(?<![0-9A-Za-z])[xtyzuvYZUV]prv[1-9A-HJ-NP-Za-km-z]{100,}/g },
  { type: 'stripe-secret-key', re: /(?<![0-9A-Za-z])(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{10,}/g },
  { type: 'stripe-webhook-secret', re: /(?<![0-9A-Za-z])whsec_[0-9A-Za-z+/=]{16,}/g },
  { type: 'supabase-secret-key', re: /(?<![0-9A-Za-z])sb_secret_[0-9A-Za-z_-]{16,}/g },
  { type: 'supabase-access-token', re: /(?<![0-9A-Za-z])sbp_[0-9a-f]{40}(?![0-9a-f])/g },
  { type: 'jwt', re: /(?<![0-9A-Za-z_-])eyJ[0-9A-Za-z_-]{8,}\.eyJ[0-9A-Za-z_-]{8,}\.[0-9A-Za-z_-]{8,}/g },
];
const B64_TOKEN = /[A-Za-z0-9+/_-]{40,}={0,2}/g;
const SIGNATURE_FIELD = /"signature"\s*:/;

// Mnemonic shape rule (until the real BIP-39 word list is used): exactly 12, 15, 18, 21 or 24
// lowercase words of 3 to 8 letters, single-spaced, that make up a whole quoted string, a whole
// value after = or :, or a whole line. The public Hardhat test mnemonic is allowed.
const RUN = '[a-z]{3,8}(?: [a-z]{3,8})+';
const RUN_QUOTED = new RegExp(`(["'\`])(${RUN})\\1`, 'g');
const RUN_VALUE = new RegExp(`[=:][ \\t]*(${RUN})[ \\t]*[,;]?[ \\t]*$`);
const RUN_LINE = new RegExp(`^[ \\t]*(${RUN})[ \\t]*$`);
const MNEMONIC_WORDS = new Set([12, 15, 18, 21, 24]);

function mnemonicLike(line) {
  const runs = [...line.matchAll(RUN_QUOTED)].map((m) => m[2]);
  for (const re of [RUN_VALUE, RUN_LINE]) {
    const m = re.exec(line);
    if (m) runs.push(m[1]);
  }
  return runs.some((r) => MNEMONIC_WORDS.has(r.split(' ').length) && r !== HARDHAT_MNEMONIC);
}

function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

function lineAt(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

function* occurrences(haystack, needle) {
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) yield i;
}

export function scanText(text, cfg) {
  const hits = [];
  const starts = lineStarts(text);
  const at = (offset) => lineAt(starts, offset);
  for (const p of PATTERNS) {
    for (const m of text.matchAll(p.re)) {
      if (p.hashOk) {
        const from = Math.max(starts[at(m.index) - 1], m.index - 48);
        if (HASH_CONTEXT.test(text.slice(from, m.index))) continue;
      }
      hits.push({ type: p.type, line: at(m.index) });
    }
  }
  for (const m of text.matchAll(B64_TOKEN)) {
    if (SIGNATURE_FIELD.test(Buffer.from(m[0], 'base64').toString('latin1'))) {
      hits.push({ type: 'base64-json-with-signature', line: at(m.index) });
    }
  }
  text.split('\n').forEach((line, i) => {
    if (mnemonicLike(line.replace(/\r$/, ''))) hits.push({ type: 'mnemonic-like-word-run', line: i + 1 });
  });
  for (const s of cfg.values) {
    for (const i of occurrences(text, s.value)) {
      hits.push({ type: 'secret-value', line: at(i), note: `${s.label}, starts "${s.value.slice(0, 4)}"` });
    }
  }
  if (cfg.deny.length) {
    const lower = text.toLowerCase();
    for (const d of cfg.deny) for (const i of occurrences(lower, d.lower)) hits.push({ type: `deny-list entry ${d.n}`, line: at(i) });
  }
  return hits;
}

// File names that are never committed: the key-material lines of .gitignore, the existing
// .env / .env.* / *.bundle lines, HANDOFF.md and anything in a private/ folder.
export function forbiddenFileReason(p) {
  const parts = p.toLowerCase().split('/');
  const base = parts[parts.length - 1];
  if (parts.slice(0, -1).includes('private')) return 'files in private/ are never committed';
  if (base === 'handoff.md') return 'HANDOFF.md is never committed';
  if (base === '.env' || base.startsWith('.env.') || base === '.envrc') return 'environment file';
  if (base.endsWith('.pem') || base.endsWith('.key')) return 'key file';
  if (base.endsWith('.keystore') || (base.includes('keystore') && base.endsWith('.json'))) return 'keystore file';
  if (base.endsWith('.bundle')) return 'git bundle';
  return null;
}

function addFile(hits, name, content, cfg, prefix = '') {
  const nameHits = scanText(name, cfg);
  const shown = nameHits.length ? `${prefix}a file name (withheld)` : `${prefix}${name}`;
  for (const h of nameHits) hits.push({ ...h, where: shown, line: null, note: h.note ? `${h.note}, in the file name` : 'in the file name' });
  const reason = forbiddenFileReason(name);
  if (reason) hits.push({ type: 'forbidden-file', where: shown, line: null, note: reason });
  if (content === null) return;
  if (content.subarray(0, 8000).includes(0)) {
    say(`notice: ${shown} looks binary, so only its name was checked.`);
    return;
  }
  for (const h of scanText(content.toString('utf8'), cfg)) hits.push({ ...h, where: shown });
}

function finish(hits, what, refused = false) {
  if (!hits.length && !refused) {
    say(`${what}: this check found no problem.`);
    return 0;
  }
  if (hits.length) {
    say(`${what}: ${hits.length} problem(s) found. The matched text is not shown.`);
    for (const h of hits) {
      const loc = h.line ? `${h.where}:${h.line}` : h.where;
      process.stderr.write(tidy(`  ${h.type.padEnd(28)} ${loc}${h.note ? `  (${h.note})` : ''}`) + '\n');
    }
  }
  say(`${what} refused.`);
  return 1;
}

// ---------- git modes ----------

function rawEntries(buf) {
  const parts = buf.toString('utf8').split('\0');
  const entries = [];
  for (let i = 0; i < parts.length; i++) {
    if (!parts[i].startsWith(':')) continue;
    const f = parts[i].slice(1).split(' ');
    entries.push({ mode: f[1], sha: f[3], path: parts[i + 1] });
    i++;
  }
  return entries;
}

const blob = (e) => (e.mode === '160000' ? null : git(['cat-file', 'blob', e.sha]));

function preCommit(cfg) {
  const out = git(['diff', '--cached', '--raw', '-z', '--no-abbrev', '--no-renames', '--diff-filter=ACMRT']);
  const hits = [];
  for (const e of rawEntries(out)) addFile(hits, e.path, blob(e), cfg);
  return finish(hits, 'commit');
}

function commitMsg(file, cfg) {
  const hits = scanText(fs.readFileSync(file, 'utf8'), cfg).map((h) => ({ ...h, where: 'commit message' }));
  return finish(hits, 'commit message');
}

function scanCommit(sha, cfg, hits) {
  const short = sha.slice(0, 10);
  for (const p of identityProblems(commitIdentity(sha))) hits.push({ type: 'identity', where: `commit ${short}`, line: null, note: p });
  for (const h of scanText(gitText(['log', '-1', '--format=%B', sha]), cfg)) hits.push({ ...h, where: `commit ${short} message` });
  const out = git(['diff-tree', '-r', '-z', '--raw', '--no-abbrev', '--no-renames', '--root', '-m', '--no-commit-id', '--diff-filter=ACMRT', sha]);
  const seen = new Set();
  for (const e of rawEntries(out)) {
    const key = `${e.sha}\0${e.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    addFile(hits, e.path, blob(e), cfg, `commit ${short} `);
  }
}

function succeeds(args) {
  try {
    git(args);
    return true;
  } catch {
    return false;
  }
}

function prePush(remote, cfg) {
  const updates = fs.readFileSync(0, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
  const refusals = [];
  const hits = [];
  if (updates.length > 1) refusals.push(`this push updates ${updates.length} refs; only ${PUSH_REF} may be pushed, on its own`);
  for (const u of updates) {
    const [lref, lsha, rref, rsha] = u.split(' ');
    if (lref.startsWith('refs/tags/') || rref.startsWith('refs/tags/')) {
      refusals.push('tags are never pushed');
      continue;
    }
    if (ZERO_SHA.test(lsha)) {
      refusals.push('deleting a branch on the remote is refused');
      continue;
    }
    if (lref !== PUSH_REF || rref !== PUSH_REF) {
      refusals.push(`only ${PUSH_REF} may be pushed, to the same name`);
      continue;
    }
    let range;
    if (ZERO_SHA.test(rsha)) range = [lsha, '--not', `--remotes=${remote}`];
    else if (!succeeds(['cat-file', '-e', `${rsha}^{commit}`])) {
      refusals.push('the remote has commits this repo does not have; fetch and review them first');
      continue;
    } else if (!succeeds(['merge-base', '--is-ancestor', rsha, lsha])) {
      refusals.push('this is not a fast-forward (a force push or rewritten history)');
      continue;
    } else range = [`${rsha}..${lsha}`];
    for (const c of gitText(['rev-list', ...range]).split('\n').filter(Boolean)) scanCommit(c, cfg, hits);
  }
  for (const r of new Set(refusals)) say(`refused: ${r}.`);
  return finish(hits, 'push', refusals.length > 0);
}

function scanFiles(paths, cfg) {
  const hits = [];
  for (const p of paths) addFile(hits, p, fs.readFileSync(p), cfg);
  return finish(hits, 'files');
}

// ---------- main ----------

function main() {
  const [mode, ...args] = process.argv.slice(2);
  if (CONFIG_OVERRIDE) say('using the config folder named by DABSPROOF_CONFIG_DIR (test mode).');
  const deny = loadDenyList();
  if (!deny.length) say('no deny-list loaded');
  const secrets = loadSecretValues();
  const cfg = { deny, values: secrets.values };
  switch (mode) {
    case '--check-config':
      if (deny.length) say(`deny-list: ${deny.length} entries loaded.`);
      say(`secret-sources: ${secrets.files} file(s), ${secrets.values.length} value(s) loaded.`);
      return 0;
    case 'pre-commit':
      return preCommit(cfg);
    case 'commit-msg':
      return commitMsg(args[0], cfg);
    case 'pre-push':
      return prePush(args[0] || '', cfg);
    case 'files':
      return scanFiles(args, cfg);
    default:
      say('usage: scan.mjs pre-commit | commit-msg <file> | pre-push <remote> <url> | files <path>... | --check-config');
      return 2;
  }
}

try {
  process.exitCode = main();
} catch (err) {
  if (err instanceof Refusal) say(`refused: ${err.message}`);
  else say(`refused: the scanner failed (${err.message.split('\n')[0]}).`);
  process.exitCode = 2;
}
