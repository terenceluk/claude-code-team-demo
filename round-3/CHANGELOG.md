# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.1.0] - 2026-07-29

### Added

- Backend API (Node.js + Express + `better-sqlite3`): registration, login,
  logout with real server-side token revocation (`jti` denylist), and
  `GET /api/auth/me`. JWT-based auth via `jsonwebtoken`, passwords hashed
  with `bcryptjs` at cost factor 12.
- Full pin CRUD (`GET/POST /api/pins`, `GET/PUT/PATCH/DELETE /api/pins/:id`)
  scoped strictly to the authenticated caller's own `user_id`; cross-user
  access returns `404` rather than `403` to prevent pin-id enumeration.
- Admin endpoint `GET /api/admin/users` listing every registered user with
  pin counts, gated by a server-side `role === 'admin'` check independent
  of any frontend UI hiding.
- Frontend single-page interface (vanilla JS, no framework/build step):
  sign-in/register forms, a bundled offline SVG world map
  (`public/assets/world-map.svg`) with click-to-add-pin, marker popups with
  edit/delete, a pin sidebar, and an admin users table — no tile service,
  no CDN, no API keys required.
- Automated test suite (`npm test`, `node --test tests/*.test.js`) covering
  auth, the pin-ownership authorization boundary, logout token revocation,
  the admin boundary, field validation, and an API/static-analysis-level
  XSS check. Each test file runs against its own isolated scratch copy of
  the app and database. **Result: 76 of 76 tests pass.**
- Seed script (`npm run seed`) creating one admin and two demo user
  accounts with sample pins, for local development only.

### Fixed

- Impossible calendar dates (e.g. `2024-02-30`, `2024-04-31`) were
  silently accepted by `POST /api/pins` and rolled forward to the next
  valid date, because the original validation relied on `Date.parse`,
  which rolls over out-of-range day-of-month values instead of rejecting
  them. Found by the initial test run, fixed in `routes/pins.js` with an
  explicit `Date.UTC` round-trip check (`isRealCalendarDate`) applied to
  both the create and update (`PUT`/`PATCH`) paths, and confirmed by a
  follow-up test run (12 new tests added for this bug class; no
  regressions across the rest of the suite).
- Added a startup warning (`middleware/auth.js`) logged when
  `WAYPOINT_JWT_SECRET` is not set in the environment, so that running on
  the hardcoded development-only JWT secret is no longer silent.

### Security

- Full audit performed (see `SECURITY-REVIEW.md`). Verdict: no Critical or
  High severity findings; the pin-ownership and admin-role authorization
  boundaries hold up under direct source inspection, and no XSS sink was
  found anywhere in the frontend. 2 Medium findings (JWT in `localStorage`
  rather than an httpOnly cookie, accepted as a tradeoff; missing
  boot-time warning for the dev JWT secret fallback, since fixed), 2 Low
  findings (JWT algorithm not explicitly pinned in `jwt.verify()`, safe
  today by library default; no login rate limiting), and Info-level notes
  on registration email enumeration, opportunistic denylist pruning, and
  role being trusted from the JWT for its full 7-day life rather than
  re-checked per request. See `README.md` "Security" and "Known
  limitations" for full detail on what remains open and why.
