# Waypoint

Waypoint is a personal travel map portal. A signed-in user drops pins on a
world map for places they've visited, each with a visit date and an optional
note, and sees only their own pins. An administrator account can additionally
list every registered user and how many pins each one has.

## Stack

- **Backend:** Node.js + [Express](https://www.npmjs.com/package/express),
  [`better-sqlite3`](https://www.npmjs.com/package/better-sqlite3) (synchronous
  SQLite driver — no separate database server, no Docker), password hashing
  via [`bcryptjs`](https://www.npmjs.com/package/bcryptjs), auth via signed
  JWTs using [`jsonwebtoken`](https://www.npmjs.com/package/jsonwebtoken).
- **Frontend:** vanilla JavaScript (no framework, no build step). The map is
  a hand-rolled, bundled inline SVG world map (`public/assets/world-map.svg`,
  equirectangular projection) rendered and interacted with directly via the
  DOM/SVG APIs in `public/js/map.js` — there is **no Leaflet dependency and
  no tile service**; the whole app runs fully offline with no API keys.

## Prerequisites and setup

Requires Node.js. From `round-3/`, in PowerShell or any shell:

```
npm install
npm run seed
npm start
```

- `npm install` installs dependencies.
- `npm run seed` creates the demo accounts and pins described below (safe to
  run more than once — it's idempotent and won't duplicate rows).
- `npm start` starts the server. It creates `db/waypoint.sqlite` and applies
  the schema automatically on first run — no manual migration step.

The server listens on **http://localhost:3000** by default (override with
the `PORT` environment variable). Open that URL in a browser; the frontend
is served as static files from the same origin as the API.

## Seeded accounts (local development only)

`npm run seed` creates these accounts. **These credentials are for local
development only — do not reuse them, and do not run this seed against
anything but a throwaway local instance.**

| role  | email                | password       | pins |
|-------|----------------------|----------------|------|
| admin | admin@waypoint.test  | AdminPass123!  | 0    |
| user  | alice@waypoint.test  | AlicePass123!  | 3    |
| user  | bob@waypoint.test    | BobPass123!    | 2    |

## Using it

1. **Register** — open the app, click "Register", enter an email and a
   password (8+ characters). This immediately signs you in (registration
   returns a token, same as login) and takes you to the map view.
2. **Sign in** — with an existing account (e.g. one of the seeded accounts
   above), enter email/password on the sign-in screen.
3. **Add a pin** — click anywhere on the map, or use "+ Add pin" in the
   sidebar, then fill in a place name, a visit date, and an optional note in
   the modal and save. The date must be a real calendar date in
   `YYYY-MM-DD` form (impossible dates like February 30th are rejected).
4. **View your pins** — your pins appear both as markers on the map and as
   a list in the sidebar; clicking either opens a popup with the place,
   date, note, and Edit/Delete actions. You only ever see your own pins —
   there is no way to browse anyone else's.
5. **Sign out** — click "Sign out". This calls the logout endpoint, which
   revokes that specific token server-side (see "Security" below), then
   clears the token locally regardless of whether the network call
   succeeded.
6. **As an admin** (seeded `admin@waypoint.test` account only — there is no
   way to become an admin through the UI or API), you additionally see a
   "Users" link in the header leading to a table of every registered user:
   email, role, join date, and pin count.

## API reference

Full detail, request/response shapes, and field constraints are in
[`API.md`](API.md). Summary:

| Method | Path | Auth required | Purpose |
|---|---|---|---|
| POST | `/api/auth/register` | No | Create a new account (role is always `"user"`) |
| POST | `/api/auth/login` | No | Authenticate, receive a JWT |
| POST | `/api/auth/logout` | Yes | Revoke the caller's current token server-side |
| GET | `/api/auth/me` | Yes | Get the signed-in user's own profile |
| GET | `/api/pins` | Yes | List the caller's own pins |
| POST | `/api/pins` | Yes | Create a pin owned by the caller |
| GET | `/api/pins/:id` | Yes | Get one of the caller's own pins (404 if it doesn't exist or belongs to someone else) |
| PUT | `/api/pins/:id` | Yes | Update (partial or full) one of the caller's own pins |
| PATCH | `/api/pins/:id` | Yes | Same as PUT — both verbs behave identically as a partial update |
| DELETE | `/api/pins/:id` | Yes | Delete one of the caller's own pins |
| GET | `/api/admin/users` | Yes, and caller's role must be `admin` | List every registered user with pin counts |

## Project layout

```
round-3/
├── server.js               Express app entry point: wires routes, static files, error handler
├── package.json             npm scripts (start/seed/test) and dependencies
├── API.md                    backend's API contract
├── TEST-REPORT.md             test run history and results
├── SECURITY-REVIEW.md          security audit findings
├── db/
│   ├── connection.js            opens/creates db/waypoint.sqlite, applies schema.sql
│   ├── schema.sql                 users / pins / revoked_tokens table definitions
│   └── seed.js                     `npm run seed`: creates demo admin/alice/bob accounts + pins
├── middleware/
│   └── auth.js                      JWT verification, revocation check, admin-role gate
├── routes/
│   ├── auth.js                       register / login / logout / me
│   ├── pins.js                        pin CRUD, ownership enforcement, calendar-date validation
│   └── admin.js                        GET /api/admin/users
├── public/                              static frontend, served at the site root
│   ├── index.html                        single-page shell (sign-in/register/map/admin views)
│   ├── css/styles.css                     styling
│   ├── js/
│   │   ├── api.js                          fetch wrapper, token storage in localStorage
│   │   ├── auth.js                          current-user state, sign-out
│   │   ├── map.js                            SVG world map, projection, markers, popups
│   │   ├── admin.js                           users table rendering
│   │   └── app.js                              view routing, form wiring, orchestration
│   └── assets/world-map.svg                     bundled offline world map (no CDN, no tiles)
└── tests/                                 automated test suite (see "Testing" below)
    ├── support/
    │   ├── testServer.js                        scratch-copy server harness for isolated runs
    │   └── client.js                              thin fetch wrapper for tests
    ├── auth.test.js
    ├── pins-ownership.test.js
    ├── logout-revocation.test.js
    ├── admin.test.js
    ├── validation.test.js
    ├── xss-note.test.js
    └── frontend-contract.test.js
```

## Testing

Run the suite with:

```
npm test
```

This runs `node --test tests/*.test.js`. Each test file boots its own
isolated, scratch copy of the app in a temp directory against its own
throwaway SQLite database — the real `db/waypoint.sqlite` dev database is
never opened or modified by the suite.

**Current status: 76 of 76 automated tests pass.** Full detail is in
[`TEST-REPORT.md`](TEST-REPORT.md), which is worth reading rather than
skipping, because the honest history matters: the first test run found a
real defect — impossible calendar dates such as `2024-02-30` were silently
accepted (rolled over to March 1st by `Date.parse`) instead of rejected —
and reported it as a failure. That was fixed in `routes/pins.js` (a
round-trip check through `Date.UTC` — see `isRealCalendarDate` at
`routes/pins.js:20-24`), and a follow-up test run added 12 new tests
specifically targeting that class of bug (rollover dates, non-leap-year
Feb 29, month-13, etc.) and re-ran the entire suite, confirming the fix and
no regressions. Coverage includes auth, the pin-ownership authorization
boundary, token revocation on logout, the admin boundary, field validation,
and an API/static-analysis-level XSS check.

**Coverage gap, stated plainly:** no browser-automation tool (Playwright,
Puppeteer, etc.) was available for this round. The frontend is covered by
an HTTP-contract check (right files/routes/fields exist and are wired
correctly) and by static source inspection (e.g. confirming `map.js` only
ever uses `textContent` to render pin data, never `innerHTML`), not by
driving a real browser. The XSS conclusion rests on that combination —
strong supporting evidence, not the same as observing a live DOM fail to
execute a payload.

## Security

Summary of [`SECURITY-REVIEW.md`](SECURITY-REVIEW.md) (with one fix applied
after the review — noted below).

**Verdict:** No Critical or High severity issues. The core authorization
boundary — every pin route scoped to the caller's own verified user ID, the
admin check enforced in server middleware rather than only hiding a UI
button, cross-user pin access genuinely withheld rather than merely masked
— holds up under direct source inspection. Password storage, SQL
parameterization, JWT signature/expiry enforcement, and DOM rendering
(no XSS sink found anywhere, including the bundled SVG) all check out.

**Findings by severity:** Critical 0, High 0, Medium 2 (1 open, 1 fixed),
Low 2, Info 3.

| ID | Severity | Title | Status |
|----|----------|-------|--------|
| F1 | Medium | JWT stored in `localStorage`, not an httpOnly cookie | Open — accepted tradeoff (see Known limitations) |
| F2 | Medium | No startup warning when the JWT secret falls back to the hardcoded dev value | **Fixed** — `middleware/auth.js:8-16` now logs a warning at boot when `WAYPOINT_JWT_SECRET` is unset |
| F3 | Low | JWT algorithm not explicitly pinned in `jwt.verify()` | Open — deliberate, reasoned (see Known limitations) |
| F4 | Low | No rate limiting or lockout on `/api/auth/login` | Open |
| F5 | Info | Registration reveals whether an email is already registered (login does not) | Open — standard tradeoff |
| F6 | Info | Revoked-token cleanup happens only opportunistically, at the next logout call | Open — bounded by the 7-day token TTL either way |

**Set `WAYPOINT_JWT_SECRET` in the environment for anything beyond a local
throwaway instance.** If unset, the server signs and verifies tokens with a
hardcoded, publicly-visible development secret and now logs a boot-time
warning saying so; setting the variable to any value silences the warning.

### Notable design choices worth knowing about

- **Logout is a real server-side revocation**, not a client-side token
  discard: `POST /api/auth/logout` adds the token's `jti` to a denylist, so
  that exact token stops working immediately even before it expires. It
  does not touch the user's other active sessions/tokens (verified by both
  the tester and the security reviewer).
- **Cross-user pin access returns `404`, not `403`**, on purpose, so that a
  logged-in attacker can't use the status code to enumerate which pin IDs
  exist and belong to someone else.
- **The app has no external network dependencies at runtime**: the world
  map is the bundled `public/assets/world-map.svg`, not a tile service or
  CDN asset.

### Known limitations

- **F1 (Medium, open):** the JWT is stored in `localStorage` rather than an
  httpOnly cookie, so any future XSS vulnerability would expose it — no such
  vulnerability exists today (verified independently by the tester and the
  security reviewer), but this is a defense-in-depth gap rather than an
  actively closed one.
- **F3 (Low, open):** `jwt.verify()` is called without an explicit
  `algorithms` allowlist. This is safe today: `jsonwebtoken` defaults to the
  HS family of algorithms for a symmetric string secret and refuses
  unsigned (`alg: none`) tokens — confirmed by reading the library source.
  This was a deliberate decision, not an oversight. The condition that would
  change that: if an asymmetric signing key or a second signing algorithm
  is ever introduced, relying on the library default stops being optional
  and an explicit `{ algorithms: ['HS256'] }` should be added.
- **F4 (Low, open):** there is no rate limiting or account lockout on
  login. bcrypt at cost factor 12 slows down brute-force attempts but does
  not block them.
- **F5 / F6 (Info, open):** registration reveals whether an email is
  already registered (`409`); the revocation denylist is pruned only
  opportunistically (at the next logout call), bounded by the 7-day token
  TTL regardless.
- **Role changes would not take effect until token expiry or logout**
  (Info; flagged in the team lead's addendum to the security review, not
  by the reviewer's own audit). `req.user.role` is populated from the JWT
  payload for the token's full 7-day life rather than re-read from the
  database per request. This is **not reachable today** — no route exists
  that changes a user's role, and admin accounts exist only via
  `npm run seed` — but it becomes a real privilege-retention bug the moment
  a role-change feature is added.
- **No configurable database path:** `db/connection.js` hardcodes
  `db/waypoint.sqlite` with no environment override. This forced the test
  suite to run against scratch copies of the whole app rather than pointing
  the real server at a temporary database, and it means you can't run two
  instances of this app side by side against different data without
  copying the tree.
- **No end-to-end browser testing:** see "Testing" above — the frontend is
  verified at the HTTP-contract and static-analysis level, not by driving
  an actual browser.
- **No pan or zoom on the map:** the whole world is always visible at a
  fixed projection. This is a deliberate scope decision, not a bug.
- **`better-sqlite3` is pinned to an exact version** (`13.0.2`) rather than
  a version range, because the default range had no prebuilt binary
  available for this Node version on a machine without MSVC build tools.
- There is no password-reset flow, no email verification, and no way to
  change your own email/password or delete your account through the API or
  UI.
