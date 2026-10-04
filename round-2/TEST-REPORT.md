# Waypoint — Test Report (round-2)

Scope: `round-2` only. Backend contract per `round-2/API.md`, frontend guesses
per `round-2/public/FRONTEND-ASSUMPTIONS.md`. No application source was
modified — all test code lives under `round-2/tests/`.

## How to reproduce

```
cd round-2
node tests/run-all.js
```

This single command:
1. Wipes any existing `data/waypoint.db*` (needed so the admin-bootstrap
   rule — "first user ever registered becomes admin" — is deterministic;
   the directory was empty before this run, and every run leaves it empty
   again).
2. Starts `node server.js` on port 4100 as a child process and waits for
   `GET /api/health`.
3. Runs, in order: `backend-contract.test.js`, then
   `integration-mismatches.test.js`, then `static-assets.test.js`.
4. Kills the server and removes `data/waypoint.db*` again.
5. Prints a PASS/FAIL line per test plus a final summary, and exits
   non-zero if anything failed.

Individual files can also be run directly against an already-running
server on port 4100 (`WAYPOINT_TEST_BASE_URL` overrides the base URL):
`node tests/backend-contract.test.js`, `node tests/integration-mismatches.test.js`,
`node tests/static-assets.test.js`.

No npm packages beyond what's already declared (`express`, which the test
files don't even use) were added. Node built-ins used: global `fetch`,
`node:sqlite` (only in one backend test, to fast-forward a session's
expiry — see below), `node:child_process`, `node:path`, `node:fs`.

## Result: everything the backend claims to do, it does

**64 / 64 tests passed. 0 failed.** The backend's real behavior matches
`API.md` exactly everywhere this suite checked. The frontend/backend
*integration*, however, is badly broken — see the mismatches section below,
which is the important part of this report.

### 1. Backend contract — `tests/backend-contract.test.js` — 33/33 PASS

| Area | Result |
|---|---|
| Registration: missing email, malformed email, password < 8 chars → `400 VALIDATION_ERROR` | PASS |
| First-ever registration → `role: "admin"` (bootstrap rule holds) | PASS |
| Second registration → `role: "user"` | PASS |
| Duplicate email (including case-insensitive match) → `409 CONFLICT` | PASS |
| Login with correct credentials → `200`, session cookie set | PASS |
| Login with wrong password → `401 INVALID_CREDENTIALS` | PASS |
| Login with unknown email → `401 INVALID_CREDENTIALS` (same code as wrong password, no leak) | PASS |
| Login missing fields → `400 VALIDATION_ERROR` | PASS |
| `GET /api/auth/me` with valid cookie → correct user | PASS |
| `GET /api/auth/me` with no cookie → `401 UNAUTHORIZED` | PASS |
| `GET /api/auth/me` with an unknown/garbage 64-hex token → `401 UNAUTHORIZED` | PASS |
| `POST /api/auth/logout` deletes the session server-side; the same cookie then gets `401` from `/api/auth/me` | PASS |
| `POST /api/auth/logout` with no session is a safe no-op | PASS |
| **Expired session is rejected and the row is deleted on next use** (see note below) | PASS |
| `POST /api/pins` creates a pin; response uses exactly the documented fields | PASS |
| Omitted `note` → `null` | PASS |
| Out-of-range latitude, missing `placeName`, bad `visitDate` format → `400 VALIDATION_ERROR` | PASS |
| `GET /api/pins` lists only the caller's own pins, newest `visitDate` first | PASS |
| `DELETE /api/pins/:id` removes own pin; re-list confirms it's gone | PASS |
| Delete nonexistent id → `404 NOT_FOUND`; non-numeric id → `400 VALIDATION_ERROR` | PASS |
| **User A cannot see User B's pin in `GET /api/pins`** | PASS |
| **User A cannot `DELETE` User B's pin → `404`, and re-listing as B confirms the pin still exists** | PASS |
| **Unauthenticated request rejected with `401` on every protected route** (`GET /api/auth/me`, `GET`/`POST /api/pins`, `DELETE /api/pins/:id`, `GET /api/admin/users`) | PASS |
| **Non-admin user requesting `GET /api/admin/users` → `403 FORBIDDEN`** | PASS |
| **Admin gets the full user list; response body contains none of "password", "hash", "salt", "scrypt"; every user row has exactly `id/email/role/createdAt`** | PASS |
| Unmatched `/api/*` path → JSON `404 NOT_FOUND` (not a static fallback) | PASS |
| `/api/index.html` (name collides with a real static file) → still a JSON `404`, never the static `index.html` | PASS |

Note on the expired-session test: `node:sqlite`'s `DatabaseSync` (a Node
built-in, same module the server itself uses) is opened directly against
`data/waypoint.db` to set one specific session row's `expires_at` into the
past, since waiting a real 7 days is impractical. This is the only place
any test touches the database file directly rather than going through the
HTTP API; it doesn't add any file outside `tests/`, and the row is deleted
by the server itself during the test (proving the "deleted on next use"
behavior), so nothing is left behind beyond what the full teardown already
removes.

### 2. Frontend/backend integration — `tests/integration-mismatches.test.js` — 9/9 PASS

Every test here *passing* means the mismatch was successfully proven
against the real server (i.e., the test suite correctly detected the
divergence). See the dedicated mismatches section below for the full,
itemized list with user-visible symptoms.

### 3. Static assets — `tests/static-assets.test.js` — 22/22 PASS

Every HTML page (`/`, `/index.html`, `/login.html`, `/register.html`,
`/admin.html`), the stylesheet, and every referenced JS file
(`api.js`, `auth.js`, `app.js`, `map.js`, `login.js`, `register.js`,
`admin.js`) return `200` with the correct content-type from the real
server on port 4100. Every JS file passes `node --check` (parses cleanly).
`assets/world.svg` loads, contains a valid `<svg>` root, and its
`viewBox="0 0 1000 500"` matches exactly what `map.js`'s
`lonLatToXY()`/`xyToLonLat()` assume.

---

## Frontend/backend integration mismatches (the important part)

The backend and frontend were built blind to each other and **do not
work together in a browser as shipped.** Every item below was proven with
a real HTTP call against the live server (see
`tests/integration-mismatches.test.js`, all 9 assertions pass, meaning
each divergence below was actually reproduced against port 4100 — not
just noted from reading the source).

### A. Auth mechanism: bearer token (assumed) vs. session cookie (real) — **app-breaking**

- **Frontend sends/expects:** `js/api.js` assumes the server returns
  `{ token, user }` on register/login, stores `token` in
  `localStorage['waypoint_token']`, and sends it back as
  `Authorization: Bearer <token>` on every request.
- **Server actually does:** returns `{ user: { id, email, role, createdAt } }`
  with **no `token` field at all**, and instead sets an `HttpOnly`
  `Set-Cookie: waypoint_session=...` cookie. Confirmed live: registering
  with the frontend's exact request shape returns `201` with a real
  `Set-Cookie` header but `response.body.token === undefined`.
- **User-visible symptom (proven):** `public/js/login.js`'s submit handler
  runs `if (!token || !user) throw new Error('Unexpected response from
  server.')`. Since `token` is always `undefined`, **every successful,
  correct-credentials login shows the error "Unexpected response from
  server."** in the UI. The login form can never succeed. `register.js`
  has a softer failure mode: since `token` is falsy it skips the
  `API.setSession` branch and instead redirects to
  `login.html?registered=1` — silently discarding the real session the
  server just created — sending the user right back into the broken login
  flow above.
- **Compounding symptom (proven):** because `API.setSession()` never
  stores a token, `API.getToken()` is permanently `null`. `Auth.requireAuth()`
  (used by `index.html` and `admin.html`) starts with
  `if (!token) { redirectToLogin(); return null; }` — so **every visit to
  a protected page bounces straight back to `login.html` without even
  attempting `GET /api/auth/me`**, even though the browser is silently
  holding a perfectly valid `waypoint_session` cookie the whole time.

### B. Pin field names: `name/lat/lng/date` (assumed) vs. `placeName/latitude/longitude/visitDate` (real) — **app-breaking**

- **Frontend sends:** `POST /api/pins` with body
  `{ name, lat, lng, date, note }` (see `API.createPin` in `api.js`, and
  the form fields in `index.html`/`app.js`).
- **Server expects:** `{ latitude, longitude, placeName, visitDate, note }`.
  Confirmed live: posting the frontend's exact payload shape returns
  `400 VALIDATION_ERROR` with message *"latitude must be a number between
  -90 and 90. longitude must be a number between -180 and 180. placeName
  is required and must be 1-200 characters. visitDate is required and
  must be in YYYY-MM-DD format."* — every one of the four coordinate/name/date
  fields is rejected as missing, because the server never sees them under
  those names.
- **User-visible symptom (proven):** clicking "Add pin" always fails,
  every time, regardless of what the user enters.
- **Second-order symptom (proven):** even a pin that *does* exist in the
  database (created directly with the correct backend field names) is
  unreadable by the frontend's own rendering code. `app.js`'s
  `renderPinList()` reads `pin.name`, `pin.lat`, `pin.lng`, `pin.date` —
  all `undefined` on a real pin object. Reproducing that exact rendering
  logic against a real `GET /api/pins` response yields **"Unnamed place"**
  for the name and **"NaN, NaN"** for the coordinates (from
  `Number(pin.lat).toFixed(3)`).

### C. Error response shape: `{error: "message"}` (assumed) vs. `{error: {code, message}}` (real) — **loses detail, degrades gracefully**

- **Frontend expects:** `extractErrorMessage()` in `api.js` treats
  `body.error` as a string.
- **Server actually sends:** `{ error: { code: "VALIDATION_ERROR",
  message: "..." } }` — `error` is an object, not a string.
- **User-visible symptom (proven):** `typeof body.error === 'string'` is
  `false`, so `extractErrorMessage()` falls through all its shape checks
  and returns the generic fallback. E.g., a real `400` for a weak
  password (whose real message is *"Password must be at least 8
  characters long."*) is shown to the user as the generic **"Request
  failed (400)"**. This doesn't crash the UI (the frontend's defensive
  fallback does its job), but every validation error the user sees is
  uninformative boilerplate instead of the specific, correct message the
  server actually produced.

### D. Admin-detection flag: `isAdmin: boolean` (assumed) vs. `role: "admin"|"user"` (real) — **would work in isolation, but is unreachable**

- **Frontend expects:** a boolean `isAdmin` field, with a documented
  fallback to a `role` string (`Auth.isAdmin()` in `auth.js` checks
  `role.toLowerCase() === 'admin'`).
- **Server actually sends:** only `role: "admin" | "user"`, never
  `isAdmin`.
- **Result (proven):** the fallback logic itself is correct —
  `frontendIsAdmin({ role: 'admin' })` does return `true` when tested in
  isolation. However, because of mismatch A, `Auth.requireAuth()` never
  gets far enough to call `GET /api/auth/me` in a real browser session, so
  this code path is never actually exercised end-to-end. In effect: the
  admin flag detection is not itself broken, but it's dead code given
  everything upstream of it.

### E. Missing `name` field on users everywhere — **cosmetic**

- **Frontend expects/renders:** register form collects `name`; header
  ("Signed in as …") and the admin table both render `user.name`.
- **Server:** has no `name` column at all — `POST /api/auth/register`
  silently ignores the `name` field the frontend sends (per `API.md`,
  "fields not listed are ignored"), and no endpoint ever returns one.
  Confirmed live: a real `GET /api/auth/me` user object has no `name`
  key.
- **User-visible symptom:** if the auth flow were otherwise fixed, the
  header would fall back to showing the email instead of a name (handled
  gracefully by `user.name || user.email`), and the admin table's Name
  column would always show "—" (`escapeHtml(u.name || '—')`). Not a
  crash, just a missing feature the backend has no data for.

### What is *not* broken

- **Base URL / same-origin routing:** both sides agree on `/api/*` on the
  same origin; no CORS issue.
- **Route paths themselves** (`/api/auth/register`, `/api/auth/login`,
  `/api/auth/logout`, `/api/auth/me`, `/api/pins`, `/api/pins/:id`,
  `/api/admin/users`) match exactly on both sides — only the payload
  shapes and auth transport diverge, not the URLs.
- **Response envelope keys** for lists (`{ pins: [...] }`,
  `{ users: [...] }`) — the frontend's defensive "accept either a bare
  array or a `{ pins: [...] }`/`{ users: [...] }` wrapper" logic happens
  to match the real server's wrapped shape.
- **The static file layer itself:** every page/script/stylesheet/image
  the frontend references loads correctly and parses; `/api/*` is never
  shadowed by `express.static`, in either direction.

### Net effect

Taken together (A) and (B) make the application **non-functional through
the browser as shipped**: a user cannot sign in (A) and, even hypothetically
bypassing that, cannot create a pin that renders correctly (B). This is a
genuine defect in the frontend/backend integration, not a backend defect —
per `API.md`, the backend behaves exactly as documented in every case this
suite checked. Per instructions, none of this was fixed; it is reported
here as-is.

## Files

- `round-2/tests/lib/testkit.js` — shared HTTP client + minimal test
  runner (Node built-ins only).
- `round-2/tests/backend-contract.test.js` — backend contract test suite
  (33 tests).
- `round-2/tests/integration-mismatches.test.js` — frontend/backend
  mismatch proofs against the live server (9 tests).
- `round-2/tests/static-assets.test.js` — static file/page/asset checks
  (22 tests).
- `round-2/tests/run-all.js` — orchestrator: starts the server, runs all
  three suites in the required order, tears down, cleans `data/`.

No files outside `round-2/tests/` and this report were created or
modified. `round-2/data/` is empty after the run, exactly as it was
found.
