'use strict';

/**
 * Orchestrates the full Waypoint test suite against a live server:
 *   1. Wipes any existing data/waypoint.db* so the admin-bootstrap rule
 *      ("first user ever registered becomes admin") is deterministic.
 *   2. Starts `node server.js` on PORT (default 4100) as a child process.
 *   3. Waits for GET /api/health to respond.
 *   4. Runs backend-contract.test.js, then integration-mismatches.test.js,
 *      then static-assets.test.js, in that order (order matters for #1).
 *   5. Stops the server and wipes data/waypoint.db* again, leaving the
 *      data/ directory exactly as it was found.
 *
 * Usage:
 *   node tests/run-all.js
 *   PORT=4100 node tests/run-all.js
 *
 * Only Node built-ins are used (child_process, fs, path). No new
 * dependencies were added.
 */

const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const PORT = process.env.PORT || '4100';
const BASE_URL = `http://localhost:${PORT}`;
process.env.WAYPOINT_TEST_BASE_URL = BASE_URL;

function removeDbFiles() {
  let removedAny = false;
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    const p = path.join(DATA_DIR, `waypoint.db${suffix}`);
    if (fs.existsSync(p)) {
      fs.rmSync(p);
      removedAny = true;
    }
  }
  return removedAny;
}

async function waitForHealth(retries = 75) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) return true;
    } catch (e) {
      // server not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

async function main() {
  console.log('=== Waypoint test run ===');
  console.log(`Server: ${BASE_URL}`);
  console.log(`Data dir: ${DATA_DIR}`);

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const preExisting = removeDbFiles();
  if (preExisting) {
    console.log(
      'NOTE: removed a pre-existing data/waypoint.db (and WAL/SHM files) so the run starts from an empty ' +
        'database -- this is required for the admin-bootstrap test ("first user ever registered becomes admin") ' +
        'to be deterministic. The directory is wiped again at the end of this run.'
    );
  } else {
    console.log('data/ directory was already empty; starting from a clean database.');
  }

  console.log(`\nStarting server: node server.js (PORT=${PORT})...`);
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let serverOutput = '';
  child.stdout.on('data', (d) => {
    serverOutput += d.toString();
  });
  child.stderr.on('data', (d) => {
    serverOutput += d.toString();
  });
  child.on('error', (err) => {
    console.error('Failed to spawn server process:', err);
  });

  const up = await waitForHealth();
  if (!up) {
    console.error('Server did not become healthy in time. Captured output:\n' + serverOutput);
    child.kill();
    process.exitCode = 1;
    return;
  }
  console.log('Server is healthy.\n');

  const allSummaries = [];
  let crashed = false;

  try {
    const backend = require('./backend-contract.test');
    console.log('--- Backend contract ---');
    allSummaries.push(await backend.run());

    const integration = require('./integration-mismatches.test');
    console.log('\n--- Frontend/backend integration mismatches ---');
    allSummaries.push(await integration.run());

    const staticAssets = require('./static-assets.test');
    console.log('\n--- Static assets ---');
    allSummaries.push(await staticAssets.run());
  } catch (err) {
    console.error('\nTest run crashed unexpectedly:', err);
    crashed = true;
  } finally {
    console.log('\nStopping server...');
    child.kill();
    await new Promise((r) => setTimeout(r, 400));

    console.log('Cleaning data directory...');
    removeDbFiles();
  }

  console.log('\n=== Summary ===');
  let totalPass = 0;
  let totalFail = 0;
  for (const summary of allSummaries) {
    console.log(`${summary.name}: ${summary.passed} passed, ${summary.failed} failed (of ${summary.total})`);
    totalPass += summary.passed;
    totalFail += summary.failed;
    for (const r of summary.results.filter((r) => !r.pass)) {
      console.log(`   FAIL: ${r.name}\n         ${r.error}`);
    }
  }
  console.log(`\nTOTAL: ${totalPass} passed, ${totalFail} failed`);

  process.exitCode = crashed || totalFail > 0 ? 1 : 0;
}

main();
