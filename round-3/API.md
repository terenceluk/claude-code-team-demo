# Waypoint API

## Stack

Node.js + Express, SQLite via `better-sqlite3` (file created on first run at
`db/waypoint.sqlite`), passwords hashed with `bcryptjs`, auth via a signed
JWT (`jsonwebtoken`). This combination was chosen because it needs nothing
beyond `npm install` on a bare Windows 11 laptop: no external database
server, no Docker, no API keys, no build step, and `better-sqlite3`'s
synchronous API keeps the route handlers simple and avoids a whole class of
async/await bugs in a small CRUD service like this. Everything lives in one
`.sqlite` file that's trivial to delete and regenerate via `npm run seed`.

## Running it

```
npm install
npm start        # serves on http://localhost:3000 (PORT env var to override)
npm run seed      # optional: creates demo accounts + pins, see below
```

The server creates `db/waypoint.sqlite` and applies the schema automatically
on first start — no manual migration step. `public/` is served as static
files at the site root (owned by the frontend agent).

## Authentication

Auth is a signed JWT, **not** a cookie session. After register or login you
get back a `token` string. Send it on every subsequent request as:

```
Authorization: Bearer <token>
```

There is no separate refresh flow. Tokens are valid for 7 days from
issuance. `POST /api/auth/logout` revokes the specific token used to call it
(server-side denylist keyed by the token's `jti`), so a signed-out token
stops working immediately even though it hasn't expired yet — the client
should still discard the token locally.

The signing secret is read from `process.env.WAYPOINT_JWT_SECRET`. If unset,
it falls back to a hardcoded **development-only** value
(`waypoint-dev-secret-do-not-use-in-production`, see `middleware/auth.js`) —
fine for this laptop demo, not for any real deployment.

Every route below except register and login requires this header. Missing
or invalid header -> `401 { "error": "..." }`. The admin route additionally
requires `role: "admin"` on the authenticated user -> otherwise
`403 { "error": "Admin access required" }`.

## Data shapes

**User** (as returned by the API; `password_hash` is never included):
```json
{ "id": 1, "email": "alice@waypoint.test", "role": "user", "created_at": "2026-07-20 10:00:00" }
```
Note that `register`/`login` responses return a **smaller** user object
(`id`, `email`, `role` only — no `created_at`); `GET /api/auth/me` returns
the full shape above including `created_at`. `role` is always `"user"` for
self-registered accounts; `"admin"` accounts exist only via seeding, never
via the API.

**Pin**:
```json
{
  "id": 5,
  "place_name": "Kyoto, Japan",
  "latitude": 35.0116,
  "longitude": 135.7681,
  "visited_on": "2024-04-02",
  "note": "Cherry blossoms.",
  "created_at": "2026-07-20 10:00:00"
}
```
`note` may be `null`. `user_id` is intentionally never included in pin
responses (it's implicit — you only ever see your own pins).

Field constraints, enforced server-side:
- `place_name`: required, non-empty string, trimmed, max 200 chars.
- `latitude`: required, number, `-90..90` inclusive.
- `longitude`: required, number, `-180..180` inclusive.
- `visited_on`: required, string, `YYYY-MM-DD`, must be a real calendar date.
- `note`: optional string, max 2000 chars, or `null`.
- `email` (register/login): required, must match a basic `x@y.z` shape.
- `password` (register): required, min 8 characters.

Validation failures return `400 { "error": "<human readable message>" }`
(multiple problems are joined with `; ` in one string).

## Routes

### `POST /api/auth/register`
Auth: none.
Request body:
```json
{ "email": "alice@waypoint.test", "password": "AlicePass123!" }
```
- `201` on success: `{ "token": "<jwt>", "user": { "id": 2, "email": "alice@waypoint.test", "role": "user" } }`
- `400` malformed email or password under 8 chars: `{ "error": "..." }`
- `409` email already registered: `{ "error": "An account with that email already exists" }`

Email is trimmed and lowercased before storage/comparison, so
`Alice@Foo.com` and `alice@foo.com` are the same account. The client cannot
set `role` — every self-registered account is `"user"`.

### `POST /api/auth/login`
Auth: none.
Request body:
```json
{ "email": "alice@waypoint.test", "password": "AlicePass123!" }
```
- `200`: `{ "token": "<jwt>", "user": { "id": 2, "email": "alice@waypoint.test", "role": "user" } }`
- `400` missing email/password field: `{ "error": "..." }`
- `401` wrong email or password (deliberately the same message for both, to
  avoid leaking which emails are registered): `{ "error": "Invalid email or password" }`

### `POST /api/auth/logout`
Auth: required.
No request body.
- `204` No Content on success (token is now revoked; discard it client-side too).
- `401` if the Authorization header is missing/invalid.

### `GET /api/auth/me`
Auth: required.
- `200`: `{ "user": { "id": 2, "email": "alice@waypoint.test", "role": "user", "created_at": "2026-07-20 10:00:00" } }`
- `401` if not authenticated.

### `GET /api/pins`
Auth: required. Returns only the caller's own pins.
- `200`: `{ "pins": [ Pin, Pin, ... ] }` (empty array if none), ordered by
  `visited_on` descending, then `id` descending.

### `POST /api/pins`
Auth: required. `user_id` is always taken from the token — the client
cannot set it (any `user_id` sent in the body is ignored).
Request body:
```json
{ "place_name": "Kyoto, Japan", "latitude": 35.0116, "longitude": 135.7681, "visited_on": "2024-04-02", "note": "optional, may be omitted or null" }
```
- `201`: `{ "pin": Pin }`
- `400` validation failure: `{ "error": "..." }`
- `401` if not authenticated.

### `GET /api/pins/:id`
Auth: required. Only returns a pin owned by the caller.
- `200`: `{ "pin": Pin }`
- `404` if the pin doesn't exist **or** belongs to another user — the two
  cases are indistinguishable on purpose so pin ids can't be enumerated:
  `{ "error": "Pin not found" }`
- `401` if not authenticated.

### `PUT /api/pins/:id` / `PATCH /api/pins/:id`
Auth: required. Own pins only. Both verbs behave identically here: a
partial update — send only the fields you want to change (full replacement
is not required). Same field constraints as `POST /api/pins`, applied only
to fields present in the body.
Request body (any subset of):
```json
{ "place_name": "...", "latitude": 1.0, "longitude": 2.0, "visited_on": "2024-01-01", "note": "..." }
```
- `200`: `{ "pin": Pin }` (full pin after update)
- `400` validation failure: `{ "error": "..." }`
- `404` pin not found or not owned by caller: `{ "error": "Pin not found" }`
- `401` if not authenticated.

### `DELETE /api/pins/:id`
Auth: required. Own pins only.
- `204` No Content on success.
- `404` pin not found or not owned by caller: `{ "error": "Pin not found" }`
- `401` if not authenticated.

### `GET /api/admin/users`
Auth: required, and the caller's `role` must be `admin`.
- `200`: `{ "users": [ { "id": 1, "email": "admin@waypoint.test", "role": "admin", "created_at": "...", "pin_count": 0 }, ... ] }`
  Ordered by `id` ascending. Never includes `password_hash`.
- `401` if not authenticated.
- `403` if authenticated but not an admin: `{ "error": "Admin access required" }`

## Errors, generally

Every error response is `{ "error": "<message>" }` with an appropriate
status code (`400`, `401`, `403`, `404`, `409`, or `500` for anything
unexpected/unhandled). There is no separate error-code field — match on
status code + message text if you need to branch client-side logic (e.g.
distinguishing "email taken" from "bad password" on register).

## Seeded accounts (`npm run seed`)

| role  | email                | password       | pins |
|-------|----------------------|----------------|------|
| admin | admin@waypoint.test  | AdminPass123!  | 0    |
| user  | alice@waypoint.test  | AlicePass123!  | 3    |
| user  | bob@waypoint.test    | BobPass123!    | 2    |

Seeding is idempotent — running it again won't duplicate users or pins.
