// e2e harness: one `next start` at a time on 127.0.0.1:4319, with an explicit environment and nothing
// else inherited. Server and build output is kept in memory for the canary test and never printed.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_DIR = fileURLToPath(new URL('..', import.meta.url));
export const HOST = '127.0.0.1';
export const PORT = 4319;
export const MAX_REQUESTS_PER_ROUTE = 20;
const NEXT = join(APP_DIR, 'node_modules', 'next', 'dist', 'bin', 'next');
/** The real temp folder. Servers and builds see the same one, because lib/payto.js allows test mappings only in demo-seller-mapping-* folders directly inside it. */
const TEMP = realpathSync(tmpdir());
/** The line Next.js prints when `next start` is ready. */
export const READY_TEXT = 'Ready in';

/** Everything printed by servers and builds, and every response body: for the canary test only. */
export const captured = [];
/** Requests per route for each server start, in order: counts only. */
export const requestCounts = [];

// Clean-up that must run however the run ends: process groups to kill, files to remove.
const groups = new Set();
const files = new Set();
const killGroup = (pid, signal) => {
  try {
    process.kill(-pid, signal);
  } catch {
    // The group has already gone.
  }
};
const groupAlive = (pid) => {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
};
const cleanUpNow = () => {
  for (const pid of groups) killGroup(pid, 'SIGKILL');
  for (const f of files) if (existsSync(f)) unlinkSync(f);
};
process.on('exit', cleanUpNow);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    cleanUpNow();
    process.exit(1);
  });
}
/** Removes a file on exit and on SIGINT or SIGTERM, as well as wherever the test removes it. */
export const removeOnExit = (file) => files.add(file);

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const freshHome = () => mkdtempSync(join(TEMP, 'demo-seller-home-'));

/** The only environment a server or build gets. HOME is fresh; TMPDIR is the real temp folder. */
export const cleanEnv = (home, extra = {}) => ({
  PATH: [join(APP_DIR, 'node_modules', '.bin'), dirname(process.execPath), '/usr/bin', '/bin'].join(':'),
  HOME: home,
  TMPDIR: TEMP,
  NEXT_TELEMETRY_DISABLED: '1',
  ...extra,
});

export const portOpen = () =>
  new Promise((done) => {
    const socket = connect({ host: HOST, port: PORT });
    socket.once('connect', () => {
      socket.destroy();
      done(true);
    });
    socket.once('error', () => done(false));
    socket.setTimeout(1000, () => {
      socket.destroy();
      done(false);
    });
  });

/** A temp folder named with the approved prefix, for mappings. */
export const mappingDir = () => mkdtempSync(join(TEMP, 'demo-seller-mapping-'));
export function writeMapping(dir, name, manifest) {
  const file = join(dir, `${name}.json`);
  writeFileSync(file, JSON.stringify(manifest));
  return file;
}

/** Runs the app's own build script once, with a clean environment. Output is kept, never printed. */
export function runBuildScript(extra = {}) {
  const home = freshHome();
  const script = JSON.parse(readFileSync(join(APP_DIR, 'package.json'), 'utf8')).scripts.build;
  const r = spawnSync('/bin/sh', ['-c', script], {
    cwd: APP_DIR,
    env: cleanEnv(home, extra),
    encoding: 'utf8',
    timeout: 300_000,
  });
  rmSync(home, { recursive: true, force: true });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  captured.push(output);
  return { status: r.status, output };
}

/**
 * Starts `next start` on 127.0.0.1:4319 and returns once the port is open and Next.js has printed
 * its ready line. Refuses if the port is in use. Errors carry codes only.
 */
export async function startServer(extra = {}) {
  if (await portOpen()) throw new Error('port-in-use');
  const home = freshHome();
  const out = [];
  const bodies = [];
  const counts = {};
  requestCounts.push(counts);
  const child = spawn(process.execPath, [NEXT, 'start', '-H', HOST, '-p', String(PORT)], {
    cwd: APP_DIR,
    env: cleanEnv(home, { DEMO_ORIGIN: `http://${HOST}:${PORT}`, ...extra }),
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  groups.add(child.pid);
  child.stdout.on('data', (d) => out.push(String(d)));
  child.stderr.on('data', (d) => out.push(String(d)));
  let exited = false;
  child.once('exit', () => {
    exited = true;
  });
  let stopped = null;
  const server = {
    output: () => out.join(''),
    /** Waits until the output contains the text; answers true or false, never the output. */
    async waitFor(text, ms = 5000) {
      for (let t = 0; t < ms; t += 100) {
        if (out.join('').includes(text)) return true;
        await sleep(100);
      }
      return false;
    },
    async get(route, path, headers = {}) {
      const n = (counts[route] ?? 0) + 1;
      if (n > MAX_REQUESTS_PER_ROUTE) throw new Error('request-limit');
      counts[route] = n;
      const res = await fetch(`http://${HOST}:${PORT}${path}`, { headers, signal: AbortSignal.timeout(30_000) });
      const text = await res.text();
      bodies.push(text);
      // The payment header and its decoded text are checked by T11 like any body; never printed.
      const required = res.headers.get('payment-required');
      if (required !== null) {
        bodies.push(required);
        try {
          bodies.push(atob(required));
        } catch {
          // Not base64: nothing extra is pushed.
        }
      }
      let body = null;
      try {
        body = JSON.parse(text);
      } catch {
        // Not JSON: the body stays null, which the tests treat as a failure.
      }
      return { status: res.status, body, headers: Object.fromEntries(res.headers) };
    },
    async stop() {
      if (stopped) return stopped;
      killGroup(child.pid, 'SIGTERM');
      for (let i = 0; i < 50 && groupAlive(child.pid); i++) await sleep(100);
      killGroup(child.pid, 'SIGKILL');
      for (let i = 0; i < 20 && groupAlive(child.pid); i++) await sleep(100);
      groups.delete(child.pid);
      captured.push(out.join(''), ...bodies);
      rmSync(home, { recursive: true, force: true });
      stopped = { processesLeft: groupAlive(child.pid), portOpen: await portOpen() };
      return stopped;
    },
  };
  for (let i = 0; i < 300 && !exited; i++) {
    if ((await portOpen()) && out.join('').includes(READY_TEXT)) return server;
    await sleep(100);
  }
  await server.stop();
  throw new Error('server-not-listening');
}
