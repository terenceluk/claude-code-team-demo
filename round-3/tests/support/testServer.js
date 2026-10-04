'use strict';
// Test harness: boots a full, isolated copy of the Waypoint app in a scratch
// temp directory so tests run against a real HTTP server + real SQLite file,
// WITHOUT ever touching round-3/db/waypoint.sqlite (the shared dev DB).
//
// Why a copy at all: db/connection.js resolves its sqlite path as
// `path.join(__dirname, 'waypoint.sqlite')` with no env override, so the
// only way to get a fresh, disposable database without editing backend
// source is to run the server from a different directory (a copy).
//
// node_modules is not copied (30+MB, native binaries) -- it's symlinked
// (Windows junction) into the scratch dir instead.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

const ROUND3_ROOT = path.join(__dirname, '..', '..');

async function waitForServer(url, timeoutMs, exitedEarly) {
  const start = Date.now();
  let lastErr = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      // Any HTTP response (even 404) means the server is up and listening.
      if (res) return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Server did not become ready at ${url} within ${timeoutMs}ms: ${lastErr}`);
}

async function startServer({ port, secret = 'test-only-secret-do-not-reuse' } = {}) {
  if (!port) throw new Error('startServer requires an explicit port');

  const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'waypoint-test-'));

  const toCopy = ['server.js', 'routes', 'middleware', 'public', 'package.json'];
  for (const item of toCopy) {
    fs.cpSync(path.join(ROUND3_ROOT, item), path.join(scratchRoot, item), { recursive: true });
  }
  fs.mkdirSync(path.join(scratchRoot, 'db'), { recursive: true });
  for (const f of ['connection.js', 'schema.sql', 'seed.js']) {
    fs.copyFileSync(path.join(ROUND3_ROOT, 'db', f), path.join(scratchRoot, 'db', f));
  }

  const nodeModulesLink = path.join(scratchRoot, 'node_modules');
  fs.symlinkSync(path.join(ROUND3_ROOT, 'node_modules'), nodeModulesLink, 'junction');

  const child = spawn(process.execPath, ['server.js'], {
    cwd: scratchRoot,
    env: { ...process.env, PORT: String(port), WAYPOINT_JWT_SECRET: secret },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderrBuf = '';
  let stdoutBuf = '';
  child.stderr.on('data', (d) => { stderrBuf += d.toString(); });
  child.stdout.on('data', (d) => { stdoutBuf += d.toString(); });

  const baseUrl = `http://localhost:${port}`;

  let exited = false;
  let exitCode = null;
  const exitedEarly = new Promise((resolve) => {
    child.once('exit', (code) => {
      exited = true;
      exitCode = code;
      resolve(code);
    });
  });

  await Promise.race([
    waitForServer(baseUrl + '/', 8000),
    exitedEarly.then(() => {
      throw new Error(
        `Server process for port ${port} exited early (code ${exitCode}) before becoming ready.\n` +
        `--- stderr ---\n${stderrBuf}\n--- stdout ---\n${stdoutBuf}`
      );
    }),
  ]);

  return {
    baseUrl,
    scratchRoot,
    getStderr: () => stderrBuf,
    getStdout: () => stdoutBuf,
    async stop() {
      if (!exited) {
        child.kill();
        await Promise.race([
          new Promise((resolve) => child.once('exit', resolve)),
          new Promise((resolve) => setTimeout(resolve, 3000)),
        ]);
      }
      // Remove the node_modules junction WITHOUT following it, then the rest.
      try {
        fs.rmSync(nodeModulesLink, { recursive: true, force: true });
      } catch (e) {
        // best effort
      }
      try {
        fs.rmSync(scratchRoot, { recursive: true, force: true });
      } catch (e) {
        // best effort cleanup; do not fail the test run over cleanup issues
      }
    },
  };
}

// Runs db/seed.js against the scratch copy's own database (never the dev
// db/waypoint.sqlite), so admin-boundary tests can get a real admin account
// -- the API deliberately offers no way to create one, by design.
function runSeed(scratchRoot) {
  const result = spawnSync(process.execPath, ['db/seed.js'], {
    cwd: scratchRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`seed script failed (exit ${result.status}):\n${result.stderr}`);
  }
  return result.stdout;
}

module.exports = { startServer, runSeed };
