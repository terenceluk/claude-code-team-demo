# Waypoint Security Review

> Authored by the `security-reviewer` agent (read-only: Read/Grep/Glob).
> Transcribed to this file verbatim by the team lead, because that agent has no
> Write tool. The team-lead addendum at the end is clearly marked and is the
> only content not written by the reviewer.

## Verdict
No Critical or High-severity issues were found. The authorization boundary — the area this audit exists to catch failures in — holds up under direct inspection: every pin route filters by the caller's own `user_id` taken from a cryptographically verified JWT (never from the request body/query), the admin role check lives in server middleware and is independent of any frontend button-hiding, and the cross-user-pin-access-returns-404 anti-enumeration design was verified to genuinely withhold the other user's row rather than merely mask a query that leaks it. Password storage, SQL parameterization, JWT signature/expiry enforcement, and frontend DOM handling (no XSS sink found anywhere, including the bundled SVG) all check out. The findings below are two Medium items worth deliberate acceptance/fix decisions (JWT in localStorage; a silent-fail-open dev secret), two Low items (alg not explicitly pinned in code, though the library default is safe; no login rate limiting), and two Info notes. All claims below were verified by reading the actual source; nothing here is speculative.

## Findings

| ID | Severity | Title | File:Line | Impact |
|----|----------|-------|-----------|--------|
| F1 | Medium | JWT held in `localStorage`, not an httpOnly cookie | `public/js/api.js:7,15` | Any future/overlooked injection point would allow full session theft; no such point exists today (verified) |
| F2 | Medium | Dev JWT secret fallback has no startup warning | `middleware/auth.js:6` | If deployed without `WAYPOINT_JWT_SECRET` set, server silently signs/verifies with a public, hardcoded string — full token forgery incl. admin |
| F3 | Low | JWT algorithm not explicitly pinned in the `verify()` call | `middleware/auth.js:19` | Currently safe (library defaults to HS256/384/512 for a string secret and rejects `alg:none` — confirmed by reading `jsonwebtoken@9.0.3`'s `verify.js`), but relies on library defaults rather than explicit code |
| F4 | Low | No rate limiting or lockout on `/api/auth/login` | `routes/auth.js:54` | Online brute-force/credential-stuffing is only slowed by bcrypt cost-12, not blocked |
| F5 | Info | `POST /api/auth/register` reveals whether an email is already registered (`409`) | `routes/auth.js:39-41` | Minor email enumeration; standard/expected tradeoff for a registration flow (login path correctly avoids this) |
| F6 | Info | `revoked_tokens` is pruned only opportunistically, at the next logout call | `routes/auth.js:79` | Bounded by 7-day token TTL either way; not a practical DoS at this app's scale |

## Detailed findings

**F1 — JWT in localStorage.**
```js
// public/js/api.js
function getToken() { return localStorage.getItem(TOKEN_KEY); }
function setToken(token) { ... localStorage.setItem(TOKEN_KEY, token); }
```
Why it matters: script running on the page (any XSS) can read `localStorage` and exfiltrate the token; an httpOnly cookie would not be readable by JS at all. I verified there is currently no XSS vector (see "checks that passed"), so this is a defense-in-depth gap, not an active hole. Fix: if reworking the auth transport is in scope, move to an httpOnly, `SameSite=Strict` session cookie set by the server; if staying with bearer tokens, this is an accepted tradeoff worth stating explicitly in docs rather than leaving implicit.

**F2 — Silent dev-secret fallback.**
```js
// middleware/auth.js:6
const SECRET = process.env.WAYPOINT_JWT_SECRET || 'waypoint-dev-secret-do-not-use-in-production';
```
No `dotenv` dependency exists (checked `package.json`), so nothing auto-loads a `.env` — the operator must explicitly export the env var. Nothing in `server.js` or `auth.js` logs a warning if the fallback is in effect, so a misconfigured deployment would run indefinitely on a secret that's printed in this very source tree, with zero runtime signal. Impact if it happened would be severe (arbitrary token forgery, including `role: admin`), but it requires an operator error, and no `.env` is committed (confirmed — none exists, and `.gitignore` excludes it). Fix: `if (!process.env.WAYPOINT_JWT_SECRET) console.warn('WAYPOINT_JWT_SECRET not set — using INSECURE dev fallback')` at boot.

**F3 — Algorithm not explicitly pinned.**
```js
// middleware/auth.js:19
payload = jwt.verify(token, SECRET);
```
No `{ algorithms: [...] }` option is passed. I read `node_modules/jsonwebtoken/verify.js` directly: when no `algorithms` option is given and the key is a plain string/symmetric secret, the library defaults `options.algorithms` to `['HS256','HS384','HS512']` and explicitly refuses unsigned tokens unless `"none"` is in that list (`verify.js:116-117, 132-146`). So the classic `alg:none` / RS-to-HS confusion bypass does **not** apply here today. Still, relying on an undocumented-at-the-callsite library default is fragile against future refactors. Fix: `jwt.verify(token, SECRET, { algorithms: ['HS256'] })`.

**F4 — No login rate limiting.**
Checked `package.json` deps and grepped for `express-rate-limit`/`slowDown` — none present, and no manual throttling in `routes/auth.js`. bcrypt cost-12 imposes real per-attempt cost but there is no cap on attempt count or IP/account lockout. Calibrated as Low, not higher, given no evidence of a broader unauthenticated-endpoint DoS angle and the hashing cost is a genuine (if partial) mitigant. Fix: add `express-rate-limit` on `/api/auth/login` (and `/register`) if this app is ever exposed beyond a local demo.

**F5 — Registration enumeration.** Standard behavior; note only.

**F6 — Denylist pruning.** Note only; `TOKEN_TTL_SECONDS` bounds growth regardless.

## Route-by-route authorization enumeration

| Route | Auth required | Scoped to caller? |
|---|---|---|
| `POST /api/auth/register` | No | N/A — role forced `'user'` server-side (`routes/auth.js:47`), client-sent `role`/`user_id` never read |
| `POST /api/auth/login` | No | N/A — generic `401` for both bad email and bad password (`routes/auth.js:66`), no account-existence leak |
| `POST /api/auth/logout` | Yes | Revokes only the caller's own token; `jti`/`exp` read from `req.tokenPayload`, never the request body (`routes/auth.js:75`) |
| `GET /api/auth/me` | Yes | `WHERE id = req.user.id` (`routes/auth.js:89`) |
| `GET /api/pins` | Yes | `WHERE user_id = ?` bound to `req.user.id` (`routes/pins.js:74`) |
| `POST /api/pins` | Yes | `user_id` column set to `req.user.id`; any `user_id` in the body is silently ignored (`routes/pins.js:90`) |
| `GET /api/pins/:id` | Yes | `loadOwnPin` fetches by id then checks `pin.user_id !== req.user.id`, returns `404` for both nonexistent and other-user pins — verified the other user's row is never serialized into the response (`routes/pins.js:98-116`) |
| `PUT`/`PATCH /api/pins/:id` | Yes | Same `loadOwnPin` gate plus a belt-and-suspenders `WHERE id = ? AND user_id = ?` on the `UPDATE` itself (`routes/pins.js:133-134`) |
| `DELETE /api/pins/:id` | Yes | Same gate plus `WHERE id = ? AND user_id = ?` on the `DELETE` (`routes/pins.js:144`) |
| `GET /api/admin/users` | Yes, and `role === 'admin'` enforced in `requireAdmin` middleware (`middleware/auth.js:34-39`, wired at `routes/admin.js:7`) — a real server-side check, not a frontend-only gate (frontend only hides the nav link, `public/js/app.js:53`) | N/A by design (admin-wide); response never includes `password_hash` (`routes/admin.js:10`) |
| Static assets (`express.static`) | No | N/A, public frontend files |

## Checks that passed (verified by reading code)
- **Password storage**: bcrypt via `bcryptjs`, cost factor 12, on both register and seed paths (`routes/auth.js:44`, `db/seed.js:13`) — an adaptive hash at a sane cost. No password or hash is ever included in any response body, log statement, or error message anywhere (grepped all `.js` and `console.*` calls).
- **Token integrity**: signature verification and expiry are both enforced by the library itself, not just "set and trusted" — a tampered payload fails signature check; an expired token is rejected via `exp` comparison and surfaces as `401` (`middleware/auth.js:18-22`).
- **Revocation (`jti` denylist)**: checked *after* signature verification, the correct order (`middleware/auth.js:19-27`). A caller can only revoke their own token — `jti`/`exp` come from the caller's own verified `tokenPayload`, never client input. Because `signToken` always sets a `jti` (`routes/auth.js:18`), the "missing jti" branch is unreachable for any token the app itself issues. Synchronous `better-sqlite3` means no TOCTOU race between the revocation check and its use.
- **Privilege escalation**: `role` cannot be set by the client at register or anywhere else — hardcoded to `'user'` in the INSERT (`routes/auth.js:47`); admin accounts exist only via `npm run seed`. No update-my-profile or update-other-user route exists at all.
- **SQL injection**: every query uses `?` parameter binding; the only template-literal SQL (`PIN_COLUMNS`) interpolates a hardcoded constant column list, never user input.
- **Stored XSS**: grepped all of `public/` for `innerHTML`, `insertAdjacentHTML`, `outerHTML`, `document.write`, `eval`, `new Function` — the only two `innerHTML` uses are `= ''` clears (`admin.js:20`, `app.js:161`), not writes of user data. Every rendering of user-supplied text uses `textContent` or `setAttribute` (safe, non-parsing) — verified in `app.js:180-184`, `admin.js:15`, `map.js:188-190`. The bundled `assets/world-map.svg` was read directly and contains no `<script>`, `<image>`, `xlink:href`, or event-handler attributes.
- **CORS**: no `cors` package or `Access-Control-*` headers anywhere — correct, since frontend and API share one origin via `express.static`.
- **Secrets/housekeeping**: no `.env` file exists in the tree; `.gitignore` correctly excludes `node_modules/`, all `*.sqlite*` variants, and `.env`. No API keys/credentials committed outside the documented, intentionally-public demo seed accounts.
- **Error handling**: the global error handler always returns a generic `{ error: 'Internal server error' }` with no stack trace to the client (`server.js:39-43`); stack traces only go to the server's own console.

**Findings by severity: Critical 0, High 0, Medium 2, Low 2, Info 2.**

---

## Addendum — team lead

Not part of the `security-reviewer` agent's audit. Added for traceability.

**Spot-checks of the report's highest-risk claims.** I independently read
`middleware/auth.js` and confirm:

- `:6` is the unwarned dev-secret fallback exactly as F2 describes.
- `:19` calls `jwt.verify(token, SECRET)` with no `algorithms` option — F3 confirmed.
- Revocation (`:25`) is checked *after* signature verification (`:19`), which is
  the correct order, as the report states.
- `requireAdmin` (`:34-39`) reads `req.user.role`, which is populated only from
  the verified token payload at `:29` — a genuine server-side gate.

**A7 (Info) — role is trusted from the token for its full 7-day lifetime.**
`middleware/auth.js:29` populates `req.user.role` from the JWT payload rather
than re-reading the row from the database. If a user's role were ever changed,
their existing token would keep the old role until it expired (up to 7 days) or
they logged out. The reviewer did not flag this, and it is **not reachable in
this build** — no route exists that can change a user's role, and admin accounts
are created only by `npm run seed`. It is recorded here because it becomes a real
privilege-retention bug the moment a role-change feature is added. Fix at that
point: look the role up per request, or revoke the user's tokens on role change.

**Verified separately by the team lead, outside this audit:** no external asset
references remain anywhere under `public/` (the offline requirement in
`.claude/agents/frontend.md:12-15`), and `better-sqlite3` is pinned to the exact
version installed in `node_modules` (`13.0.2`).
