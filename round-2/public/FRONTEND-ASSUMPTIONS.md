# Frontend assumptions (Waypoint, round-2)

The backend for this app was being built in parallel by a separate agent and
its API contract was not available while this UI was written. I did not
read any backend source or API documentation in `round-2`, per the task
instructions ("working blind"). Everything below is a **guess**, isolated so
it's a small localized edit once the real contract is known.

**Single source of truth for all of this:** `round-2/public/js/api.js`
(the `ENDPOINTS` map, the `request()` helper, and the shape-normalizing
code in each exported method). A secondary, smaller set of admin-detection
assumptions lives in `round-2/public/js/auth.js` (`isAdmin()` and
`unwrapUser()`).

## Base URL / transport
- Assumed the API is mounted under `/api` on the same origin the static
  files are served from (`http://localhost:4100`), so all calls are
  relative fetches like `fetch('/api/...')`. No CORS handling was added.

## Authentication mechanism
- **Assumed bearer-token auth**, not a session cookie. On successful
  login/register I assumed the server returns a JSON body containing a
  `token` string plus a `user` object. The token is stored in
  `localStorage` under the key `waypoint_token` and sent back on every
  request as an `Authorization: Bearer <token>` header.
  - Code: `API.setSession`, `API.getToken`, and the `Authorization` header
    construction inside `request()` in `js/api.js`.
  - If the real backend instead uses an httpOnly session cookie, all of
    this storage/header code becomes unnecessary and `credentials:
    'include'` (or nothing at all, since it's same-origin) would replace
    it — a small, contained change in `js/api.js` only.
- **Assumed a `GET /api/auth/me` route** exists to validate an existing
  token and fetch the current user (including their admin flag) on every
  page load, rather than trusting a stale cached user object. Code:
  `API.fetchMe()` in `js/api.js`, called from `Auth.requireAuth()` in
  `js/auth.js`.
- **Assumed a `POST /api/auth/logout` route** exists for the server to
  invalidate/track the token server-side. This call is best-effort: if it
  fails (e.g. route doesn't exist), the client clears its local token and
  redirects to the login page anyway, since sign-out must never get stuck.
  Code: `API.logout()` in `js/api.js`, `Auth.signOut()` in `js/auth.js`.

## Routes and field names guessed
All in `js/api.js`, `ENDPOINTS`:

| Purpose | Method | Path | Request body | Assumed response |
|---|---|---|---|---|
| Register | POST | `/api/auth/register` | `{ name, email, password }` | `{ token, user: { id, name, email, isAdmin } }` |
| Login | POST | `/api/auth/login` | `{ email, password }` | `{ token, user: { id, name, email, isAdmin } }` |
| Current user | GET | `/api/auth/me` | — (token in header) | `{ id, name, email, isAdmin }` (or `{ user: {...} }`, both are handled) |
| Sign out | POST | `/api/auth/logout` | — | ignored either way |
| List my pins | GET | `/api/pins` | — | `[{ id, name, lat, lng, date, note }, ...]` (or `{ pins: [...] }`, both handled). Assumed the server filters to the caller's own pins based on the auth token — no `userId` query param is sent. |
| Create pin | POST | `/api/pins` | `{ name, lat, lng, date, note }` | created pin object, ideally including its new `id` |
| Delete pin | DELETE | `/api/pins/:id` | — | any 2xx |
| List all users (admin) | GET | `/api/admin/users` | — | `[{ id, name, email, isAdmin, createdAt }, ...]` (or `{ users: [...] }`, both handled) |

Specific field-name guesses worth calling out:
- Coordinates are sent/received as `lat` and `lng` (not `latitude`/
  `longitude`, not a nested `{ coords: { lat, lng } }`).
- Date of visit is sent as `date`, assumed to be an HTML `<input
  type="date">` value (`YYYY-MM-DD` string). Display code
  (`formatDate()` in `js/app.js`) also tolerates a full ISO timestamp by
  slicing the first 10 characters.
- Free-text field is called `note` (singular).
- Place name field is called `name`.
- Pin's owner-linking field, if the server includes it in responses, was
  never assumed to be required by the client — pins returned from `GET
  /api/pins` are rendered as-is, trusting the server already scoped them
  to the caller.

## Admin detection
- Assumed the user object carries a boolean `isAdmin` field. As a
  defensive fallback, `Auth.isAdmin()` (in `js/auth.js`) also accepts
  `is_admin: boolean` or `role: "admin"` (case-insensitive string) in
  case the backend used a different convention.
- Assumed **no client-side way to request/grant admin status at
  registration** — the register form only collects name/email/password.
  How the very first admin account is bootstraped (env var, seed script,
  "first user is admin", a manual DB flag, etc.) is entirely unknown and
  was not guessed at; the UI simply reflects whatever `isAdmin` value the
  server reports for the signed-in user.
- The admin screen (`admin.html`) is **UI-level gating only**, as
  instructed: the "Admin" nav link is hidden via `display:none` for
  non-admins (`Auth.initHeader`), and `admin.js` also refuses to render
  the table client-side and shows a "not available" message if
  `Auth.isAdmin(user)` is false. Real enforcement is expected to happen
  server-side on `GET /api/admin/users`.

## Error response shape
- Assumed JSON error bodies look like `{ "error": "human readable
  message" }`. `extractErrorMessage()` in `js/api.js` also defensively
  handles `{ "message": "..." }`, `{ "errors": [...] }`, a bare string
  body, or no body at all, falling back to a generic
  `Request failed (<status>)` message so the UI never breaks on an
  unexpected shape.

## Other guesses
- Password minimum length (6 characters) is a purely client-side UX
  guess for form validation; the server may enforce something
  different/stronger, in which case its own error message (surfaced via
  the error-shape handling above) will be shown to the user.
- Pin IDs are treated as opaque strings/numbers (`String(pin.id)` is used
  for comparisons) since the ID type (UUID vs incrementing integer) is
  unknown.
- If a create/delete request never returns (network failure) or the
  server is simply not running, `js/api.js`'s `request()` catches the
  fetch-level exception and surfaces "Could not reach the server..."
  rather than letting the page throw — this was verified by loading the
  UI with nothing listening on `/api/*` (see "Sanity check" below), and
  the pages render normally with inline error banners instead of a blank
  screen.

## Sanity check performed
- `node --check` was run against every file in `round-2/public/js/` —
  all pass.
- The `public/` directory was served from a disposable static file
  server on port 4321 (not 4100) and every HTML page, the CSS file, all
  JS files, and `assets/world.svg` were confirmed to return HTTP 200.
- Because there is no backend listening yet, actual `fetch('/api/...')`
  calls were not exercised end-to-end in a browser during this check;
  the network-error fallback path described above is what runs in that
  case and was reviewed by inspection.
