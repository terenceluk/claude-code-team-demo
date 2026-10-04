# Waypoint API

Server-side API for Waypoint, a personal travel map portal. This document
is the complete contract for the API. A frontend can be built entirely
from this file without reading any server source code.

## Stack

Node.js with Express, and Node's built-in `node:sqlite` module for
storage (no native compilation required, so it installs cleanly on a bare
Windows 11 machine). SQLite database file is created automatically on
first run. Passwords are hashed with `scrypt` (also built into Node's
`crypto` module, no extra dependency). The only third-party npm package
used is `express`.

## Running the server

```
cd round-1
npm install
npm start
```

The server listens on **http://localhost:4000** by default. Set the
`PORT` environment variable before `npm start` to use a different port.

On first run, a `round-1/data/waypoint.db` SQLite file is created
automatically along with all required tables — no manual setup step is
needed.

A `GET /health` route (outside the `/api` prefix, no auth) returns
`{"status":"ok"}` and can be used to confirm the server is up.

## Frontend static hosting

This server also serves the browser UI as static files, on the **same
origin and port as the API**. Frontend static assets (an `index.html`,
JS, CSS, images, etc.) belong in `round-1/public/`. Whatever is placed
there is served at `http://localhost:4000/` via `express.static` — for
example `round-1/public/index.html` is reachable at
`http://localhost:4000/` and `round-1/public/app.js` at
`http://localhost:4000/app.js`.

`/api/*` and `/health` are never shadowed by static files — those paths
are always handled by the JSON routes/handlers documented in this file,
regardless of what does or doesn't exist under `public/`.

Because the UI and the API share the same origin
(`http://localhost:4000`), a browser client can use plain same-origin
`fetch` calls with `credentials: 'same-origin'` (or simply omit the
`credentials` option, since same-origin requests send cookies by
default) to hit `/api/...` endpoints and receive/send the
`waypoint_session` cookie normally. **No CORS handling is required** by
a frontend built this way. (The CORS section below only matters if the
frontend is instead run from a separate dev-server origin/port, which
is not the expected setup.)

## Authentication model

Waypoint uses **server-side sessions delivered via an httpOnly cookie**.

- Cookie name: `waypoint_session`
- Cookie value: a random 64-character hex token (256 bits of entropy)
- Cookie attributes: `HttpOnly; Path=/; SameSite=Lax; Expires=<+7 days>`
  (no `Secure` attribute, because the server is expected to run over
  plain HTTP on localhost for this exercise)
- Expiry: sessions expire **7 days** after creation. The session is
  validated server-side on every request to a protected route; an
  expired or unknown token is treated as "not signed in" (`401`).
- The session token is **not** a JWT and carries no client-decodable
  data; it is an opaque lookup key into a `sessions` table.

### How a client authenticates

1. Call `POST /api/auth/register` or `POST /api/auth/login`. On success
   the response includes a `Set-Cookie: waypoint_session=...` header.
2. The client must send credentials/cookies on every subsequent request
   (e.g. `fetch(url, { credentials: 'include' })` or an HTTP client
   configured to persist cookies). There is no bearer-token header —
   the cookie **is** the credential.
3. `POST /api/auth/logout` destroys the session server-side and clears
   the cookie.
4. There is no CSRF token in this implementation. `SameSite=Lax` on the
   cookie provides baseline protection for a same-site frontend; if the
   frontend is hosted on a different origin/port during local dev, the
   server reflects the request's `Origin` header with
   `Access-Control-Allow-Credentials: true` so cross-origin
   `fetch`/`XHR` calls with `credentials: 'include'` will work.

### CORS (only relevant for a separate frontend origin)

The expected setup is the same-origin one described in "Frontend static
hosting" above, which needs no CORS handling at all. As a fallback, in
case the frontend is ever run from a separate dev-server origin/port
instead of `round-1/public/`, the server also allows any Origin,
reflecting it back with `Access-Control-Allow-Credentials: true`, so a
frontend dev server on a different port (e.g. `http://localhost:5173`)
can still call this API and have the session cookie set/sent correctly.
In that scenario, clients must use `credentials: 'include'` (fetch) or
equivalent instead of `credentials: 'same-origin'`.

## Admin bootstrap rule

**The very first account ever registered in the database automatically
becomes an administrator.** Every account registered after that is a
regular (non-admin) user. There is no environment variable or manual
promotion step.

This is deterministic based on the `users` table being empty at the
moment `POST /api/auth/register` runs. Practical implications:

- On a freshly created database (i.e. `round-1/data/waypoint.db` does
  not yet exist, or was deleted), the **first** successful call to
  `POST /api/auth/register` creates the admin account. To test the
  admin-only endpoint, register that account first, before any other
  registrations.
- If you need a fresh admin bootstrap after the database already has
  users, stop the server and delete `round-1/data/waypoint.db` (and any
  `waypoint.db-wal` / `waypoint.db-shm` files next to it), then restart
  with `npm start` and register again.
- There is exactly one admin bootstrap path — no env var overrides this
  behavior.

## Data model

### User (as returned by the API; password data is never exposed)

| field     | type    | notes                                  |
|-----------|---------|-----------------------------------------|
| id        | integer | primary key                             |
| email     | string  | unique, lowercased                      |
| isAdmin   | boolean | `true` only for the bootstrap admin (or any account granted admin at registration time per the rule above) |
| createdAt | string  | ISO 8601 timestamp                      |

### Pin

| field      | type            | notes                                              |
|------------|-----------------|-----------------------------------------------------|
| id         | integer         | primary key                                          |
| userId     | integer         | owner's user id (always the signed-in caller's id)   |
| latitude   | number          | -90..90                                              |
| longitude  | number          | -180..180                                            |
| placeName  | string          | non-empty                                            |
| visitDate  | string          | date string as submitted, e.g. `"2024-05-01"`        |
| note       | string \| null  | optional                                             |
| createdAt  | string          | ISO 8601 timestamp                                   |

## Error shape

All error responses share this shape:

```json
{ "error": { "code": "SOME_CODE", "message": "Human readable message." } }
```

Common codes: `VALIDATION_ERROR` (400), `INVALID_JSON` (400),
`UNAUTHENTICATED` (401), `INVALID_CREDENTIALS` (401), `FORBIDDEN` (403),
`NOT_FOUND` (404), `EMAIL_TAKEN` (409), `INTERNAL_ERROR` (500).

## Routes

All routes below except `/health` are prefixed with `/api`. All request
and response bodies are JSON (`Content-Type: application/json`).

---

### `GET /health`

No auth. Health check.

**Response `200`**
```json
{ "status": "ok" }
```

---

### `POST /api/auth/register`

Create a new account and sign in (sets the session cookie). The first
account ever created becomes an admin — see "Admin bootstrap rule" above.

**Request body**
```json
{ "email": "you@example.com", "password": "at-least-8-chars" }
```

**Response `201`** (also sets `Set-Cookie: waypoint_session=...`)
```json
{ "user": { "id": 1, "email": "you@example.com", "isAdmin": true, "createdAt": "2026-07-29T21:46:37.245Z" } }
```

**Errors**
- `400 VALIDATION_ERROR` — missing/invalid email, or password shorter than 8 characters
- `409 EMAIL_TAKEN` — an account with this email already exists

---

### `POST /api/auth/login`

**Request body**
```json
{ "email": "you@example.com", "password": "your-password" }
```

**Response `200`** (also sets `Set-Cookie: waypoint_session=...`)
```json
{ "user": { "id": 1, "email": "you@example.com", "isAdmin": true, "createdAt": "2026-07-29T21:46:37.245Z" } }
```

**Errors**
- `400 VALIDATION_ERROR` — missing email or password
- `401 INVALID_CREDENTIALS` — email not found or password incorrect

---

### `POST /api/auth/logout`

Destroys the current session (if any) and clears the cookie. No request
body. Always succeeds, even if the caller was not signed in or the
session had already expired.

**Response `200`**
```json
{ "message": "Logged out." }
```

---

### `GET /api/auth/me`

Returns the currently signed-in user. Requires a valid session cookie.

**Response `200`**
```json
{ "user": { "id": 1, "email": "you@example.com", "isAdmin": false, "createdAt": "2026-07-29T21:46:37.245Z" } }
```

**Errors**
- `401 UNAUTHENTICATED` — no/expired/invalid session cookie

---

### `POST /api/pins`

Create a pin owned by the signed-in user. Requires a valid session
cookie.

**Request body**
```json
{
  "latitude": 48.8566,
  "longitude": 2.3522,
  "placeName": "Paris",
  "visitDate": "2024-05-01",
  "note": "Eiffel Tower"
}
```
`note` is optional and may be omitted or `null`. `visitDate` accepts any
string `Date.parse` can understand (an ISO date like `"2024-05-01"` or a
full ISO datetime); the server stores and returns exactly what was sent.

**Response `201`**
```json
{
  "pin": {
    "id": 1,
    "userId": 1,
    "latitude": 48.8566,
    "longitude": 2.3522,
    "placeName": "Paris",
    "visitDate": "2024-05-01",
    "note": "Eiffel Tower",
    "createdAt": "2026-07-29T21:46:47.082Z"
  }
}
```

**Errors**
- `400 VALIDATION_ERROR` — latitude/longitude out of range or not a
  number, placeName empty, visitDate unparsable, or note not a string
- `401 UNAUTHENTICATED` — not signed in

---

### `GET /api/pins`

Lists pins belonging to the signed-in user only, newest first. Requires
a valid session cookie. **A user can never see another user's pins
through this endpoint, regardless of pin id.**

**Response `200`**
```json
{ "pins": [ { "id": 1, "userId": 1, "latitude": 48.8566, "longitude": 2.3522, "placeName": "Paris", "visitDate": "2024-05-01", "note": "Eiffel Tower", "createdAt": "2026-07-29T21:46:47.082Z" } ] }
```

**Errors**
- `401 UNAUTHENTICATED` — not signed in

---

### `DELETE /api/pins/:id`

Deletes a pin, but only if it is owned by the signed-in user. Requires a
valid session cookie. `:id` is the pin's integer id.

**Ownership enforcement:** if the pin does not exist, *or* it exists but
belongs to a different user, the response is an identical `404` in both
cases (so a client cannot use this endpoint to probe whether a given pin
id belongs to someone else).

**Response `200`**
```json
{ "message": "Pin deleted." }
```

**Errors**
- `400 VALIDATION_ERROR` — `:id` is not a positive integer
- `401 UNAUTHENTICATED` — not signed in
- `404 NOT_FOUND` — no such pin, or it belongs to another user

---

### `GET /api/admin/users`

Administrator-only. Lists every registered user (id, email, isAdmin,
createdAt — never password data). Requires a valid session cookie
**and** `isAdmin: true` for the signed-in user.

**Response `200`**
```json
{
  "users": [
    { "id": 1, "email": "terence.luk@gmail.com", "isAdmin": true, "createdAt": "2026-07-29T21:46:37.245Z" },
    { "id": 2, "email": "second@example.com", "isAdmin": false, "createdAt": "2026-07-29T21:46:37.355Z" }
  ]
}
```

**Errors**
- `401 UNAUTHENTICATED` — not signed in
- `403 FORBIDDEN` — signed in but not an admin

---

## Things intentionally left out of scope

- No password reset / email verification / "forgot password" flow (no
  email service is available in this environment).
- No pin editing (`PUT`/`PATCH`) — only create, list-own, and
  delete-own, per the task description.
- No pagination on `GET /api/pins` or `GET /api/admin/users` — expected
  data volumes for a personal travel map / single-machine demo are
  small.
- No rate limiting or account lockout on login attempts.
- No HTTPS/`Secure` cookie flag, since the server is meant to run over
  plain HTTP on localhost for this exercise.
- No CSRF token (mitigated only by `SameSite=Lax`); acceptable for a
  local, non-production demo.
