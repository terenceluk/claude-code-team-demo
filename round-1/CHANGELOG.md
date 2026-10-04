# Changelog

All notable changes to Waypoint are recorded here. This project has no
prior git history to draw on, so this changelog begins with the initial
build as it exists in the repository today.

## [0.1.0] - 2026-07-29

Initial build of Waypoint: a personal travel map portal, backend and
frontend, built, tested, and security-reviewed.

### Added

- Express server (`server.js`) serving both the JSON API (`/api/*`,
  `/health`) and the static frontend (`public/`) on a single origin/port,
  defaulting to `http://localhost:4000` (`PORT` env var overrides it).
- SQLite storage via Node's built-in `node:sqlite` module (`src/db.js`) —
  no native compilation and no external database server required.
  Database file is created automatically at `round-1/data/waypoint.db` on
  first run, with `users`, `sessions`, and `pins` tables.
- Email/password authentication (`src/auth.js`, `src/routes/auth.js`):
  registration, login, logout, and "who am I" (`/api/auth/me`), backed by
  server-side sessions delivered via an `httpOnly`, `SameSite=Lax` cookie
  (`waypoint_session`), 7-day expiry, validated against the database on
  every request. Passwords are hashed with `scrypt` (Node's built-in
  `crypto` module) with a random per-user salt.
- Admin bootstrap rule: the first account ever registered against an
  empty `users` table automatically becomes an administrator; every
  subsequent registration is a normal user. No other path to admin
  exists.
- Pin routes (`src/routes/pins.js`): create, list-own, and delete-own.
  Every route scopes to the signed-in user's own pins in SQL; deleting a
  pin that belongs to someone else (or doesn't exist) returns an
  identical `404` in both cases.
- Admin route (`src/routes/admin.js`): `GET /api/admin/users`, listing
  every registered user's id/email/admin flag/created date. Requires a
  valid session and `isAdmin: true` read from the database.
- Auth/role middleware (`src/middleware/requireAuth.js`,
  `src/middleware/requireAdmin.js`) applied to all protected routes.
- Vanilla-JS, build-step-free frontend (`public/index.html`, `app.js`,
  `styles.css`, `world.svg`): sign-in and registration screens, a
  clickable world map for placing pins (lat/lon computed from click
  position), a pin list with remove buttons, and an admin screen listing
  users. All user-supplied text is rendered via `textContent`, never
  `innerHTML`.
- Self-contained backend test suite (`tests/run.js`) that spawns its own
  server on port 4917, runs its checks, and deletes the database file it
  created afterward.
- API contract documentation (`API.md`) describing every route, the
  admin bootstrap rule, the session/cookie model, and known scope
  exclusions.

### Verified

- `node tests/run.js`: 53/53 tests passed, exit code 0. Covers
  registration, valid/invalid sign-in, pin create/delete, rejection of
  tampered and expired sessions, cross-user pin isolation, and a
  non-admin user receiving `403` from the admin endpoint.
- Confirmed at runtime that the server binds to all network interfaces
  (`::`), not just localhost, since `app.listen(PORT)` is called with no
  host argument.
- Frontend verified via static-asset content-type checks and
  source-level review of `app.js` only; no browser-driver test exists,
  so actual in-browser DOM/CSS behaviour is unverified.

### Known limitations (from security review)

- Server listens on all interfaces, not just localhost — reachable by
  anyone on the same network, which also means someone else could race
  to register the first (admin) account or brute-force a password.
- No rate limiting or account lockout on sign-in.
- No CSRF tokens; currently relies solely on `SameSite=Lax`, weakened by
  CORS middleware that reflects any `Origin` with
  `Access-Control-Allow-Credentials: true` and no allowlist.
- No HTTPS and no `Secure` cookie flag.
- scrypt uses Node's default cost parameters rather than explicitly
  tuned ones.
- Registration's `409 EMAIL_TAKEN` response allows email enumeration
  (sign-in's `401` does not have this problem).
- Not implemented: password reset, email verification, pin editing, and
  pagination.

See `README.md` for full details and usage instructions, and `API.md`
for the complete API contract.
