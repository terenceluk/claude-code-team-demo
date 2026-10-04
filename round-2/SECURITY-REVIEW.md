# Waypoint Security Audit — `round-2`

Scope: all server code (`server.js`, `src/**`) and browser code (`public/**`) under `round-2`. `round-1` and `round-3` were not read. The application was not run; every finding below is stated as either "confirmed by reading code" or "inference — needs runtime verification."

## Summary judgment

The backend (`server.js`, `src/*`) is implemented carefully and correctly on nearly every axis audited: password hashing, session token entropy, per-user data scoping, admin enforcement, parameterized SQL, and cookie flags are all done right. The known frontend/backend integration break (documented in `API.md` / `TEST-REPORT.md` / `public/FRONTEND-ASSUMPTIONS.md`) is real but is a functional bug, not a security hole, given how the mismatch actually resolves — the one place it has latent security relevance is flagged below (finding 6).

The two genuine, confirmed weaknesses are: **no brute-force protection on login**, and **a timing side-channel that leaks account existence on login** despite the response body itself being enumeration-safe.

---

## Confirmed findings

### 1. No rate limiting / lockout on login — Medium

**File:** `src/routes/auth.js`, `POST /login` (lines 85–100); `server.js` has no throttling middleware anywhere.

There is no per-IP or per-account attempt counter, delay, or lockout on `/api/auth/login`. Combined with `scrypt` (deliberately slow, but not slow enough to stop a distributed brute force at typical web request rates), an attacker with network access can attempt unlimited password guesses against any known email. Confirmed by reading the route — no limiter dependency is declared in `package.json`, and no in-memory/DB attempt tracking exists in `auth.js` or `middleware.js`.

**Fix:** add per-IP and per-account rate limiting in front of `/api/auth/login` (fixed-window or token-bucket), or at minimum exponential backoff keyed on email+IP.

### 2. Timing side-channel on login reveals account existence — Low/Medium

**File:** `src/routes/auth.js`, lines 92–97:

```js
const userRow = getUserByEmailStmt.get(normalizedEmail);
if (!userRow || !verifyPassword(password, userRow.password_hash)) {
  return sendError(res, 401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
}
```

`verifyPassword` (which calls `crypto.scryptSync`, a deliberately expensive KDF) is only invoked when `userRow` exists. For an unknown email the function returns almost immediately; for a known email it takes the full scrypt cost (tens of milliseconds). The response body and status code are identical in both cases — correctly designed to avoid enumeration, and explicitly called out as intentional in `API.md` — but the response *latency* differs measurably, letting an attacker enumerate registered emails by timing. Confirmed by reading the code; actual latency was not measured at runtime, so how cleanly the signal separates from network jitter is an inference.

**Fix:** always perform a dummy scrypt computation against a fixed/random salt when the user does not exist, so the path takes constant time regardless of account existence.

### 3. Registration's `409 CONFLICT` on duplicate email — Informational (accepted trade-off)

**File:** `src/routes/auth.js`, lines 60–63. Registering with an already-used email returns a distinct `409 CONFLICT`, confirming an account exists. This is standard, expected UX for registration and is documented in `API.md`. Not a defect — noted only for completeness.

### 4. Cookie missing `Secure` flag — Informational for this demo, High in production

**File:** `src/authUtils.js`, lines 55–63 (`serializeSessionCookie` / `serializeClearCookie`). The cookie is `Path=/; HttpOnly; SameSite=Lax` but not `Secure`. This is explicitly and reasonably documented in `API.md` as acceptable for plain HTTP on localhost. Deployed anywhere other than localhost, the missing flag would let the session cookie ride an accidental plaintext HTTP request and be sniffed. A deployment-configuration risk, not a current app-logic vulnerability.

### 5. No security response headers (CSP, X-Content-Type-Options, etc.) — Informational

**File:** `server.js`. `app.disable('x-powered-by')` is done, which is good, but there is no `helmet`-equivalent hardening (no `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options`/`frame-ancestors`). Given the XSS surface is already well-mitigated, this is defense-in-depth rather than an active hole.

### 6. Frontend's dormant `localStorage` bearer-token path — Informational / latent

**File:** `public/js/api.js`, lines 27–28, 57–78. The frontend was built against a wrong assumption (bearer token in `localStorage`) and the real backend never returns a `token` field (confirmed: handlers respond with `{ user: {...} }` only — `src/routes/auth.js` lines 45, 81, 99). Today `localStorage.getItem('waypoint_token')` is always empty and no session secret reaches script-readable storage. Confirmed by reading both the client code and the exact server response shape, not by trusting `TEST-REPORT.md`.

Flagged because if someone "fixes" the integration by having the server *also* return a token in the JSON body, that token becomes readable by any injected or third-party script — a classic XSS-to-session-theft upgrade path.

**Recommended fix direction:** keep the `HttpOnly` cookie as the sole auth transport and delete the `localStorage` / `Authorization: Bearer` code in `api.js`, rather than adding a token to the response.

---

## Controls verified as correctly implemented

- **Password storage** — `src/authUtils.js` lines 14–18: `scrypt` with a fresh 16-byte random salt per password (`crypto.randomBytes(16)`), 64-byte derived key, stored as `salt:hash` hex. Modern, appropriate choice: memory-hard KDF, no fixed/global salt, nothing reversible. No endpoint ever returns `password_hash` — the `publicUser()` projections in `src/routes/auth.js` and `src/routes/admin.js` both explicitly whitelist `id`/`email`/`role`/`createdAt`.
- **Password comparison** — `verifyPassword` (`authUtils.js` lines 24–31) uses `crypto.timingSafeEqual` for the hash comparison itself. Only the *existence* check carries the timing leak in finding 2, not the byte comparison.
- **Session token generation** — `crypto.randomBytes(32).toString('hex')` (`authUtils.js` lines 34–36): 256 bits of entropy, cryptographically random, opaque (a pure DB lookup key with no embedded/forgeable claims). Forged or guessed tokens are computationally infeasible.
- **Session expiry is server-enforced** — `src/middleware.js` lines 22–38: every request re-reads `sessions.expires_at` from the DB and compares against `Date.now()`; an expired row is deleted and treated as unauthenticated on the very next use. Real enforcement, not a stored value trusted blindly.
- **Logout actually revokes** — `src/routes/auth.js` lines 103–109 deletes the session row server-side (`DELETE FROM sessions WHERE token = ?`), so a captured pre-logout cookie stops working immediately.
- **Authorization / per-user scoping** — every pin query in `src/routes/pins.js` is scoped by `WHERE ... AND user_id = ?` using `req.user.id` from the resolved session, never a client-supplied id (`listPinsStmt`, `getPinStmt`, `deletePinStmt` — lines 16–20, 65, 100, 105). No route accepts a `userId`/owner field from the request body. A user genuinely cannot reach another user's pins by id — confirmed by reading every pin-route SQL statement.
- **Admin enforcement is server-side** — `requireAdmin` in `src/middleware.js` (lines 49–57) checks `req.user.role !== 'admin'`, derived from the session-joined DB row rather than any client input, and is wired via `router.get('/users', requireAdmin, ...)` in `src/routes/admin.js` line 23. The client-side gating in `admin.js`/`admin.html` is UI-only decoration, as its own comments state.
- **No self-assignable admin role** — `POST /api/auth/register` (`src/routes/auth.js` lines 49–82) never reads a `role`/`isAdmin` field from the request body; role is decided purely by `countUsersStmt.get().count === 0` (first user ever). There is no promotion or role-change endpoint anywhere in `src/routes`.
- **SQL injection** — every query in `src/db.js`, `src/routes/auth.js`, `src/routes/pins.js`, `src/routes/admin.js` uses `db.prepare(...)` with `?` placeholders and bound parameters. No string concatenation into SQL anywhere; confirmed by reading every `db.prepare`/`.run`/`.get`/`.all` call site.
- **Input validation** — `validatePinBody` in `src/routes/pins.js` (lines 34–58) range-checks latitude/longitude, enforces a strict `YYYY-MM-DD` regex for `visitDate`, and length-bounds `placeName`/`note`. Registration validates email shape and an 8-character password minimum (`src/routes/auth.js` lines 52–57).
- **XSS in rendering** — both places rendering user-supplied strings into HTML (`public/js/app.js` `renderPinList()` lines 46–76, and `public/js/admin.js` lines 47–59) route every dynamic value through a `textContent`-based `escapeHtml()` helper before interpolating into `innerHTML`. The SVG `<title>` in `public/js/map.js` (line 130) is set via `.textContent`, and pin coordinates used in `transform`/`aria-label` go through `setAttribute`, not markup interpolation. `assets/world.svg` (loaded via `innerHTML` in `map.js` line 48) is a static, developer-bundled asset with no user-controlled write path.
- **CORS** — no CORS middleware or `Access-Control-Allow-Origin` header exists anywhere (confirmed via grep across `src/` and `server.js`). The app is same-origin only, the most restrictive and correct posture here.
- **CSRF exposure** — the `SameSite=Lax` session cookie blocks cross-site state-changing requests (POST/DELETE) while allowing normal top-level navigation; combined with the absence of any CORS grant, this gives reasonable CSRF protection for `POST /api/pins`, `DELETE /api/pins/:id`, and `POST /api/auth/logout` without a separate CSRF token.
- **DB file is not exposed as a static asset** — `server.js` line 39 mounts `express.static` only on `PUBLIC_DIR = path.join(__dirname, 'public')`; the SQLite file lives at `round-2/data/waypoint.db` (`src/db.js` lines 9–16), a sibling directory never registered with `express.static`.
- **No secrets committed** — a grep across the entire `round-2` tree (excluding `node_modules`) for secret/key/password-literal patterns matched only test fixture passwords in `round-2/tests/*.test.js`. No `.env`, no hardcoded API keys, and no signing secret exists to leak — sessions are opaque DB-backed tokens, not JWTs.

## Files reviewed

`server.js`, `src/db.js`, `src/authUtils.js`, `src/errors.js`, `src/middleware.js`, `src/routes/auth.js`, `src/routes/pins.js`, `src/routes/admin.js`, `public/js/api.js`, `public/js/auth.js`, `public/js/app.js`, `public/js/admin.js`, `public/js/map.js`, `public/js/login.js`, `public/js/register.js`, `public/index.html`, `public/admin.html`, `API.md`, `TEST-REPORT.md`, `public/FRONTEND-ASSUMPTIONS.md`, `package.json`.
