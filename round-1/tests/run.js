'use strict';

/*
 * Waypoint test suite.
 *
 * This script is self-contained: it spawns its own server instance (on a
 * port distinct from the default 4000, so it won't collide with a human's
 * running server), points it at the real round-1/data/waypoint.db file
 * (the storage layer has no configurable path), runs every test against
 * that instance, then shuts the server down and deletes the db file
 * (+ -wal/-shm siblings) it created so that round-1/data/ is left exactly
 * as empty as it was found, preserving the "first registration = admin"
 * bootstrap invariant for a human's subsequent run.
 *
 * Run with:  node tests/run.js
 * (from round-1/, or use the absolute path shown in the test report)
 *
 * Only reads/writes:
 *   - round-1/data/waypoint.db (+ -wal/-shm) - created fresh, deleted at end
 *   - spawns round-1/server.js as a child process (not modified)
 * Never modifies application source.
 */

const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'waypoint.db');
const PORT = process.env.TEST_PORT ? Number(process.env.TEST_PORT) : 4917;
const BASE = `http://localhost:${PORT}`;

const results = [];

function record(name, pass, details) {
  results.push({ name, pass, details });
  const label = pass ? 'PASS' : 'FAIL';
  console.log(`[${label}] ${name}${details ? ' -- ' + details : ''}`);
}

function assert(condition, name, details) {
  record(name, !!condition, details);
  return !!condition;
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

async function req(pathname, { method = 'GET', body, cookie, headers = {}, rawBody } = {}) {
  const finalHeaders = { ...headers };
  if (body !== undefined) finalHeaders['Content-Type'] = 'application/json';
  if (cookie) finalHeaders['Cookie'] = cookie;
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: finalHeaders,
    body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (e) {
    json = null;
  }
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return { status: res.status, json, text, headers: res.headers, setCookie };
}

function cookieHeaderFromSetCookie(setCookieArr, name) {
  const full = (setCookieArr || []).find((c) => c.startsWith(name + '='));
  if (!full) return null;
  return full.split(';')[0];
}

function rawCookieString(setCookieArr, name) {
  return (setCookieArr || []).find((c) => c.startsWith(name + '=')) || null;
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

function cleanDbFiles() {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    const p = DB_PATH + suffix;
    if (fs.existsSync(p)) {
      fs.rmSync(p, { force: true });
    }
  }
}

function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ['server.js'], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => (out += d.toString()));
    proc.stderr.on('data', (d) => (err += d.toString()));
    proc.on('exit', (code) => {
      if (code !== null && code !== 0 && !proc.__intentionalKill) {
        console.error('Server process exited early. stdout:\n' + out + '\nstderr:\n' + err);
      }
    });
    proc.on('error', reject);

    // Poll /health until the server is up.
    const start = Date.now();
    const timeoutMs = 15000;
    (async function poll() {
      while (Date.now() - start < timeoutMs) {
        try {
          const res = await fetch(`${BASE}/health`);
          if (res.ok) {
            resolve(proc);
            return;
          }
        } catch (e) {
          // not up yet
        }
        await new Promise((r) => setTimeout(r, 150));
      }
      reject(new Error('Server did not become healthy within timeout.\nstdout:\n' + out + '\nstderr:\n' + err));
    })();
  });
}

function stopServer(proc) {
  return new Promise((resolve) => {
    if (!proc || proc.exitCode !== null) {
      resolve();
      return;
    }
    proc.__intentionalKill = true;
    proc.once('exit', () => resolve());
    proc.kill();
    // Fallback in case the process doesn't die promptly on this platform.
    setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch (e) {
        // already dead
      }
      resolve();
    }, 4000);
  });
}

// ---------------------------------------------------------------------------
// Direct DB manipulation for the genuine-expiry test
// ---------------------------------------------------------------------------

function expireSessionInDb(token) {
  // NOTE: this manipulates the throwaway sqlite file directly to simulate
  // real 7-day expiry without waiting a week. This tests the server's
  // enforcement of the expires_at check (getSession() in src/auth.js), not
  // the passage of real time.
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(DB_PATH);
  try {
    const past = new Date(Date.now() - 60 * 1000).toISOString(); // 1 minute in the past
    db.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run(past, token);
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

async function main() {
  cleanDbFiles();

  let proc;
  try {
    proc = await startServer();
  } catch (e) {
    console.error('FATAL: could not start server for testing:', e.message);
    process.exitCode = 1;
    return;
  }

  try {
    await runTests();
  } catch (e) {
    console.error('FATAL error while running tests:', e);
    record('test-suite-crash', false, String(e && e.stack ? e.stack : e));
  } finally {
    await stopServer(proc);
    cleanDbFiles();
  }

  const failed = results.filter((r) => !r.pass);
  console.log('\n--- Summary ---');
  console.log(`${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log('Failed:');
    failed.forEach((f) => console.log(`  - ${f.name}${f.details ? ': ' + f.details : ''}`));
  }
  process.exitCode = failed.length ? 1 : 0;
}

async function runTests() {
  // -------------------------------------------------------------------
  // GET /health
  // -------------------------------------------------------------------
  {
    const r = await req('/health');
    assert(r.status === 200 && r.json && r.json.status === 'ok', 'GET /health returns 200 {status:"ok"}', `got status=${r.status} body=${r.text}`);
  }

  // -------------------------------------------------------------------
  // Registration: admin bootstrap (first user)
  // -------------------------------------------------------------------
  const adminEmail = 'terence.luk+admin@gmail.com';
  const adminPassword = 'correct-horse-1';
  let adminCookie, adminUser;
  {
    const r = await req('/api/auth/register', { method: 'POST', body: { email: adminEmail, password: adminPassword } });
    const cookieOk = !!rawCookieString(r.setCookie, 'waypoint_session');
    const pass = r.status === 201 && r.json && r.json.user && r.json.user.email === adminEmail.toLowerCase() && r.json.user.isAdmin === true && cookieOk;
    assert(pass, 'Register: first account becomes admin (201, isAdmin:true, sets session cookie)', `status=${r.status} body=${JSON.stringify(r.json)}`);
    adminCookie = cookieHeaderFromSetCookie(r.setCookie, 'waypoint_session');
    adminUser = r.json && r.json.user;

    // Cookie attribute check
    const raw = rawCookieString(r.setCookie, 'waypoint_session') || '';
    const attrsOk =
      /HttpOnly/i.test(raw) &&
      /Path=\//.test(raw) &&
      /SameSite=Lax/i.test(raw) &&
      /Expires=/i.test(raw) &&
      !/Secure/i.test(raw.replace(/SameSite=Lax/i, '')); // ensure no separate Secure attribute
    assert(attrsOk, 'Session cookie has documented attributes (HttpOnly; Path=/; SameSite=Lax; Expires; no Secure)', raw);
  }

  // Registration validation errors
  {
    const r = await req('/api/auth/register', { method: 'POST', body: { email: 'not-an-email', password: 'longenough1' } });
    assert(r.status === 400 && r.json && r.json.error && r.json.error.code === 'VALIDATION_ERROR', 'Register: invalid email -> 400 VALIDATION_ERROR', `status=${r.status} body=${JSON.stringify(r.json)}`);
  }
  {
    const r = await req('/api/auth/register', { method: 'POST', body: { email: 'shortpass@example.com', password: 'short1' } });
    assert(r.status === 400 && r.json && r.json.error && r.json.error.code === 'VALIDATION_ERROR', 'Register: password < 8 chars -> 400 VALIDATION_ERROR', `status=${r.status} body=${JSON.stringify(r.json)}`);
  }
  {
    const r = await req('/api/auth/register', { method: 'POST', body: { email: adminEmail, password: 'irrelevant1' } });
    assert(r.status === 409 && r.json && r.json.error && r.json.error.code === 'EMAIL_TAKEN', 'Register: duplicate email -> 409 EMAIL_TAKEN', `status=${r.status} body=${JSON.stringify(r.json)}`);
  }

  // -------------------------------------------------------------------
  // Registration: second user (must NOT be admin)
  // -------------------------------------------------------------------
  const user2Email = 'waypoint-user2@example.com';
  const user2Password = 'password-two-1';
  let user2Cookie, user2User;
  {
    const r = await req('/api/auth/register', { method: 'POST', body: { email: user2Email, password: user2Password } });
    const pass = r.status === 201 && r.json && r.json.user && r.json.user.isAdmin === false;
    assert(pass, 'Register: second account is NOT admin', `status=${r.status} body=${JSON.stringify(r.json)}`);
    user2Cookie = cookieHeaderFromSetCookie(r.setCookie, 'waypoint_session');
    user2User = r.json && r.json.user;
  }

  // -------------------------------------------------------------------
  // Sign-in with valid credentials
  // -------------------------------------------------------------------
  {
    const r = await req('/api/auth/login', { method: 'POST', body: { email: adminEmail, password: adminPassword } });
    const pass = r.status === 200 && r.json && r.json.user && r.json.user.email === adminEmail.toLowerCase() && !!rawCookieString(r.setCookie, 'waypoint_session');
    assert(pass, 'Sign-in with valid credentials -> 200, returns user, sets session cookie', `status=${r.status} body=${JSON.stringify(r.json)}`);
    // refresh admin cookie to this new session for subsequent use
    adminCookie = cookieHeaderFromSetCookie(r.setCookie, 'waypoint_session');
  }

  // -------------------------------------------------------------------
  // Sign-in with invalid credentials
  // -------------------------------------------------------------------
  {
    const r = await req('/api/auth/login', { method: 'POST', body: { email: adminEmail, password: 'totally-wrong-password' } });
    assert(r.status === 401 && r.json && r.json.error && r.json.error.code === 'INVALID_CREDENTIALS', 'Sign-in with wrong password -> 401 INVALID_CREDENTIALS', `status=${r.status} body=${JSON.stringify(r.json)}`);
  }
  {
    const r = await req('/api/auth/login', { method: 'POST', body: { email: 'no-such-user@example.com', password: 'whatever1' } });
    assert(r.status === 401 && r.json && r.json.error && r.json.error.code === 'INVALID_CREDENTIALS', 'Sign-in with unknown email -> 401 INVALID_CREDENTIALS', `status=${r.status} body=${JSON.stringify(r.json)}`);
  }
  {
    const r = await req('/api/auth/login', { method: 'POST', body: { email: adminEmail } });
    assert(r.status === 400 && r.json && r.json.error && r.json.error.code === 'VALIDATION_ERROR', 'Sign-in with missing password -> 400 VALIDATION_ERROR', `status=${r.status} body=${JSON.stringify(r.json)}`);
  }

  // -------------------------------------------------------------------
  // GET /api/auth/me
  // -------------------------------------------------------------------
  {
    const r = await req('/api/auth/me', { cookie: adminCookie });
    assert(r.status === 200 && r.json && r.json.user && r.json.user.email === adminEmail.toLowerCase(), 'GET /api/auth/me with valid session -> 200 correct user', `status=${r.status} body=${JSON.stringify(r.json)}`);
  }
  {
    const r = await req('/api/auth/me');
    assert(r.status === 401 && r.json && r.json.error && r.json.error.code === 'UNAUTHENTICATED', 'GET /api/auth/me with no cookie -> 401 UNAUTHENTICATED', `status=${r.status} body=${JSON.stringify(r.json)}`);
  }

  // -------------------------------------------------------------------
  // Creating a pin
  // -------------------------------------------------------------------
  let adminPin1;
  {
    const body = { latitude: 48.8566, longitude: 2.3522, placeName: 'Paris', visitDate: '2024-05-01', note: 'Eiffel Tower' };
    const r = await req('/api/pins', { method: 'POST', body, cookie: adminCookie });
    const p = r.json && r.json.pin;
    const pass =
      r.status === 201 &&
      p &&
      p.userId === adminUser.id &&
      p.latitude === 48.8566 &&
      p.longitude === 2.3522 &&
      p.placeName === 'Paris' &&
      p.visitDate === '2024-05-01' &&
      p.note === 'Eiffel Tower' &&
      typeof p.id === 'number' &&
      typeof p.createdAt === 'string';
    assert(pass, 'Create pin (admin) -> 201 with correct fields, exact visitDate echoed', `status=${r.status} body=${JSON.stringify(r.json)}`);
    adminPin1 = p;
  }
  {
    // visitDate echoed exactly as full ISO datetime too
    const body = { latitude: 10, longitude: 10, placeName: 'Somewhere', visitDate: '2024-05-01T10:00:00.000Z' };
    const r = await req('/api/pins', { method: 'POST', body, cookie: adminCookie });
    assert(r.status === 201 && r.json.pin.visitDate === '2024-05-01T10:00:00.000Z' && r.json.pin.note === null, 'Create pin: full ISO datetime visitDate echoed exactly; omitted note -> null', `status=${r.status} body=${JSON.stringify(r.json)}`);
  }
  {
    const r = await req('/api/pins', { method: 'POST', body: { latitude: 999, longitude: 10, placeName: 'X', visitDate: '2024-01-01' }, cookie: adminCookie });
    assert(r.status === 400 && r.json.error.code === 'VALIDATION_ERROR', 'Create pin: latitude out of range -> 400 VALIDATION_ERROR', `status=${r.status} body=${JSON.stringify(r.json)}`);
  }
  {
    const r = await req('/api/pins', { method: 'POST', body: { latitude: 10, longitude: 10, placeName: '   ', visitDate: '2024-01-01' }, cookie: adminCookie });
    assert(r.status === 400 && r.json.error.code === 'VALIDATION_ERROR', 'Create pin: blank placeName -> 400 VALIDATION_ERROR', `status=${r.status} body=${JSON.stringify(r.json)}`);
  }
  {
    const r = await req('/api/pins', { method: 'POST', body: { latitude: 10, longitude: 10, placeName: 'X', visitDate: 'not-a-date' }, cookie: adminCookie });
    assert(r.status === 400 && r.json.error.code === 'VALIDATION_ERROR', 'Create pin: unparsable visitDate -> 400 VALIDATION_ERROR', `status=${r.status} body=${JSON.stringify(r.json)}`);
  }
  {
    const r = await req('/api/pins', { method: 'POST', body: { latitude: 10, longitude: 10, placeName: 'X', visitDate: '2024-01-01', note: 12345 }, cookie: adminCookie });
    assert(r.status === 400 && r.json.error.code === 'VALIDATION_ERROR', 'Create pin: non-string note -> 400 VALIDATION_ERROR', `status=${r.status} body=${JSON.stringify(r.json)}`);
  }
  {
    const r = await req('/api/pins', { method: 'POST', body: { latitude: 10, longitude: 10, placeName: 'X', visitDate: '2024-01-01' } });
    assert(r.status === 401 && r.json.error.code === 'UNAUTHENTICATED', 'Create pin: not signed in -> 401 UNAUTHENTICATED', `status=${r.status} body=${JSON.stringify(r.json)}`);
  }

  // -------------------------------------------------------------------
  // Listing pins (own only)
  // -------------------------------------------------------------------
  {
    const r = await req('/api/pins', { cookie: adminCookie });
    const pass = r.status === 200 && Array.isArray(r.json.pins) && r.json.pins.length === 2 && r.json.pins.every((p) => p.userId === adminUser.id);
    assert(pass, 'List pins: admin sees exactly their own 2 pins', `status=${r.status} body=${JSON.stringify(r.json)}`);
  }

  // A user2 pin, for cross-user tests
  let user2Pin;
  {
    const r = await req('/api/pins', {
      method: 'POST',
      body: { latitude: -33.8688, longitude: 151.2093, placeName: 'Sydney', visitDate: '2023-11-11', note: 'Opera House' },
      cookie: user2Cookie,
    });
    assert(r.status === 201, 'Create pin (user2) -> 201', `status=${r.status} body=${JSON.stringify(r.json)}`);
    user2Pin = r.json.pin;
  }

  // -------------------------------------------------------------------
  // HEADLINE CASE 1: cross-user pin isolation
  // -------------------------------------------------------------------
  {
    const r = await req('/api/pins', { cookie: user2Cookie });
    const ids = (r.json && r.json.pins ? r.json.pins : []).map((p) => p.id);
    const pass = r.status === 200 && !ids.includes(adminPin1.id) && r.json.pins.every((p) => p.userId === user2User.id);
    assert(pass, 'HEADLINE: GET /api/pins never returns another user\'s pins (user2 cannot read admin\'s pins)', `user2 pin ids=${JSON.stringify(ids)} admin pin id=${adminPin1.id}`);
  }
  {
    // user2 attempts to delete admin's pin -> must be 404, identical shape to a
    // truly nonexistent id, and must NOT actually delete it.
    const rDelete = await req(`/api/pins/${adminPin1.id}`, { method: 'DELETE', cookie: user2Cookie });
    const rNonexistent = await req('/api/pins/999999999', { method: 'DELETE', cookie: user2Cookie });
    const sameShape =
      rDelete.status === 404 &&
      rNonexistent.status === 404 &&
      rDelete.json &&
      rNonexistent.json &&
      rDelete.json.error.code === rNonexistent.json.error.code &&
      rDelete.json.error.code === 'NOT_FOUND';
    assert(sameShape, 'HEADLINE: DELETE another user\'s pin -> 404 NOT_FOUND, indistinguishable from a nonexistent id', `otherUserPinDelete=${JSON.stringify(rDelete.json)} status=${rDelete.status}; nonexistentDelete=${JSON.stringify(rNonexistent.json)} status=${rNonexistent.status}`);

    // Confirm the pin was NOT actually deleted (owner can still see/delete it).
    const rCheck = await req('/api/pins', { cookie: adminCookie });
    const stillThere = rCheck.json.pins.some((p) => p.id === adminPin1.id);
    assert(stillThere, 'HEADLINE: admin\'s pin survives user2\'s delete attempt (ownership enforced, not just response code)', `admin pins after attack=${JSON.stringify(rCheck.json.pins.map((p) => p.id))}`);
  }

  // -------------------------------------------------------------------
  // Deleting a pin (own)
  // -------------------------------------------------------------------
  {
    const r = await req(`/api/pins/${adminPin1.id}`, { method: 'DELETE', cookie: adminCookie });
    assert(r.status === 200 && r.json && r.json.message === 'Pin deleted.', 'Delete own pin -> 200 {message:"Pin deleted."}', `status=${r.status} body=${JSON.stringify(r.json)}`);

    const rList = await req('/api/pins', { cookie: adminCookie });
    const gone = !rList.json.pins.some((p) => p.id === adminPin1.id);
    assert(gone, 'Deleted pin no longer appears in GET /api/pins', `pins=${JSON.stringify(rList.json.pins.map((p) => p.id))}`);
  }
  {
    const r = await req('/api/pins/999999999', { method: 'DELETE', cookie: adminCookie });
    assert(r.status === 404 && r.json.error.code === 'NOT_FOUND', 'Delete nonexistent pin id -> 404 NOT_FOUND', `status=${r.status} body=${JSON.stringify(r.json)}`);
  }
  {
    const r = await req('/api/pins/not-a-number', { method: 'DELETE', cookie: adminCookie });
    assert(r.status === 400 && r.json.error.code === 'VALIDATION_ERROR', 'Delete pin with non-integer id -> 400 VALIDATION_ERROR', `status=${r.status} body=${JSON.stringify(r.json)}`);
  }
  {
    const r = await req(`/api/pins/${user2Pin.id}`, { method: 'DELETE' });
    assert(r.status === 401 && r.json.error.code === 'UNAUTHENTICATED', 'Delete pin: not signed in -> 401 UNAUTHENTICATED', `status=${r.status} body=${JSON.stringify(r.json)}`);
  }

  // -------------------------------------------------------------------
  // HEADLINE CASE 2: admin-only endpoint
  // -------------------------------------------------------------------
  {
    const r = await req('/api/admin/users', { cookie: adminCookie });
    const emails = (r.json && r.json.users ? r.json.users : []).map((u) => u.email);
    const pass = r.status === 200 && emails.includes(adminEmail.toLowerCase()) && emails.includes(user2Email.toLowerCase());
    assert(pass, 'Admin: GET /api/admin/users as admin -> 200 with full user list', `status=${r.status} body=${JSON.stringify(r.json)}`);
  }
  {
    const r = await req('/api/admin/users', { cookie: user2Cookie });
    assert(r.status === 403 && r.json && r.json.error && r.json.error.code === 'FORBIDDEN', 'HEADLINE: GET /api/admin/users as non-admin -> 403 FORBIDDEN', `status=${r.status} body=${JSON.stringify(r.json)}`);
  }
  {
    const r = await req('/api/admin/users');
    assert(r.status === 401 && r.json && r.json.error && r.json.error.code === 'UNAUTHENTICATED', 'Admin endpoint: not signed in -> 401 UNAUTHENTICATED', `status=${r.status} body=${JSON.stringify(r.json)}`);
  }
  {
    // Verify no password data leaks through the admin listing.
    const r = await req('/api/admin/users', { cookie: adminCookie });
    const leaks = (r.json.users || []).some((u) => 'password' in u || 'password_hash' in u || 'password_salt' in u || 'passwordHash' in u);
    assert(!leaks, 'Admin listing never exposes password data', JSON.stringify(r.json.users));
  }

  // -------------------------------------------------------------------
  // Logout
  // -------------------------------------------------------------------
  {
    // Use a fresh login so we don't disturb adminCookie used elsewhere.
    const login = await req('/api/auth/login', { method: 'POST', body: { email: user2Email, password: user2Password } });
    const freshCookie = cookieHeaderFromSetCookie(login.setCookie, 'waypoint_session');

    const r = await req('/api/auth/logout', { method: 'POST', cookie: freshCookie });
    assert(r.status === 200 && r.json && r.json.message === 'Logged out.', 'Logout -> 200 {message:"Logged out."}', `status=${r.status} body=${JSON.stringify(r.json)}`);

    const rMe = await req('/api/auth/me', { cookie: freshCookie });
    assert(rMe.status === 401 && rMe.json.error.code === 'UNAUTHENTICATED', 'Session cookie is invalid immediately after logout', `status=${rMe.status} body=${JSON.stringify(rMe.json)}`);

    const rLogoutAgain = await req('/api/auth/logout', { method: 'POST', cookie: freshCookie });
    assert(rLogoutAgain.status === 200, 'Logout is idempotent / always succeeds even when not signed in', `status=${rLogoutAgain.status} body=${JSON.stringify(rLogoutAgain.json)}`);
  }

  // -------------------------------------------------------------------
  // Rejection of invalid / tampered session
  // -------------------------------------------------------------------
  {
    const r = await req('/api/auth/me', { cookie: 'waypoint_session=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' });
    assert(r.status === 401 && r.json.error.code === 'UNAUTHENTICATED', 'Tampered/garbage session cookie (well-formed but unknown) -> 401 UNAUTHENTICATED', `status=${r.status} body=${JSON.stringify(r.json)}`);
  }
  {
    const r = await req('/api/auth/me', { cookie: 'waypoint_session=not-even-hex-garbage!!' });
    assert(r.status === 401 && r.json.error.code === 'UNAUTHENTICATED', 'Malformed session cookie value -> 401 UNAUTHENTICATED', `status=${r.status} body=${JSON.stringify(r.json)}`);
  }

  // -------------------------------------------------------------------
  // Rejection of genuinely expired session (direct DB manipulation)
  // -------------------------------------------------------------------
  {
    const login = await req('/api/auth/login', { method: 'POST', body: { email: adminEmail, password: adminPassword } });
    const cookie = cookieHeaderFromSetCookie(login.setCookie, 'waypoint_session');
    const token = cookie.split('=')[1];

    // Sanity: works before expiry manipulation.
    const before = await req('/api/auth/me', { cookie });
    const beforeOk = before.status === 200;

    // NOTE: this directly rewrites the expires_at column of this session's row
    // in the throwaway sqlite database to a timestamp in the past, rather than
    // waiting out the real 7-day TTL. This exercises the server's expiry-check
    // logic (getSession() in src/auth.js comparing expires_at to Date.now()),
    // not the passage of wall-clock time.
    expireSessionInDb(token);

    const after = await req('/api/auth/me', { cookie });
    const pass = beforeOk && after.status === 401 && after.json && after.json.error.code === 'UNAUTHENTICATED';
    assert(pass, 'Genuinely expired session (DB expires_at rewritten to the past) is rejected -> 401 UNAUTHENTICATED [tests server enforcement, not real-time expiry]', `before=${before.status} after=${after.status} body=${JSON.stringify(after.json)}`);
  }

  // -------------------------------------------------------------------
  // Error shape / unknown route
  // -------------------------------------------------------------------
  {
    const r = await req('/api/does-not-exist');
    const pass = r.status === 404 && r.json && r.json.error && typeof r.json.error.code === 'string' && typeof r.json.error.message === 'string';
    assert(pass, 'Unknown /api route -> 404 with documented error shape', `status=${r.status} body=${JSON.stringify(r.json)}`);
  }
  {
    const r = await req('/api/auth/register', { method: 'POST', rawBody: '{not valid json', headers: { 'Content-Type': 'application/json' } });
    assert(r.status === 400 && r.json && r.json.error && r.json.error.code === 'INVALID_JSON', 'Malformed JSON body -> 400 INVALID_JSON', `status=${r.status} body=${JSON.stringify(r.json)}`);
  }

  // -------------------------------------------------------------------
  // Frontend: static asset content types + doc alignment
  // (programmatically verified subset - see report for what could only be
  // verified by reading source, since no browser driver is available here)
  // -------------------------------------------------------------------
  {
    const r = await fetch(`${BASE}/`);
    const ct = r.headers.get('content-type') || '';
    assert(r.status === 200 && ct.includes('text/html'), 'GET / serves index.html with text/html content-type', `status=${r.status} content-type=${ct}`);
  }
  {
    const r = await fetch(`${BASE}/app.js`);
    const ct = r.headers.get('content-type') || '';
    assert(r.status === 200 && /javascript/.test(ct), 'GET /app.js served with a javascript content-type', `status=${r.status} content-type=${ct}`);
  }
  {
    const r = await fetch(`${BASE}/styles.css`);
    const ct = r.headers.get('content-type') || '';
    assert(r.status === 200 && ct.includes('text/css'), 'GET /styles.css served with text/css content-type', `status=${r.status} content-type=${ct}`);
  }
  {
    const r = await fetch(`${BASE}/world.svg`);
    const ct = r.headers.get('content-type') || '';
    assert(r.status === 200 && ct.includes('image/svg'), 'GET /world.svg served with image/svg+xml content-type', `status=${r.status} content-type=${ct}`);
  }
  {
    // Static hosting must never shadow /api/* or /health, per API.md.
    const r = await req('/api/auth/me'); // no cookie -> should be the JSON 401 handler, not a static 404 page
    assert(r.status === 401 && r.json && r.json.error, '/api/* is never shadowed by static file serving (still hits JSON handler)', `status=${r.status} content-type=${r.headers.get('content-type')}`);
  }
  {
    const appJsSource = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
    const routesUsed = ['/api/auth/register', '/api/auth/login', '/api/auth/logout', '/api/auth/me', '/api/pins', '/api/admin/users'];
    const missing = routesUsed.filter((route) => !appJsSource.includes(route));
    assert(missing.length === 0, 'app.js (source review) calls every route documented in API.md', `missing=${JSON.stringify(missing)}`);

    // Field names used in request bodies, per API.md request/response shapes.
    const fieldsUsed = ['email', 'password', 'latitude', 'longitude', 'placeName', 'visitDate', 'note'];
    const missingFields = fieldsUsed.filter((f) => !appJsSource.includes(f));
    assert(missingFields.length === 0, 'app.js (source review) uses the field names API.md documents', `missing=${JSON.stringify(missingFields)}`);

    // innerHTML usage should never be fed server/user-supplied text directly.
    // We check for the specific dangerous pattern (innerHTML assigned from a
    // template literal containing a user-controlled variable) is absent, and
    // that the known user-data render sites use textContent.
    const dangerousInnerHtmlWithUserData = /innerHTML\s*=\s*[`'"]?\s*\$\{\s*(pin|user|note|placeName|email)\b/.test(appJsSource);
    assert(!dangerousInnerHtmlWithUserData, 'app.js (source review) never interpolates pin/user-supplied fields into innerHTML', dangerousInnerHtmlWithUserData ? 'pattern found' : 'no such pattern found');

    const usesTextContentForPlaceName = /title\.textContent\s*=\s*pin\.placeName/.test(appJsSource);
    const usesTextContentForNote = /note\.textContent\s*=\s*pin\.note/.test(appJsSource);
    const usesTextContentForEmail = /emailCell\.textContent\s*=\s*user\.email/.test(appJsSource) && /currentUserEmail\.textContent\s*=\s*state\.user\.email/.test(appJsSource);
    assert(usesTextContentForPlaceName && usesTextContentForNote && usesTextContentForEmail, 'app.js (source review) renders pin.placeName, pin.note, user.email via textContent, not innerHTML', `placeName=${usesTextContentForPlaceName} note=${usesTextContentForNote} email=${usesTextContentForEmail}`);

    const hasUnauthHandler = /function handleUnauthenticated/.test(appJsSource) && /showScreen\('signin'\)/.test(appJsSource) && /res\.status === 401/.test(appJsSource);
    assert(hasUnauthHandler, 'app.js (source review) has a 401 handler that returns the UI to the sign-in screen', `found=${hasUnauthHandler}`);
  }

  // -------------------------------------------------------------------
  // CORS reflection (documented fallback behaviour)
  // -------------------------------------------------------------------
  {
    const res = await fetch(`${BASE}/health`, { headers: { Origin: 'http://localhost:5173' } });
    const allowOrigin = res.headers.get('access-control-allow-origin');
    const allowCreds = res.headers.get('access-control-allow-credentials');
    assert(allowOrigin === 'http://localhost:5173' && allowCreds === 'true', 'Server reflects Origin with Access-Control-Allow-Credentials:true (documented CORS fallback)', `allowOrigin=${allowOrigin} allowCreds=${allowCreds}`);
  }
}

main();
