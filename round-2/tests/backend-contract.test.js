'use strict';

/**
 * Backend contract tests for the Waypoint API, exercised against a live
 * server on WAYPOINT_TEST_BASE_URL (default http://localhost:4100),
 * verifying the behavior documented in round-2/API.md.
 *
 * This file only talks to the server over HTTP (plus one narrow,
 * documented exception: it opens the SQLite database directly, using the
 * built-in node:sqlite module, purely to fast-forward a session's
 * expiry so the "expired session is rejected" behavior can be verified
 * without waiting 7 real days). It never edits application source and
 * never leaves stray rows behind that a normal API-only cleanup wouldn't
 * also have left (the row it edits is deleted anyway once the API treats
 * the session as expired, matching documented behavior).
 *
 * IMPORTANT ORDERING NOTE: the admin-bootstrap rule ("first user ever
 * registered becomes admin") means this file must be the *first* thing
 * to register a user against a freshly emptied database. tests/run-all.js
 * guarantees that ordering (wipes data/waypoint.db*, then runs this file
 * before the others).
 */

const path = require('node:path');
const { Suite, call, assert, assertEqual, uniqueEmail } = require('./lib/testkit');

async function run() {
  const s = new Suite('Backend contract');

  // ---------------------------------------------------------------------
  // Registration validation (must NOT create a user row, so the admin
  // bootstrap slot is still open afterward).
  // ---------------------------------------------------------------------

  await s.test('POST /api/auth/register rejects missing email (400 VALIDATION_ERROR)', async () => {
    const res = await call('/api/auth/register', { method: 'POST', body: { password: 'longenough123' } });
    assertEqual(res.status, 400, 'status');
    assertEqual(res.json && res.json.error && res.json.error.code, 'VALIDATION_ERROR', 'error.code');
  });

  await s.test('POST /api/auth/register rejects malformed email (400 VALIDATION_ERROR)', async () => {
    const res = await call('/api/auth/register', {
      method: 'POST',
      body: { email: 'not-an-email', password: 'longenough123' },
    });
    assertEqual(res.status, 400, 'status');
    assertEqual(res.json && res.json.error && res.json.error.code, 'VALIDATION_ERROR', 'error.code');
  });

  await s.test('POST /api/auth/register rejects password under 8 chars (400 VALIDATION_ERROR)', async () => {
    const res = await call('/api/auth/register', {
      method: 'POST',
      body: { email: uniqueEmail('shortpw'), password: 'short1' },
    });
    assertEqual(res.status, 400, 'status');
    assertEqual(res.json && res.json.error && res.json.error.code, 'VALIDATION_ERROR', 'error.code');
  });

  // ---------------------------------------------------------------------
  // Admin bootstrap: this MUST be the first successful registration
  // against the freshly-emptied DB.
  // ---------------------------------------------------------------------

  const adminEmail = uniqueEmail('admin-user');
  const adminPassword = 'AdminPass123!';
  let adminCookie = null;
  let adminId = null;

  await s.test('First-ever successful registration is granted role=admin (bootstrap rule)', async () => {
    const res = await call('/api/auth/register', {
      method: 'POST',
      body: { email: adminEmail, password: adminPassword },
    });
    assertEqual(res.status, 201, 'status');
    assert(res.json && res.json.user, 'response has user object');
    assertEqual(res.json.user.email, adminEmail.toLowerCase(), 'email echoed back lowercased');
    assertEqual(res.json.user.role, 'admin', 'role of first registrant');
    assert(Number.isInteger(res.json.user.id), 'user.id is an integer');
    assert(typeof res.json.user.createdAt === 'string', 'user.createdAt is a string');
    assert(
      Object.keys(res.json.user).sort().join(',') === 'createdAt,email,id,role',
      `user object exposes exactly id/email/role/createdAt, got: ${Object.keys(res.json.user).sort().join(',')}`
    );
    assert(res.sessionCookie, 'Set-Cookie: waypoint_session=... present on register');
    adminCookie = res.sessionCookie;
    adminId = res.json.user.id;
  });

  const bobEmail = uniqueEmail('bob-user');
  const bobPassword = 'BobPassword123';
  let bobCookie = null;
  let bobId = null;

  await s.test('Second-ever registration defaults to role=user', async () => {
    const res = await call('/api/auth/register', {
      method: 'POST',
      body: { email: bobEmail, password: bobPassword },
    });
    assertEqual(res.status, 201, 'status');
    assertEqual(res.json.user.role, 'user', 'role of second registrant');
    assert(res.sessionCookie, 'Set-Cookie present on register');
    bobCookie = res.sessionCookie;
    bobId = res.json.user.id;
  });

  await s.test('Duplicate email registration is rejected (409 CONFLICT)', async () => {
    const res = await call('/api/auth/register', {
      method: 'POST',
      body: { email: adminEmail.toUpperCase(), password: 'SomeOtherPassword1' },
    });
    assertEqual(res.status, 409, 'status (also proves email uniqueness is case-insensitive)');
    assertEqual(res.json && res.json.error && res.json.error.code, 'CONFLICT', 'error.code');
  });

  // ---------------------------------------------------------------------
  // Sign-in: valid and invalid credentials.
  // ---------------------------------------------------------------------

  await s.test('POST /api/auth/login succeeds with correct credentials', async () => {
    const res = await call('/api/auth/login', { method: 'POST', body: { email: bobEmail, password: bobPassword } });
    assertEqual(res.status, 200, 'status');
    assertEqual(res.json.user.email, bobEmail.toLowerCase(), 'email');
    assertEqual(res.json.user.role, 'user', 'role');
    assert(res.sessionCookie, 'Set-Cookie present on login');
  });

  await s.test('POST /api/auth/login rejects wrong password (401 INVALID_CREDENTIALS)', async () => {
    const res = await call('/api/auth/login', { method: 'POST', body: { email: bobEmail, password: 'totallyWrongPassword' } });
    assertEqual(res.status, 401, 'status');
    assertEqual(res.json.error.code, 'INVALID_CREDENTIALS', 'error.code');
  });

  await s.test('POST /api/auth/login rejects unknown email with same code as wrong password (401 INVALID_CREDENTIALS)', async () => {
    const res = await call('/api/auth/login', { method: 'POST', body: { email: uniqueEmail('nobody'), password: 'whateverpassword' } });
    assertEqual(res.status, 401, 'status');
    assertEqual(res.json.error.code, 'INVALID_CREDENTIALS', 'error.code (should not leak whether email exists)');
  });

  await s.test('POST /api/auth/login rejects missing fields (400 VALIDATION_ERROR)', async () => {
    const res = await call('/api/auth/login', { method: 'POST', body: { email: bobEmail } });
    assertEqual(res.status, 400, 'status');
    assertEqual(res.json.error.code, 'VALIDATION_ERROR', 'error.code');
  });

  // ---------------------------------------------------------------------
  // Session validity / me / sign-out.
  // ---------------------------------------------------------------------

  await s.test('GET /api/auth/me returns the signed-in user with a valid cookie', async () => {
    const res = await call('/api/auth/me', { cookie: adminCookie });
    assertEqual(res.status, 200, 'status');
    assertEqual(res.json.user.id, adminId, 'user.id matches the admin who owns this cookie');
    assertEqual(res.json.user.role, 'admin', 'role');
  });

  await s.test('GET /api/auth/me rejects a request with no cookie (401 UNAUTHORIZED)', async () => {
    const res = await call('/api/auth/me');
    assertEqual(res.status, 401, 'status');
    assertEqual(res.json.error.code, 'UNAUTHORIZED', 'error.code');
  });

  await s.test('GET /api/auth/me rejects an unknown/garbage session token (401 UNAUTHORIZED)', async () => {
    const res = await call('/api/auth/me', { cookie: 'waypoint_session=' + 'a'.repeat(64) });
    assertEqual(res.status, 401, 'status');
    assertEqual(res.json.error.code, 'UNAUTHORIZED', 'error.code');
  });

  await s.test('POST /api/auth/logout invalidates the session server-side; reused cookie then gets 401', async () => {
    // Get a fresh, single-purpose cookie for bob so we don't burn the one
    // later tests still need.
    const loginRes = await call('/api/auth/login', { method: 'POST', body: { email: bobEmail, password: bobPassword } });
    const throwawayCookie = loginRes.sessionCookie;
    assert(throwawayCookie, 'got a fresh session cookie to log out with');

    const meBefore = await call('/api/auth/me', { cookie: throwawayCookie });
    assertEqual(meBefore.status, 200, 'sanity: session works before logout');

    const logoutRes = await call('/api/auth/logout', { method: 'POST', cookie: throwawayCookie });
    assertEqual(logoutRes.status, 200, 'logout status');
    assertEqual(logoutRes.json.ok, true, 'logout body');

    const meAfter = await call('/api/auth/me', { cookie: throwawayCookie });
    assertEqual(meAfter.status, 401, 'same cookie is rejected after logout (server-side invalidation)');
    assertEqual(meAfter.json.error.code, 'UNAUTHORIZED', 'error.code after logout');
  });

  await s.test('POST /api/auth/logout is a safe no-op with no session', async () => {
    const res = await call('/api/auth/logout', { method: 'POST' });
    assertEqual(res.status, 200, 'status');
    assertEqual(res.json.ok, true, 'body');
  });

  await s.test('An expired session is rejected and cleaned up server-side (401 UNAUTHORIZED)', async () => {
    const loginRes = await call('/api/auth/login', { method: 'POST', body: { email: bobEmail, password: bobPassword } });
    const cookie = loginRes.sessionCookie;
    const token = /waypoint_session=([^;]+)/.exec(cookie)[1];

    // Fast-forward this one session's expiry using the same on-disk
    // SQLite database the server itself uses (node:sqlite, a Node
    // built-in -- no application source is touched). This is the only
    // practical way to test 7-day expiry without waiting 7 days.
    const { DatabaseSync } = require('node:sqlite');
    const dbPath = path.join(__dirname, '..', 'data', 'waypoint.db');
    const sideDb = new DatabaseSync(dbPath);
    try {
      sideDb.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run('2000-01-01T00:00:00.000Z', token);
      const row = sideDb.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
      assert(row, 'sanity: session row exists before expiry check');
    } finally {
      sideDb.close();
    }

    const res = await call('/api/auth/me', { cookie });
    assertEqual(res.status, 401, 'expired session treated as unauthenticated');
    assertEqual(res.json.error.code, 'UNAUTHORIZED', 'error.code');

    // Documented behavior: "An expired session is deleted on next use."
    const sideDb2 = new DatabaseSync(dbPath);
    try {
      const row = sideDb2.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
      assert(!row, 'expired session row was deleted server-side on next use');
    } finally {
      sideDb2.close();
    }
  });

  // Re-establish fresh cookies for the remaining tests (logout/expiry
  // tests above intentionally burned throwaway ones).
  const bobLogin = await call('/api/auth/login', { method: 'POST', body: { email: bobEmail, password: bobPassword } });
  bobCookie = bobLogin.sessionCookie;
  const adminLogin = await call('/api/auth/login', { method: 'POST', body: { email: adminEmail, password: adminPassword } });
  adminCookie = adminLogin.sessionCookie;

  // ---------------------------------------------------------------------
  // Pins: create / list / delete against documented field names.
  // ---------------------------------------------------------------------

  let bobPinOld = null;
  let bobPinNew = null;

  await s.test('POST /api/pins creates a pin with documented request/response field names', async () => {
    const res = await call('/api/pins', {
      method: 'POST',
      cookie: bobCookie,
      body: { latitude: 48.8566, longitude: 2.3522, placeName: 'Paris', visitDate: '2024-05-01', note: 'Louvre visit' },
    });
    assertEqual(res.status, 201, 'status');
    const pin = res.json.pin;
    assert(pin, 'response has pin object');
    assertEqual(pin.latitude, 48.8566, 'latitude');
    assertEqual(pin.longitude, 2.3522, 'longitude');
    assertEqual(pin.placeName, 'Paris', 'placeName');
    assertEqual(pin.visitDate, '2024-05-01', 'visitDate');
    assertEqual(pin.note, 'Louvre visit', 'note');
    assert(typeof pin.createdAt === 'string', 'createdAt is a string');
    assert(
      Object.keys(pin).sort().join(',') === 'createdAt,id,latitude,longitude,note,placeName,visitDate',
      `pin exposes exactly the documented fields, got: ${Object.keys(pin).sort().join(',')}`
    );
    bobPinOld = pin;
  });

  await s.test('POST /api/pins accepts an omitted note as null', async () => {
    const res = await call('/api/pins', {
      method: 'POST',
      cookie: bobCookie,
      body: { latitude: 40.7128, longitude: -74.006, placeName: 'New York', visitDate: '2024-08-15' },
    });
    assertEqual(res.status, 201, 'status');
    assertEqual(res.json.pin.note, null, 'note defaults to null when omitted');
    bobPinNew = res.json.pin;
  });

  await s.test('POST /api/pins rejects out-of-range latitude (400 VALIDATION_ERROR)', async () => {
    const res = await call('/api/pins', {
      method: 'POST',
      cookie: bobCookie,
      body: { latitude: 999, longitude: 0, placeName: 'Nowhere', visitDate: '2024-01-01' },
    });
    assertEqual(res.status, 400, 'status');
    assertEqual(res.json.error.code, 'VALIDATION_ERROR', 'error.code');
  });

  await s.test('POST /api/pins rejects a missing placeName (400 VALIDATION_ERROR)', async () => {
    const res = await call('/api/pins', {
      method: 'POST',
      cookie: bobCookie,
      body: { latitude: 0, longitude: 0, visitDate: '2024-01-01' },
    });
    assertEqual(res.status, 400, 'status');
  });

  await s.test('POST /api/pins rejects a badly-formatted visitDate (400 VALIDATION_ERROR)', async () => {
    const res = await call('/api/pins', {
      method: 'POST',
      cookie: bobCookie,
      body: { latitude: 0, longitude: 0, placeName: 'X', visitDate: '05/01/2024' },
    });
    assertEqual(res.status, 400, 'status');
  });

  await s.test('GET /api/pins lists only the caller\'s pins, newest visitDate first', async () => {
    const res = await call('/api/pins', { cookie: bobCookie });
    assertEqual(res.status, 200, 'status');
    assert(Array.isArray(res.json.pins), 'pins is an array');
    const ids = res.json.pins.map((p) => p.id);
    assert(ids.includes(bobPinOld.id) && ids.includes(bobPinNew.id), 'both of bob\'s pins are present');
    const idxNew = ids.indexOf(bobPinNew.id);
    const idxOld = ids.indexOf(bobPinOld.id);
    assert(idxNew < idxOld, 'newer visitDate (2024-08-15) sorts before older (2024-05-01)');
  });

  await s.test('DELETE /api/pins/:id removes the caller\'s own pin', async () => {
    const res = await call(`/api/pins/${bobPinOld.id}`, { method: 'DELETE', cookie: bobCookie });
    assertEqual(res.status, 200, 'status');
    assertEqual(res.json.ok, true, 'body.ok');
    assertEqual(res.json.id, bobPinOld.id, 'body.id');

    const listRes = await call('/api/pins', { cookie: bobCookie });
    const ids = listRes.json.pins.map((p) => p.id);
    assert(!ids.includes(bobPinOld.id), 'deleted pin no longer listed');
  });

  await s.test('DELETE /api/pins/:id on a nonexistent id returns 404 NOT_FOUND', async () => {
    const res = await call('/api/pins/999999999', { method: 'DELETE', cookie: bobCookie });
    assertEqual(res.status, 404, 'status');
    assertEqual(res.json.error.code, 'NOT_FOUND', 'error.code');
  });

  await s.test('DELETE /api/pins/:id with a non-numeric id returns 400 VALIDATION_ERROR', async () => {
    const res = await call('/api/pins/not-a-number', { method: 'DELETE', cookie: bobCookie });
    assertEqual(res.status, 400, 'status');
    assertEqual(res.json.error.code, 'VALIDATION_ERROR', 'error.code');
  });

  // ---------------------------------------------------------------------
  // Authorization boundaries -- the cases that matter most.
  // ---------------------------------------------------------------------

  let adminPin = null;

  await s.test('setup: admin creates a pin of their own for the cross-user tests', async () => {
    const res = await call('/api/pins', {
      method: 'POST',
      cookie: adminCookie,
      body: { latitude: 51.5074, longitude: -0.1278, placeName: 'London', visitDate: '2024-03-03', note: 'admin-owned' },
    });
    assertEqual(res.status, 201, 'status');
    adminPin = res.json.pin;
  });

  await s.test('User A (bob) cannot see User B\'s (admin\'s) pin in GET /api/pins', async () => {
    const res = await call('/api/pins', { cookie: bobCookie });
    assertEqual(res.status, 200, 'status');
    const ids = res.json.pins.map((p) => p.id);
    assert(!ids.includes(adminPin.id), 'bob\'s pin list does not include admin\'s pin');
  });

  await s.test('User A (bob) cannot DELETE User B\'s (admin\'s) pin -- 404, and the pin survives', async () => {
    const res = await call(`/api/pins/${adminPin.id}`, { method: 'DELETE', cookie: bobCookie });
    assertEqual(res.status, 404, 'status (same 404 as a nonexistent pin, by design)');
    assertEqual(res.json.error.code, 'NOT_FOUND', 'error.code');

    // Verify the pin was NOT deleted by re-listing as its actual owner.
    const listRes = await call('/api/pins', { cookie: adminCookie });
    const ids = listRes.json.pins.map((p) => p.id);
    assert(ids.includes(adminPin.id), 'admin\'s pin still exists after the cross-user delete attempt');
  });

  await s.test('Unauthenticated requests to every protected route are rejected with 401', async () => {
    const checks = [
      ['GET', '/api/auth/me'],
      ['GET', '/api/pins'],
      ['POST', '/api/pins'],
      ['DELETE', `/api/pins/${adminPin.id}`],
      ['GET', '/api/admin/users'],
    ];
    for (const [method, url] of checks) {
      const res = await call(url, { method });
      assertEqual(res.status, 401, `${method} ${url} should be 401 when unauthenticated`);
      assertEqual(res.json.error.code, 'UNAUTHORIZED', `${method} ${url} error.code`);
    }
  });

  await s.test('Non-admin (bob) requesting GET /api/admin/users receives 403 FORBIDDEN', async () => {
    const res = await call('/api/admin/users', { cookie: bobCookie });
    assertEqual(res.status, 403, 'status');
    assertEqual(res.json.error.code, 'FORBIDDEN', 'error.code');
  });

  await s.test('Admin receives the full user list, with no password/hash/salt data anywhere', async () => {
    const res = await call('/api/admin/users', { cookie: adminCookie });
    assertEqual(res.status, 200, 'status');
    assert(Array.isArray(res.json.users), 'users is an array');
    const emails = res.json.users.map((u) => u.email);
    assert(emails.includes(adminEmail.toLowerCase()), 'admin is listed');
    assert(emails.includes(bobEmail.toLowerCase()), 'bob is listed');

    const bodyText = res.text.toLowerCase();
    for (const forbidden of ['password', 'hash', 'salt', 'scrypt']) {
      assert(!bodyText.includes(forbidden), `response body must not contain "${forbidden}"`);
    }
    for (const u of res.json.users) {
      assert(
        Object.keys(u).sort().join(',') === 'createdAt,email,id,role',
        `user row exposes exactly id/email/role/createdAt, got: ${Object.keys(u).sort().join(',')}`
      );
    }
  });

  // ---------------------------------------------------------------------
  // /api/* is never shadowed by static files.
  // ---------------------------------------------------------------------

  await s.test('Unmatched /api/* path returns a JSON 404 NOT_FOUND, not a static fallback', async () => {
    const res = await call('/api/this-route-does-not-exist');
    assertEqual(res.status, 404, 'status');
    assert(res.contentType.includes('application/json'), `content-type should be JSON, got "${res.contentType}"`);
    assertEqual(res.json.error.code, 'NOT_FOUND', 'error.code');
  });

  await s.test('An /api/* path that collides with a real static filename is still a JSON 404, not the static file', async () => {
    // public/index.html exists as a static file; /api/index.html should
    // NOT be served from public/ -- it must fall into the API 404 handler.
    const res = await call('/api/index.html');
    assertEqual(res.status, 404, 'status');
    assert(res.contentType.includes('application/json'), `content-type should be JSON, got "${res.contentType}"`);
  });

  return s.summary();
}

module.exports = { run };

if (require.main === module) {
  run().then((summary) => {
    process.exit(summary.failed > 0 ? 1 : 0);
  });
}
