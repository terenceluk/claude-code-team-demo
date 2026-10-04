# Waypoint

Waypoint is a personal travel map portal. A signed-in user drops pins on a
map for places they've visited, each with a name, coordinates, a visit
date, and an optional note; a user only ever sees their own pins. The
first account ever registered automatically becomes an administrator, and
an administrator can list every registered user.

## Status: backend works and is verified; the app does not work end to end in a browser

This project was built by a backend agent and a frontend agent working in
parallel with no communication between them. The result:

- **The backend (`server.js`, `src/`) is complete, runs, and is verified
  against its own documented contract** by an automated test suite
  (64/64 tests passing — see [Testing](#testing) below for exactly what
  that number does and does not mean).
- **The frontend (`public/`) is a complete set of pages and scripts**, but
  it was written against *guessed* API request/response shapes
  (`public/FRONTEND-ASSUMPTIONS.md`) because the real contract wasn't
  available while it was being built. Those guesses do not match the real
  backend.
- **Net effect: as shipped, you cannot actually use Waypoint through the
  browser.** Every sign-in attempt fails, and pin creation is rejected,
  for the reasons below.

### Why sign-in fails

The frontend (`public/js/api.js`) assumes login/register return
`{ token, user }` and expects to send that token back as an
`Authorization: Bearer <token>` header. The real server never returns a
`token` — it returns `{ user }` and sets an `HttpOnly` session cookie
(`waypoint_session`) instead. Because the frontend's login handler treats
a missing token as an unexpected response, **every login attempt shows
"Unexpected response from server," even with correct credentials**, and
protected pages (`index.html`, `admin.html`) redirect straight back to the
login page without even checking whether the browser already holds a
valid session cookie.

### Why pin creation fails

The frontend sends `POST /api/pins` as
`{ name, lat, lng, date, note }`. The server requires
`{ placeName, latitude, longitude, visitDate, note }`. Every "Add pin"
submission is rejected with `400 VALIDATION_ERROR` because the server
never sees any of the four required fields under the names it expects.

### What it would take to fix this

Per the security review (`SECURITY-REVIEW.md`, finding 6), the correct
direction is to **change the frontend, not the server**:

- Delete the `localStorage`/bearer-token code in `public/js/api.js` and
  have `fetch()` calls rely on the browser's same-origin cookie handling
  (or explicit `credentials: 'include'`) instead of an `Authorization`
  header.
- Rename the pin fields the frontend sends/reads to match the server's
  contract (`placeName`, `latitude`, `longitude`, `visitDate`).
- Update `extractErrorMessage()` in `api.js` to read
  `body.error.message` (an object), not `body.error` (a string).

The security review specifically recommends **against** making the server
also return a bearer token in the JSON body — doing so would put a
session secret into script-readable storage, reopening exactly the kind
of XSS-to-session-theft risk the current `HttpOnly`-cookie design avoids.
See [Known limitations](#known-limitations) and
[Security](#security-summary) below for the full list of mismatches and
findings; none of this has been fixed in `round-2` as of this writing —
it is reported here as-is, per the constraint that this round only
documents what was built.

## Stack

- **Node.js + Express 4** — `express` is the **only** third-party npm
  dependency (`package.json`), in both production and dev.
- **CommonJS** modules (`"type": "commonjs"`).
- **`node:sqlite`** (Node's built-in SQLite module, via `DatabaseSync`) —
  no external database, no ORM.
- **`node:crypto`** (`scrypt` for password hashing, `randomBytes` for
  session tokens) — no external auth/crypto library.
- Plain HTML/CSS/vanilla JS for the browser UI — no frontend framework or
  build step.
- Node **>= 22.5.0** is required (`package.json` `engines`); `node:sqlite`
  is an experimental Node feature, so you'll see a one-time
  `ExperimentalWarning: SQLite is an experimental feature` on server
  startup — this is expected and harmless.

## Project layout

```
round-2/
  server.js                    # Express app entry point: wires middleware, mounts
                                # /api routes, serves public/ as static files, starts
                                # the HTTP listener on PORT (default 4100)
  package.json                 # "express" is the only dependency; npm start -> node server.js
  src/
    db.js                      # node:sqlite setup; creates data/waypoint.db and its
                                # tables (users, sessions, pins) on first run
    authUtils.js                # scrypt password hashing/verification, session token
                                # generation, session cookie serialization
    errors.js                   # sendError() helper -> the { error: { code, message } } shape
    middleware.js                # resolveSession (reads the session cookie on every
                                # request), requireAuth, requireAdmin
    routes/
      auth.js                   # POST /api/auth/register, /login, /logout, GET /api/auth/me
      pins.js                   # GET/POST /api/pins, DELETE /api/pins/:id
      admin.js                  # GET /api/admin/users (admin-only)
  data/                         # created automatically on first run; holds waypoint.db
                                # (SQLite file) -- not served statically, not committed
  public/                       # the browser UI, built independently against guessed
                                # API assumptions (see FRONTEND-ASSUMPTIONS.md)
    index.html                  # map + "my pins" page (protected, client-side gated)
    login.html / register.html  # auth forms
    admin.html                  # admin-only user list page (client-side gated)
    css/styles.css
    js/
      api.js                   # all fetch() calls to the backend; the bearer-token
                                # and pin-field-name assumptions live here
      auth.js                  # requireAuth()/isAdmin() helpers used by the pages
      app.js                   # index.html page logic: renders pin list, add/delete pin
      map.js                   # renders assets/world.svg and converts pins to map dots
      login.js / register.js   # form submit handlers for the two auth pages
      admin.js                 # admin.html page logic: renders the user table
    assets/world.svg            # static world map background used by map.js
    FRONTEND-ASSUMPTIONS.md     # the frontend agent's own record of every API guess
                                 # it made, written before the real backend was seen
  tests/
    run-all.js                  # orchestrator: wipes data/, starts the server, runs
                                 # all three suites below in order, tears down, cleans data/
    backend-contract.test.js    # 33 tests against the real backend contract
    integration-mismatches.test.js  # 9 tests proving the frontend/backend mismatches
    static-assets.test.js       # 22 tests that every page/script/asset is served correctly
    lib/testkit.js               # shared minimal HTTP test client/runner (no extra deps)
  API.md                        # authoritative backend API contract (read this for exact
                                 # request/response shapes, not this README)
  TEST-REPORT.md                # full test results and the itemized mismatch list
  SECURITY-REVIEW.md            # security audit findings
```

## Setup and running locally

```
cd round-2
npm install
npm start
```

- The server listens on **port 4100** by default
  (`http://localhost:4100`). Override with the `PORT` environment
  variable, e.g. `PORT=5000 npm start` (PowerShell:
  `$env:PORT=5000; npm start`).
- The SQLite database is created automatically on first run at
  `round-2/data/waypoint.db` (the `data/` directory is created if it
  doesn't exist yet) — no separate migration or seed step is needed.
- The same Express app serves both the JSON API (everything under
  `/api/*`) and the static UI files in `public/` on the same origin and
  port, so there's nothing extra to run for the frontend.

Because of the mismatches described above, opening
`http://localhost:4100` in a browser and trying to register, sign in, or
add a pin through the UI **will not work as of this writing** — see
[Status](#status-backend-works-and-is-verified-the-app-does-not-work-end-to-end-in-a-browser)
above. The backend API itself is fully usable with a raw HTTP client (curl,
Postman, the test suite, etc.) that follows `API.md` — see
[API surface](#api-surface) below for how to exercise it directly,
including how to register the first account by hand.

### Registering the first account (and how it becomes admin)

There is no separate admin-promotion endpoint, seed script, or
environment variable. The rule is purely: **the very first user row ever
inserted (`id = 1`) is automatically given `role: "admin"` at the moment
of registration**; every account registered after that gets `role:
"user"`. This is enforced entirely server-side in
`POST /api/auth/register` by counting existing users, not by anything the
client sends.

Since the UI's own registration flow doesn't currently complete (see
Status above), you can still create the first (admin) account directly
against the API, e.g. with curl:

```
curl -i -X POST http://localhost:4100/api/auth/register \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"you@example.com\",\"password\":\"at-least-8-chars\"}"
```

The response body is `{ "user": { "id": 1, "email": "...", "role":
"admin", "createdAt": "..." } }` and the response also carries a
`Set-Cookie: waypoint_session=...` header — capture that cookie and resend
it as a `Cookie` header on subsequent requests (e.g. `curl -b`) to act as
that signed-in admin, since there is no bearer token to copy.

### Resetting who the admin is

To make a different account become the first (admin) account again,
stop the server and delete the database file(s):

```
del round-2\data\waypoint.db*
```

The next registration after that will once again become `id = 1` /
`role: "admin"`. This wipes **all** existing users and pins — there is no
selective reset.

## Testing

```
cd round-2
node tests/run-all.js
```

This wipes any existing `data/waypoint.db*`, starts `node server.js` on
port 4100 as a child process, runs all three suites below in order, then
tears the server down and removes `data/waypoint.db*` again, leaving the
repository exactly as it found it. It exits non-zero if anything fails.
Individual suites can also be pointed at an already-running server via
`WAYPOINT_TEST_BASE_URL` and run directly, e.g.
`node tests/backend-contract.test.js`.

**Result: 64/64 tests pass**, but it's important to be precise about what
that proves:

- **`backend-contract.test.js` (33/33)** exercises the real backend in
  isolation (registration/login validation, the admin-bootstrap rule,
  session expiry/logout, per-user pin scoping, cross-user delete
  protection, admin-only enforcement, and more) and confirms it matches
  `API.md` exactly. This is the part that shows the server itself is
  solid.
- **`integration-mismatches.test.js` (9/9)** does **not** demonstrate a
  working app. Every one of these 9 tests passing means the test
  successfully *proved a documented frontend/backend mismatch* against
  the live server (e.g., posting the frontend's exact request shape and
  confirming the server rejects it, or confirming the server's real
  response has no `token` field). A "pass" here is evidence the divergence
  is real, not evidence anything works end to end.
- **`static-assets.test.js` (22/22)** confirms every HTML page, JS file,
  the stylesheet, and the SVG map asset are served correctly and that
  every JS file parses (`node --check`) — i.e., the frontend is a
  well-formed static bundle, independent of whether its API calls
  succeed.

So "64/64 passed" means "the backend does exactly what it claims, and the
frontend's mismatches with it are exactly as documented" — not "the
application works." See `TEST-REPORT.md` for the full itemized list of
mismatches with their proven user-visible symptoms.

## API surface

`API.md` at the repository root of `round-2` is the authoritative,
complete contract (routes, request/response bodies, the session-cookie
auth mechanism, the admin bootstrap rule, and the `{ error: { code,
message } }` error shape) — this README intentionally does not duplicate
it. In short, the routes are:

- `GET /api/health` — unauthenticated health check.
- `POST /api/auth/register`, `POST /api/auth/login`,
  `POST /api/auth/logout`, `GET /api/auth/me` — session-cookie-based auth.
- `GET /api/pins`, `POST /api/pins`, `DELETE /api/pins/:id` — a user's own
  pins only.
- `GET /api/admin/users` — admin-only, lists every registered user.

Every request/response body is JSON. Authentication is an opaque,
server-side session token delivered via an `HttpOnly`, `SameSite=Lax`
cookie named `waypoint_session` (7-day expiry) — there is no
`Authorization` header and no bearer token anywhere in the real contract.

## Security summary

Full detail is in `SECURITY-REVIEW.md` (scope: `server.js`, `src/**`,
`public/**` in `round-2`). Summary judgment from that review: the backend
is implemented carefully and correctly on nearly every axis audited; the
frontend/backend integration break described above is a functional bug,
not a security hole.

**Confirmed weaknesses:**

- **No rate limiting or lockout on login (Medium).** `POST
  /api/auth/login` has no per-IP or per-account attempt throttling, so an
  attacker with network access can attempt unlimited password guesses
  against any known email.
- **Timing side-channel on login leaks account existence (Low/Medium).**
  The expensive `scrypt` password check only runs when the email exists,
  so an unknown email returns faster than a known one with a wrong
  password — even though the response body/status are identical and
  correctly avoid enumeration in content.

Also noted, at lower severity: a duplicate-email `409 CONFLICT` on
registration is an accepted, documented trade-off, not a defect; the
session cookie is not marked `Secure` (explicitly reasonable for
plain-HTTP localhost use, but would need fixing before any non-localhost
deployment); and there are no security response headers such as CSP or
`X-Content-Type-Options` (defense-in-depth gap, not an active hole given
the app's otherwise well-mitigated XSS surface).

**Notable controls verified as correctly implemented:** `scrypt` password
hashing with a fresh random salt per password and `crypto.timingSafeEqual`
for hash comparison; 256-bit random, opaque session tokens; session
expiry enforced server-side on every request; logout actually revokes the
session row server-side; every pin query is scoped to the caller's own
`user_id` server-side (never trusting a client-supplied id); admin
enforcement (`requireAdmin`) is server-side and derived from the
session-resolved user, not any client input, with no self-assignable
admin role or promotion endpoint anywhere; all SQL uses parameterized
`db.prepare(...)` statements (no string-concatenated queries); pin/date
input validation (range checks, `YYYY-MM-DD` format, length bounds); all
user-supplied strings rendered into HTML are escaped before interpolation;
no CORS grant (same-origin only); `SameSite=Lax` plus the absence of CORS
gives reasonable CSRF protection for state-changing routes; the SQLite
database file is not reachable through `express.static`; and no secrets
or hardcoded credentials exist anywhere in the tree.

One latent finding worth calling out given the fix direction above: the
frontend's dormant `localStorage` bearer-token code is currently harmless
(the server never returns a token, so nothing readable by script is ever
stored there), but the review explicitly recommends fixing the
integration by adjusting the frontend to use the existing `HttpOnly`
cookie rather than adding a token to the server's response — doing the
latter would make the session token readable by any injected or
third-party script.

## Known limitations

- **The application does not work end to end in a browser as shipped.**
  Sign-in fails on every attempt and pin creation is always rejected, for
  the reasons detailed under [Status](#status-backend-works-and-is-verified-the-app-does-not-work-end-to-end-in-a-browser)
  above. This is the primary limitation of this round.
- Even setting the auth mismatch aside, the frontend's own rendering code
  (`renderPinList()` in `public/js/app.js`) reads pin fields (`pin.name`,
  `pin.lat`, `pin.lng`, `pin.date`) that don't exist on a real pin object
  from the server, so a correctly-created pin would still render as
  "Unnamed place" at "NaN, NaN" in the current UI.
- The frontend's error-message display degrades to a generic "Request
  failed (`<status>`)" for every server validation error, because it
  expects `error` to be a string and the real server sends
  `{ error: { code, message } }`. It falls back gracefully rather than
  crashing, but the specific, correct error message from the server is
  never shown.
- The register form collects and displays a user "name"; the backend has
  no `name` field at all (only `id`/`email`/`role`/`createdAt`), so even
  once the auth flow is fixed, the UI would need to fall back to showing
  the email and an admin table "Name" column would have nothing to show.
- No rate limiting on login and a login timing side-channel exist as
  documented in [Security summary](#security-summary) above; both are
  out of scope to fix in this round.
- No password reset / email verification / account recovery flow exists
  anywhere in the API or UI.
- The session cookie is not marked `Secure`, which is fine for the
  plain-HTTP localhost usage this was built for but would need to change
  before deploying anywhere else.
- There is no way to change or revoke another account's role; the only
  admin-bootstrap mechanism is "first user ever registered," and the only
  way to get a different admin is to wipe `data/waypoint.db*` and
  re-register.
