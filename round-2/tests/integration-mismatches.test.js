'use strict';

/**
 * Proves, with real HTTP calls against the live server, every concrete
 * incompatibility between the frontend's guessed contract
 * (round-2/public/js/api.js, auth.js, FRONTEND-ASSUMPTIONS.md) and the
 * backend's real contract (round-2/API.md / round-2/src/**).
 *
 * The small helper functions below (frontendLoginHandlesResponse,
 * frontendExtractErrorMessage, frontendIsAdmin, frontendRenderPinFields)
 * are verbatim copies of the corresponding logic in public/js/*.js,
 * inlined here ONLY so this test can execute that exact client-side
 * logic against real server responses and show what a browser running
 * the real frontend would actually do. Nothing under public/ is
 * imported, required, or modified.
 */

const { Suite, call, assert, assertEqual, uniqueEmail } = require('./lib/testkit');

// --- verbatim copies of frontend logic under test (see public/js/*.js) ---

// From public/js/login.js, inside the submit handler.
function frontendLoginHandlesResponse(data) {
  const user = (data && (data.user || data)) || null;
  const token = data && data.token;
  if (!token || !user) {
    throw new Error('Unexpected response from server.');
  }
  return { user, token };
}

// From public/js/api.js, extractErrorMessage().
function frontendExtractErrorMessage(body, fallback) {
  if (!body) return fallback;
  if (typeof body === 'string') return body || fallback;
  if (body.error && typeof body.error === 'string') return body.error;
  if (body.message && typeof body.message === 'string') return body.message;
  if (Array.isArray(body.errors) && body.errors.length) {
    return body.errors.map((e) => (typeof e === 'string' ? e : e.message)).join(', ');
  }
  return fallback;
}

// From public/js/auth.js, Auth.isAdmin().
function frontendIsAdmin(user) {
  if (!user) return false;
  if (typeof user.isAdmin === 'boolean') return user.isAdmin;
  if (typeof user.is_admin === 'boolean') return user.is_admin;
  if (typeof user.role === 'string') return user.role.toLowerCase() === 'admin';
  return false;
}

// From public/js/app.js, renderPinList() -- the fields it reads off each pin.
function frontendReadsPinAs(pin) {
  return { name: pin.name, lat: pin.lat, lng: pin.lng, date: pin.date, note: pin.note, id: pin.id };
}

async function run() {
  const s = new Suite('Frontend/backend integration mismatches');

  const email = uniqueEmail('mismatch-user');
  const password = 'FrontendGuessPW1';
  let sessionCookie = null;

  // -----------------------------------------------------------------
  // MISMATCH 1: auth mechanism (bearer token vs. session cookie) and
  // register/login response shape ({token, user:{isAdmin}} assumed vs.
  // real {user:{role}} + Set-Cookie).
  // -----------------------------------------------------------------

  await s.test(
    'MISMATCH: real POST /api/auth/register response has no "token" field, contradicting api.js\'s bearer-token assumption',
    async () => {
      // Sent with the frontend's exact request body shape: { name, email, password }.
      const res = await call('/api/auth/register', {
        method: 'POST',
        body: { name: 'Frontend User', email, password },
      });
      assertEqual(res.status, 201, 'registration itself succeeds (name is silently ignored server-side)');
      assert(!('name' in res.json.user), 'server does not echo back / store a "name" field at all');
      assert(res.json.token === undefined, 'no top-level "token" field in the response body');
      assert(res.json.user.isAdmin === undefined, 'no boolean "isAdmin" field on the user object');
      assert(typeof res.json.user.role === 'string', 'real server uses a "role" string instead');
      assert(res.sessionCookie, 'server DOES set a waypoint_session cookie -- the real mechanism -- which api.js never reads or relies on');
      sessionCookie = res.sessionCookie;
    }
  );

  await s.test(
    'MISMATCH: replaying login.js\'s exact response-handling logic against a real, successful login throws "Unexpected response from server."',
    async () => {
      const res = await call('/api/auth/login', { method: 'POST', body: { email, password } });
      assertEqual(res.status, 200, 'the login itself is genuinely successful and credentials are correct');
      let threw = null;
      try {
        frontendLoginHandlesResponse(res.json);
      } catch (err) {
        threw = err;
      }
      assert(
        threw && threw.message === 'Unexpected response from server.',
        'login.js treats every real, successful login as a failure because res.json.token is always undefined -- ' +
          'USER-VISIBLE SYMPTOM: the sign-in form always shows "Unexpected response from server." even with correct credentials, and the user can never reach index.html through the UI.'
      );
    }
  );

  await s.test(
    'MISMATCH: since no token is ever stored, Auth.requireAuth() bounces every page load straight back to login.html without even calling GET /api/auth/me',
    async () => {
      // Reproduces API.setSession()/getToken(): setSession() only ever
      // calls localStorage.setItem(TOKEN_KEY, token) `if (token)`. Since
      // the real register/login response never has data.token, the
      // token is simply never written, so getToken() is permanently null
      // for a real backend -- even though the browser silently holds a
      // valid waypoint_session cookie from Set-Cookie.
      const registerRes = await call('/api/auth/register', {
        method: 'POST',
        body: { name: 'Another User', email: uniqueEmail('mismatch-user2'), password },
      });
      const simulatedStoredToken = registerRes.json.token; // what api.js's setSession() would have stored
      assert(
        simulatedStoredToken === undefined,
        'simulated localStorage token is undefined -- Auth.requireAuth() short-circuits on `if (!token) { redirectToLogin(); return null; }` ' +
          'USER-VISIBLE SYMPTOM: every protected page (index.html, admin.html) redirects back to login.html on load, even for a browser that is holding a perfectly valid session cookie.'
      );
    }
  );

  // -----------------------------------------------------------------
  // MISMATCH 2: pin field names (lat/lng/name/date vs.
  // latitude/longitude/placeName/visitDate).
  // -----------------------------------------------------------------

  await s.test(
    'MISMATCH: posting a pin with the frontend\'s exact field names (name/lat/lng/date/note) is rejected as 400 VALIDATION_ERROR',
    async () => {
      const res = await call('/api/pins', {
        method: 'POST',
        cookie: sessionCookie,
        body: { name: 'Kyoto', lat: 35.0116, lng: 135.7681, date: '2024-05-01', note: 'temple visit' },
      });
      assertEqual(res.status, 400, 'status');
      assertEqual(res.json.error.code, 'VALIDATION_ERROR', 'error.code');
      assert(
        /latitude/.test(res.json.error.message) && /longitude/.test(res.json.error.message) && /placeName/.test(res.json.error.message) && /visitDate/.test(res.json.error.message),
        `server error names the fields it actually wants: "${res.json.error.message}" -- ` +
          'USER-VISIBLE SYMPTOM: clicking "Add pin" in the UI always fails; createPin() in api.js can never succeed against the real backend.'
      );
    }
  );

  let realPin = null;
  await s.test('setup: create one pin using the REAL backend field names, to test list-rendering against it', async () => {
    const res = await call('/api/pins', {
      method: 'POST',
      cookie: sessionCookie,
      body: { latitude: 35.0116, longitude: 135.7681, placeName: 'Kyoto', visitDate: '2024-05-01', note: 'temple visit' },
    });
    assertEqual(res.status, 201, 'status');
    realPin = res.json.pin;
  });

  await s.test(
    'MISMATCH: even a pin that does exist renders as blank/NaN in the UI because app.js reads pin.name/pin.lat/pin.lng/pin.date, which the real API never sends',
    async () => {
      const res = await call('/api/pins', { cookie: sessionCookie });
      assertEqual(res.status, 200, 'status');
      const serverPin = res.json.pins.find((p) => p.id === realPin.id);
      assert(serverPin, 'the pin created above is present in the real response');
      const asFrontendSeesIt = frontendReadsPinAs(serverPin);
      assert(asFrontendSeesIt.name === undefined, 'pin.name is undefined (real field is placeName)');
      assert(asFrontendSeesIt.lat === undefined, 'pin.lat is undefined (real field is latitude)');
      assert(asFrontendSeesIt.lng === undefined, 'pin.lng is undefined (real field is longitude)');
      assert(asFrontendSeesIt.date === undefined, 'pin.date is undefined (real field is visitDate)');
      // app.js: `${escapeHtml(pin.name || 'Unnamed place')}` and
      // `Number(pin.lat).toFixed(3)` -- reproduce that exact rendering:
      const renderedName = asFrontendSeesIt.name || 'Unnamed place';
      const renderedCoords = `${Number(asFrontendSeesIt.lat).toFixed(3)}, ${Number(asFrontendSeesIt.lng).toFixed(3)}`;
      assertEqual(renderedName, 'Unnamed place', 'USER-VISIBLE SYMPTOM: pin list shows "Unnamed place" instead of "Kyoto"');
      assertEqual(renderedCoords, 'NaN, NaN', 'USER-VISIBLE SYMPTOM: pin list shows "NaN, NaN" instead of real coordinates');
    }
  );

  // -----------------------------------------------------------------
  // MISMATCH 3: error response shape ({error:"string"} assumed vs.
  // real {error:{code,message}}).
  // -----------------------------------------------------------------

  await s.test(
    'MISMATCH: real error body is {error:{code,message}} (nested object), not {error:"message"} (string) -- extractErrorMessage() falls back to a generic message',
    async () => {
      const res = await call('/api/auth/register', {
        method: 'POST',
        body: { email: uniqueEmail('weakpw'), password: 'short' },
      });
      assertEqual(res.status, 400, 'status');
      assert(typeof res.json.error === 'object' && res.json.error !== null, 'real error.error is an object, not a string');
      const extracted = frontendExtractErrorMessage(res.json, `Request failed (${res.status})`);
      assertEqual(
        extracted,
        `Request failed (${res.status})`,
        'USER-VISIBLE SYMPTOM: instead of "Password must be at least 8 characters long.", the UI shows the generic "Request failed (400)" for every single validation error.'
      );
    }
  );

  // -----------------------------------------------------------------
  // MISMATCH 4: admin detection flag (isAdmin boolean assumed; real
  // API only ever sends role:"admin"|"user"). This one is a partial
  // pass by luck: auth.js's role-string fallback does work, IF the
  // client ever gets a user object at all (it doesn't, per MISMATCH 1).
  // -----------------------------------------------------------------

  await s.test(
    'PARTIAL: Auth.isAdmin()\'s role-string fallback WOULD correctly detect an admin user object if one ever reached the client',
    async () => {
      assertEqual(frontendIsAdmin({ role: 'admin' }), true, 'role:"admin" fallback works');
      assertEqual(frontendIsAdmin({ role: 'user' }), false, 'role:"user" fallback works');
      assertEqual(
        frontendIsAdmin({ id: 1, email: 'x@example.com', role: 'admin', createdAt: '...' }),
        true,
        'a real /api/auth/me or /api/admin/users user row is correctly recognized as admin by isAdmin() IF it ever reaches this code -- ' +
          'but per the earlier mismatches, requireAuth() never calls /api/auth/me in the first place, so this fallback never actually gets exercised in practice.'
      );
    }
  );

  await s.test(
    'MISMATCH: GET /api/admin/users rows have no "name" field, so admin.html\'s user table always shows "—" in the Name column',
    async () => {
      // (This user is not an admin, so we only assert on the field shape
      // via a direct FORBIDDEN response's absence of "name" is not
      // meaningful; instead assert against the pin/user shape already
      // proven in backend-contract.test.js: the user object never has
      // "name". Demonstrated here structurally.)
      const meRes = await call('/api/auth/me', { cookie: sessionCookie });
      assertEqual(meRes.status, 200, 'status');
      assert(!('name' in meRes.json.user), 'user object has no "name" field anywhere in the real API');
    }
  );

  return s.summary();
}

module.exports = { run };

if (require.main === module) {
  run().then((summary) => {
    process.exit(summary.failed > 0 ? 1 : 0);
  });
}
