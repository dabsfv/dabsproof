#!/usr/bin/env node
// Checks git identities for DabsProof: author and committer must be dabsfv with the
// GitHub no-reply address. It never prints a name or email it rejects.
//
// Usage:
//   node tools/check-identity.mjs --configured     the identity the next commit will use
//   node tools/check-identity.mjs --commit <rev>   the identity recorded in an existing commit
// Exit codes: 0 identity is the project identity, 1 refused, 2 usage error.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const PROJECT_NAME = 'dabsfv';
export const PROJECT_EMAIL = /^(?:\d+\+)?dabsfv@users\.noreply\.github\.com$/;

function git(args, cwd) {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8');
}

function parseIdent(line) {
  const m = /^(.*) <([^>]*)> \d+ [+-]\d{4}\s*$/.exec(line.trim());
  return m ? { name: m[1], email: m[2] } : null;
}

// Uses `git var`, so it sees GIT_AUTHOR_* / GIT_COMMITTER_* overrides as well as config.
export function configuredIdentity(cwd) {
  const read = (v) => {
    try {
      return parseIdent(git(['var', v], cwd));
    } catch {
      return null;
    }
  };
  return { author: read('GIT_AUTHOR_IDENT'), committer: read('GIT_COMMITTER_IDENT') };
}

export function commitIdentity(rev, cwd) {
  const out = git(['log', '-1', '--format=%an%x00%ae%x00%cn%x00%ce', rev], cwd).replace(/\n$/, '');
  const [an, ae, cn, ce] = out.split('\0');
  return { author: { name: an, email: ae }, committer: { name: cn, email: ce } };
}

export function identityProblems({ author, committer }) {
  const problems = [];
  for (const [role, id] of [['author', author], ['committer', committer]]) {
    if (!id) {
      problems.push(`no ${role} identity could be read`);
      continue;
    }
    if (id.name !== PROJECT_NAME) problems.push(`${role} name is not ${PROJECT_NAME}`);
    if (!PROJECT_EMAIL.test(id.email)) problems.push(`${role} email is not the GitHub no-reply address`);
  }
  return problems;
}

function isMain() {
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  const [mode, rev] = process.argv.slice(2);
  let ident;
  if (mode === '--configured') ident = configuredIdentity();
  else if (mode === '--commit' && rev) ident = commitIdentity(rev);
  else {
    process.stderr.write('usage: check-identity.mjs --configured | --commit <rev>\n');
    process.exit(2);
  }
  const problems = identityProblems(ident);
  if (problems.length) {
    for (const p of problems) process.stderr.write(`[dabsproof-identity] ${p}\n`);
    process.stderr.write(
      '[dabsproof-identity] refused. Set this repo to the project identity with git config user.name and user.email.\n',
    );
    process.exit(1);
  }
}
