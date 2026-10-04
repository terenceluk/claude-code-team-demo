# Waypoint API Contract

This document is the complete, self-contained contract for the Waypoint
server. A client (browser UI, script, or test suite) can be built entirely
from this file without reading the server source.

## Stack

- **Node.js with Express 4** (`express` is the only third-party npm
  dependency, in production and dev — no others).
- **CommonJS** modules (`"type": "commonjs"` in `package.json`).
- **`node:sqlite`** (Node's built-in SQLite module, via `DatabaseSync`) for
  storage. The database file is created automatically on first run at
  `round-2/data/waypoint.db` (the `data/` directory is created if missing).
  You will see a one-time `ExperimentalWarning: SQLite is an experimental
  feature` on startup — this is expected on Node 24 and harmless.
- **`node:crypto`'s `scrypt`** for password hashing. Passwords are never
  stored or returned in plaintext, and no endpoint ever returns password
  hash data.
- No external services, no cloud dependencies, no API keys.

This stack was chosen because it satisfies the fixed constraint list exactly
(Express 4 + `node:sqlite` + `node:crypto`, zero extra dependencies) while
still giving a conventional, easy-to-consume JSON REST API: Express's
built-in `express.json()` body parser and `express.static()` cover request
parsing and UI-file serving without needing `body-parser` or `cookie-parser`,
so session cookies are parsed and set by a small amount of hand-written code
in `src/authUtils.js` rather than an additional package.

## Running the server

```
cd round-2
npm install
npm start
```

The server listens on port **4100** by default. Override with the `PORT`
environment variable, e.g. `PORT=5000 npm start`.

The Express app serves the JSON API described below **and** the static
browser UI from `round-2/public/` on the same origin/port. Every API route
lives under the `/api` prefix; any request under `/api/*` that doesn't match
a defined route returns a JSON 404 (it never falls through to static file
serving), so static assets can never shadow API paths.

## Authentication mechanism

Waypoint uses **opaque server-side session tokens delivered via an
HTTP-only cookie** (a classic server-session model, not JWT).

- **Cookie name:** `waypoint_session`
- **Cookie value:** a random 64-character lowercase hex string (32 random
  bytes from `crypto.randomBytes`), used as an opaque lookup key into a
  `sessions` table. It carries no embedded data — the server looks up the
  associated user on every request.
- **Cookie attributes:** `Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`
  (604800 seconds = 7 days). Not marked `Secure` because the server is
  expected to run over plain HTTP on localhost for this exercise.
- **Expiry:** sessions expire 7 days after creation (`sessions.expires_at`).
  An expired session is deleted on next use and treated as "not signed in".
- **How a client authenticates:** browsers do this automatically — set
  `credentials: 'include'` (or rely on same-origin default) on `fetch`
  calls so the browser sends the `waypoint_session` cookie automatically
  once it has been set by `/api/auth/register` or `/api/auth/login`. There
  is no `Authorization` header and no token to manage manually. Non-browser
  clients (e.g. curl, test scripts) must capture the `Set-Cookie` header
  from register/login and resend it as a `Cookie` header on subsequent
  requests.
- **Sign-out:** `POST /api/auth/logout` deletes the session server-side and
  responds with a `Set-Cookie` header that clears the cookie
  (`Max-Age=0`).
- A request with no cookie, an unknown token, or an expired token is treated
  as **not authenticated** (`401 UNAUTHORIZED`) for any route that requires
  sign-in.

## How an account becomes an administrator

**Bootstrap rule:** the very first account ever registered (i.e. the user
row with `id = 1`) is automatically granted the `admin` role at the moment
of registration. Every account registered after that defaults to the
`user` role. There is no separate promotion endpoint and no environment
variable to configure this — it is purely "first registrant is the admin".
If you need a fresh admin, delete `round-2/data/waypoint.db*` and register
again (this wipes all data).

## Data model

### User

| Field       | Type                  | Notes                                     |
|-------------|-----------------------|--------------------------------------------|
| `id`        | integer                | Auto-incrementing primary key             |
| `email`     | string                 | Unique, lowercased, trimmed on write      |
| `role`      | `"user"` \| `"admin"`  | See bootstrap rule above                  |
| `createdAt` | string (ISO 8601 UTC)  | Set at registration                       |

Password data (`password_hash`, an internal `scrypt` salt+hash string) is
stored server-side only and is **never** included in any API response.

### Pin

| Field       | Type              | Notes                                                |
|-------------|-------------------|-------------------------------------------------------|
| `id`        | integer            | Auto-incrementing primary key                        |
| `latitude`  | number             | Range -90 to 90                                       |
| `longitude` | number             | Range -180 to 180                                     |
| `placeName` | string             | 1-200 characters, required                            |
| `visitDate` | string             | Required, format `YYYY-MM-DD`                         |
| `note`      | string \| null     | Optional, up to 2000 characters; `null` if omitted    |
| `createdAt` | string (ISO 8601 UTC) | Set when the pin is created                        |

Every pin belongs to exactly one user (`user_id`, not exposed in
responses). A user can only ever see, list, or delete pins they created.

## Error shape

All error responses share this JSON shape, with an HTTP status code that
matches the situation:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable description of what went wrong."
  }
}
```

Error codes used across the API:

| Code                  | HTTP status | Meaning                                                  |
|------------------------|:-----------:|-----------------------------------------------------------|
| `VALIDATION_ERROR`     | 400         | Request body/params failed validation, or malformed JSON  |
| `UNAUTHORIZED`         | 401         | Not signed in (missing/invalid/expired session)           |
| `INVALID_CREDENTIALS`  | 401         | Email/password combination did not match on login         |
| `FORBIDDEN`            | 403         | Signed in, but lacks permission (e.g. non-admin)           |
| `NOT_FOUND`            | 404         | Resource doesn't exist, or doesn't belong to the caller    |
| `CONFLICT`             | 409         | Duplicate email on registration                            |
| `INTERNAL_ERROR`       | 500         | Unexpected server error                                    |

Note: for `DELETE /api/pins/:id`, a pin that exists but belongs to a
*different* user returns the same `404 NOT_FOUND` as a pin that doesn't
exist at all — this is intentional, to avoid leaking whether another user's
pin ID is in use.

## Routes

All request/response bodies are JSON (`Content-Type: application/json`).
Fields not listed are ignored; missing/invalid required fields produce a
`400 VALIDATION_ERROR`.

---

### `GET /api/health`

Unauthenticated health check.

**Auth:** none required.

**Response `200`:**
```json
{ "status": "ok", "service": "waypoint-api", "time": "2026-07-29T12:00:00.000Z" }
```

---

### `POST /api/auth/register`

Create a new account and sign the caller in immediately (sets the session
cookie on success).

**Auth:** none required.

**Request body:**
```json
{ "email": "alice@example.com", "password": "at-least-8-chars" }
```
- `email`: string, must look like an email address. Stored lowercased and
  trimmed.
- `password`: string, minimum 8 characters.

**Response `201`** (also sets `Set-Cookie: waypoint_session=...`):
```json
{ "user": { "id": 1, "email": "alice@example.com", "role": "admin", "createdAt": "2026-07-29T12:00:00.000Z" } }
```

**Errors:** `400 VALIDATION_ERROR` (bad email/password), `409 CONFLICT`
(email already registered).

---

### `POST /api/auth/login`

Sign in to an existing account.

**Auth:** none required.

**Request body:**
```json
{ "email": "alice@example.com", "password": "at-least-8-chars" }
```

**Response `200`** (also sets `Set-Cookie: waypoint_session=...`):
```json
{ "user": { "id": 1, "email": "alice@example.com", "role": "admin", "createdAt": "2026-07-29T12:00:00.000Z" } }
```

**Errors:** `400 VALIDATION_ERROR` (missing fields), `401
INVALID_CREDENTIALS` (unknown email or wrong password — the same error is
used for both, to avoid leaking which emails are registered).

---

### `POST /api/auth/logout`

Sign out. Deletes the current session server-side (if any) and clears the
cookie. Safe to call even if not currently signed in.

**Auth:** none required (no-op if no valid session cookie is present).

**Response `200`** (also sets `Set-Cookie` clearing `waypoint_session`):
```json
{ "ok": true }
```

---

### `GET /api/auth/me`

Return the currently signed-in user.

**Auth:** required (valid session cookie).

**Response `200`:**
```json
{ "user": { "id": 1, "email": "alice@example.com", "role": "admin", "createdAt": "2026-07-29T12:00:00.000Z" } }
```

**Errors:** `401 UNAUTHORIZED` (not signed in / expired session).

---

### `GET /api/pins`

List the signed-in user's own pins, newest visit first
(`visitDate` descending, then `id` descending).

**Auth:** required.

**Response `200`:**
```json
{
  "pins": [
    {
      "id": 3,
      "latitude": 40.7128,
      "longitude": -74.006,
      "placeName": "New York",
      "visitDate": "2023-11-20",
      "note": "Broadway show",
      "createdAt": "2026-07-29T12:00:01.000Z"
    }
  ]
}
```

**Errors:** `401 UNAUTHORIZED`.

---

### `POST /api/pins`

Create a new pin owned by the signed-in user.

**Auth:** required.

**Request body:**
```json
{
  "latitude": 48.8566,
  "longitude": 2.3522,
  "placeName": "Paris",
  "visitDate": "2024-05-01",
  "note": "Louvre visit"
}
```
- `latitude`: number, -90 to 90, required.
- `longitude`: number, -180 to 180, required.
- `placeName`: string, 1-200 characters, required.
- `visitDate`: string, format `YYYY-MM-DD`, required.
- `note`: string, up to 2000 characters, optional (omit or send `null`).

**Response `201`:**
```json
{
  "pin": {
    "id": 1,
    "latitude": 48.8566,
    "longitude": 2.3522,
    "placeName": "Paris",
    "visitDate": "2024-05-01",
    "note": "Louvre visit",
    "createdAt": "2026-07-29T12:00:00.500Z"
  }
}
```

**Errors:** `400 VALIDATION_ERROR`, `401 UNAUTHORIZED`.

---

### `DELETE /api/pins/:id`

Delete a pin. Only succeeds if the pin belongs to the signed-in user.

**Auth:** required.

**Path params:** `id` — positive integer pin id.

**Response `200`:**
```json
{ "ok": true, "id": 1 }
```

**Errors:** `400 VALIDATION_ERROR` (non-numeric id), `401 UNAUTHORIZED`,
`404 NOT_FOUND` (pin doesn't exist, or belongs to a different user — both
cases are indistinguishable by design).

---

### `GET /api/admin/users`

List every registered user. Administrator only.

**Auth:** required, and the signed-in user's `role` must be `"admin"`.

**Response `200`:**
```json
{
  "users": [
    { "id": 1, "email": "alice@example.com", "role": "admin", "createdAt": "2026-07-29T12:00:00.000Z" },
    { "id": 2, "email": "bob@example.com", "role": "user", "createdAt": "2026-07-29T12:00:05.000Z" }
  ]
}
```

**Errors:** `401 UNAUTHORIZED` (not signed in), `403 FORBIDDEN` (signed in
but not an admin).

---

## Verified behavior

The following were exercised against a running instance during
development and confirmed to work as documented:

- Registering the first-ever user grants `role: "admin"`; subsequent
  registrations get `role: "user"`.
- Duplicate-email registration returns `409 CONFLICT`; weak passwords
  return `400 VALIDATION_ERROR`.
- Login with a wrong password returns `401 INVALID_CREDENTIALS`.
- A signed-in user can create pins and list only their own pins.
- One user attempting to `DELETE` another user's pin id receives
  `404 NOT_FOUND` and the pin is **not** deleted (verified by re-listing
  the owner's pins afterward).
- An unauthenticated request to create a pin or to `GET /api/admin/users`
  returns `401 UNAUTHORIZED`.
- A non-admin signed-in user requesting `GET /api/admin/users` receives
  `403 FORBIDDEN`.
- An admin user requesting `GET /api/admin/users` receives the full user
  list with no password data present.
- `POST /api/auth/logout` invalidates the session immediately — a
  subsequent `GET /api/auth/me` with the same (now-cleared) cookie returns
  `401 UNAUTHORIZED`.
- Unmatched `/api/*` paths return a JSON `404 NOT_FOUND`, confirming static
  file serving never shadows the API surface.
