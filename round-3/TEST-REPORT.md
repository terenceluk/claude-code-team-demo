# Waypoint Test Report

**Result: PASS (after a fix)** — 76 of 76 automated tests pass as of the
current code. This report intentionally documents both rounds of testing so
the outcome isn't misread as "clean from the start": the first run
(task #3) found a real defect in date validation and reported **FAIL**;
backend fixed it (task #6); this is the independent re-verification
(task #7) confirming the fix is correct, complete on both the create and
update paths, and did not over-correct into rejecting valid input.

Run with `npm test` (`node --test tests/*.test.js`). All tests boot a fresh,
isolated copy of the app in a scratch temp directory with its own SQLite
file — `db/waypoint.sqlite` (the shared dev database) is never opened or
modified by this suite. See "How this was run" below for why a copy was
necessary and how cleanup is verified.

## Summary

| Round | Total tests | Passed | Failed |
|---|---|---|---|
| Task #3 (initial) | 64 | 63 | 1 |
| Task #7 (re-verify, after backend's fix) | 76 | 76 | 0 |

12 tests were added in the re-verification round specifically to cover the
fixed bug's class thoroughly (see "Validation" section below); nothing was
removed or weakened to make the earlier failure disappear.

## Results by area

### Auth (`tests/auth.test.js`) — 15/15 PASS

| Test | Result |
|---|---|
| register succeeds with valid email/password | PASS |
| duplicate email rejected (409) | PASS |
| duplicate email rejected case-insensitively | PASS |
| malformed email rejected (400) | PASS |
| missing password rejected (400) | PASS |
| weak/short password rejected (400) | PASS |
| register cannot self-assign role admin (explicit `role:"admin"` in body ignored) | PASS |
| login with correct credentials returns a token | PASS |
| login with wrong password rejected (401) | PASS |
| login with unknown email rejected (401) | PASS |
| wrong-password vs unknown-email login errors are indistinguishable | PASS |
| password never present in register response | PASS |
| password never present in login response | PASS |
| password never present in GET /api/auth/me response | PASS |
| stored password is a bcrypt hash, not plaintext (verified directly against the scratch DB file) | PASS |

### Pin ownership — the core authorization boundary (`tests/pins-ownership.test.js`) — 15/15 PASS

| Test | Result |
|---|---|
| user A creates pins; GET /api/pins as A returns exactly A's pins | PASS |
| GET /api/pins as B does not include any of A's pins | PASS |
| pin responses never include `user_id` | PASS |
| B cannot read A's pin by id → 404, `{"error":"Pin not found"}` | PASS |
| B cannot update A's pin (PUT) → 404; A's pin verified unchanged afterward | PASS |
| B cannot update A's pin (PATCH) → 404; A's pin verified unchanged afterward | PASS |
| B cannot delete A's pin → 404; pin verified to still exist afterward | PASS |
| POST /api/pins with a forged `user_id` in the body → pin created and owned by the caller (verified in caller's list, absent from forged-owner's list, and confirmed directly in the `pins` table) | PASS |
| unauthenticated request → 401 on all 9 protected routes (pins CRUD, /auth/me, /auth/logout, /admin/users) | PASS |
| garbage token (not a JWT) → 401 | PASS |
| tampered token (mutated payload segment) → 401 | PASS |
| expired token (`exp` in the past) → 401 | PASS |
| token signed with the wrong secret (forged `role:"admin"`) → 401 | PASS |

### Logout / server-side token revocation (`tests/logout-revocation.test.js`) — 4/4 PASS

Re-tested independently per instructions, not taken on the backend's word:

| Test | Result |
|---|---|
| token works before logout, then the *same* token → 401 on /auth/me immediately after POST /api/auth/logout | PASS |
| revoked token is also rejected on a *different* route (/api/pins), not just /me | PASS |
| logging out one session's token leaves that same user's *other* logged-in session token fully valid (no over-broad, user-wide revoke) | PASS |
| logging out one user's token does not revoke a *different* user's token | PASS |
| logout itself requires auth (401 without a token) | PASS |

Conclusion: the `jti` denylist behaves exactly as documented — a targeted,
per-token revocation, not a client-side-only discard and not an accidental
"log out everywhere" or cross-user leak.

### Admin boundary (`tests/admin.test.js`) — 5/5 PASS

(Admin account only exists via `npm run seed`, run against this test's own
scratch DB — the API correctly offers no way to create one.)

| Test | Result |
|---|---|
| admin can list every registered user | PASS |
| normal (non-admin) user calling admin endpoint → 403 | PASS |
| unauthenticated caller → 401 (not 403) | PASS |
| admin listing contains no password hashes / plaintext passwords | PASS |
| forged admin claim without a validly-signed token still yields 403 | PASS |

### Validation (`tests/validation.test.js`) — 30/30 PASS (was 17/18 PASS, 1 FAIL before the fix)

| Test | Result |
|---|---|
| latitude > 90 rejected | PASS |
| latitude < -90 rejected | PASS |
| longitude > 180 rejected | PASS |
| longitude < -180 rejected | PASS |
| boundary values -90/90, -180/180 accepted | PASS |
| malformed date string rejected | PASS |
| date in wrong format (`01/01/2024`) rejected | PASS |
| over-long place_name (>200 chars) rejected | PASS |
| place_name at exactly 200 chars accepted | PASS |
| empty place_name rejected | PASS |
| missing place_name rejected | PASS |
| over-long note (>2000 chars) rejected | PASS |
| note at exactly 2000 chars accepted | PASS |
| note omitted → defaults to null | PASS |
| note explicitly null → accepted | PASS |
| PATCH partial update only validates fields present in the body | PASS |
| PATCH with an invalid field among partial fields rejected | PASS |
| `2024-02-30` rejected on **create** | PASS *(originally FAIL — see "Found → fixed" below)* |
| `2024-02-30` rejected on **PUT** update | PASS *(new in re-verification)* |
| `2024-02-30` rejected on **PATCH** update | PASS *(new in re-verification)* |
| `2024-04-31` rejected on create / PUT / PATCH (3 tests) | PASS *(new — same rollover class)* |
| `2023-02-29` rejected on create / PUT / PATCH (3 tests, not a leap year) | PASS *(new — same rollover class)* |
| leap-year `2024-02-29` still **accepted** on create | PASS *(new — over-correction check)* |
| leap-year `2024-02-29` still **accepted** on PATCH update | PASS *(new — over-correction check)* |
| out-of-range month `2024-13-01` still rejected | PASS *(new — confirms the fix didn't regress the case that already worked)* |
| all-zero date `0000-00-00` (matches shape, not a real date) rejected | PASS *(new — edge case explicitly requested)* |

#### Found → fixed: invalid calendar dates were silently accepted (task #3 → task #6 → task #7)

**Originally found (task #3), reported as FAIL:**
- **Expected:** Per `API.md` ("`visited_on`: required, string, `YYYY-MM-DD`,
  must be a real calendar date"), `POST /api/pins` with `visited_on:
  "2024-02-30"` (February has no 30th day) should return `400`.
- **Actual (before the fix):** Returned `201 Created`. The pin was stored
  with `visited_on` exactly as submitted (`"2024-02-30"`), an impossible
  date.
- **Root cause:** `routes/pins.js:50` (as it was) relied on
  `Number.isNaN(Date.parse(raw))` to catch impossible dates, but
  JavaScript's `Date.parse` silently **rolls over** out-of-range
  day-of-month values instead of failing (`Date.parse('2024-02-30')` →
  `2024-03-01T00:00:00.000Z`, not `NaN`). Same rollover class:
  `2024-04-31`, `2023-02-29`.

**Fix (task #6), verified structurally and behaviorally in this
re-verification:** `routes/pins.js` now has `isRealCalendarDate(raw)` at
lines 20-24, round-tripping the parsed `y/m/d` through `Date.UTC` and
confirming nothing rolled over, called from the shared `validatePinInput`
validator at line 62. That validator is used by `POST` (line 92) and by
`updatePin` (line 131), which backs both `PUT` (line 152) and `PATCH`
(line 153) — one shared implementation, not a create-only patch.

**Re-verification results (task #7):**
- `2024-02-30`, `2024-04-31`, `2023-02-29` (the exact rollover class
  reported) are now rejected with `400` on **create, PUT, and PATCH** — 9
  tests, all PASS.
- The over-correction risk was checked explicitly and did **not**
  materialize: leap-year `2024-02-29` is still accepted (`201`/`200`) on
  both create and PATCH.
- `2024-13-01` (out-of-range month, always correctly rejected even before
  the fix, since `Date.parse` does return `NaN` for that case) is still
  rejected — confirms the new helper didn't regress a case that already
  worked.
- `0000-00-00` (matches the `YYYY-MM-DD` shape via regex but isn't a real
  date) is correctly rejected too.
- The rest of the suite — all 63 previously-passing tests across auth, pin
  ownership, logout revocation, admin boundary, XSS/note handling, and the
  frontend contract — was re-run in full and still passes. No regressions.

**Conclusion: the fix is correct and complete on both the create and update
paths, and does not over-correct into rejecting valid input.**

### XSS / note rendering (`tests/xss-note.test.js`) — 3/3 PASS, with a stated coverage gap

| Test | Result |
|---|---|
| `<script>` payload in `note` round-trips through the API unmangled (stored/returned faithfully, not stripped or escaped server-side) | PASS |
| HTML-injection payload in `place_name` round-trips through the API unmangled | PASS |
| Static check: `public/js/map.js` renders `pin.place_name` / `pin.note` via `.textContent`, never `.innerHTML`, for the popup fields | PASS |

**Coverage gap, stated plainly as instructed:** no browser-automation tool
(Playwright, Puppeteer, or similar) is available in this environment, so
actual DOM execution of an XSS payload in a live browser was **not**
verified end-to-end. What was verified is (a) the API stores/returns
attacker-controlled text unmodified — correct, since escaping is the
frontend's job, not the API's — and (b) static source inspection confirms
the popup-rendering code path in `map.js` uses `textContent` exclusively
for `pin.place_name` and `pin.note`. No `innerHTML` assignment involving a
pin field was found anywhere in `map.js`. This is strong supporting
evidence the frontend's claim holds, but it is not the same as observing a
real browser fail to execute the payload.

### Frontend contract check (`tests/frontend-contract.test.js`) — 6/6 PASS

| Test | Result |
|---|---|
| static app served at `/` (200, contains "Waypoint") | PASS |
| `css/styles.css`, `js/{api,app,map,auth,admin}.js`, `assets/world-map.svg` all served (200) | PASS |
| map is a bundled offline SVG — `assets/world-map.svg` is a real `<svg>` document; `map.js` contains no Leaflet or tile-service reference | PASS |
| no external (http/https) asset/resource URLs anywhere under `public/` (only the SVG XML namespace URI, which is not a network fetch, and a `data:` URI favicon) | PASS |
| `js/api.js` references every route and field name documented in `API.md` (`/api/auth/register`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`, `/api/pins`, `/api/admin/users`, `place_name`, `latitude`, `longitude`, `visited_on`, `note`) | PASS |
| unknown `/api/*` route returns a JSON `{"error": ...}` 404 | PASS |

Per instructions: this is a grep/HTTP-level contract check only, not browser
automation. No UI click-through coverage (form submission, popup
interaction, admin table rendering in a real DOM) is claimed.

## Known limitation (belongs in the README): no configurable database path

`db/connection.js` hardcodes its SQLite path as
`path.join(__dirname, 'waypoint.sqlite')`, with no environment variable or
config override. This is a genuine testability/operability limitation:
there is no way to point the server at a different database file (a
scratch DB for tests, a staging DB, etc.) without either editing the file
or running the code from a different directory. It did not block testing
— see "How this was run" for the workaround — but it means, for example,
you cannot run two instances of this app side by side against different
data without copying the whole tree, and any future test or ops tooling
will need to route around it the same way this suite did. Not fixed as
part of this round (out of scope for both the tester and the reported
defect); recommended follow-up for whoever next touches `db/connection.js`.

## How this was run

- Because of the limitation above, the only way to get a fresh, disposable
  database per the task's instructions ("boot against a scratch/temp
  database, not the dev one") without editing backend source was to run the
  server from an isolated **copy** of the app. `tests/support/testServer.js`
  copies `server.js`, `routes/`, `middleware/`, `public/`, `package.json`,
  and `db/{connection.js,schema.sql,seed.js}` into a fresh OS temp directory
  per test file (via `fs.mkdtempSync`), symlinks (junctions) `node_modules`
  in rather than copying it, and spawns `node server.js` from there on a
  dedicated port with `WAYPOINT_JWT_SECRET` set explicitly. Each test file
  gets its own scratch DB and its own port (4301–4307) so files can run
  without colliding.
- Verified directly, after both the task #3 and task #7 full runs: the real
  `round-3/db/waypoint.sqlite` dev database and `round-3/node_modules` were
  unmodified by this suite (the dev DB's row counts changed between the two
  runs only because other agents/manual verification against the shared dev
  server added rows in between — not because of anything this test suite
  did; this suite never opens that file).
- Every scratch temp directory (including the `node_modules` junction) is
  removed in an `after()` hook, whether or not the tests in that file
  passed. Verified empty after both runs.
- The admin account (needed for the admin-boundary tests) does not and
  should not exist via the API, so `tests/admin.test.js` runs the project's
  own `db/seed.js` against its scratch copy's database only — never against
  the dev database.

## Files

- `round-3/tests/support/testServer.js` — scratch-server harness (copy + symlink node_modules + spawn + readiness wait + cleanup)
- `round-3/tests/support/client.js` — thin fetch wrapper matching API.md
- `round-3/tests/auth.test.js`
- `round-3/tests/pins-ownership.test.js`
- `round-3/tests/logout-revocation.test.js`
- `round-3/tests/admin.test.js`
- `round-3/tests/validation.test.js`
- `round-3/tests/xss-note.test.js`
- `round-3/tests/frontend-contract.test.js`
- `round-3/package.json` — added `"test": "node --test tests/*.test.js"` (only edit made outside `tests/`)

No backend or frontend source file was modified by the tester at any point
in this round, including during re-verification.
