# Waypoint

Waypoint is a personal travel map portal: sign in, click a world map to drop
a pin at a place you've visited, attach a date and a short note, and see
your pins listed alongside the map. Each account only ever sees its own
pins. The first account created on a fresh database becomes an
administrator and can view the list of every registered user.

This is a local, single-machine demo. It has been built, tested, and
security-reviewed, and the review turned up several real weaknesses that
are recorded under [Known Limitations](#known-limitations) below rather
than glossed over. Do not expose this server to an untrusted network or
treat it as production-ready.

For the full backend request/response contract (every route, field, and
error code), see [`API.md`](./API.md). This README summarises the parts
relevant to running and using the app rather than repeating that document.

## Requirements

- **Node.js 24 or newer.** This build was verified on **Node v24.13.0**.
  Waypoint uses Node's built-in `node:sqlite` module for storage, which
  needs a recent Node release; on older versions of Node the server will
  fail to start. On startup Node prints an `ExperimentalWarning` about
  `node:sqlite` to the console — that is expected and not a sign of a
  problem.
- No database server to install and no native module compilation — SQLite
  storage is entirely built into Node.

## Install and run

```
cd round-1
npm install
npm start
```

The server listens on **http://localhost:4000** by default. Set the
`PORT` environment variable before `npm start` to use a different port.
The browser UI and the API are served from the same origin/port, so open
`http://localhost:4000/` in a browser to use the app.

On first run, a SQLite database file is created automatically at
`round-1/data/waypoint.db` (plus its `-wal`/`-shm` companion files) — no
manual database setup step is required. `data/` starts out empty, meaning
no accounts or pins exist yet the first time you run the app.

## First account and how admin works

**The very first account ever registered against an empty database
automatically becomes the administrator.** Every account registered after
that is a normal, non-admin user. There is no environment variable, seed
script, config flag, or any other way to grant admin — registration order
against an empty `users` table is the only rule.

Practical consequence: **the first thing you should do after starting the
server for the first time is register your own account**, before anyone
else can. Whoever's registration lands first becomes the administrator for
that database.

To reset and re-bootstrap admin (for example, to test this behaviour
again, or to start over): stop the server, then delete
`round-1/data/waypoint.db` and any `waypoint.db-wal` / `waypoint.db-shm`
files sitting next to it. This destroys **all** accounts and pins in that
database. The next account registered after restarting the server becomes
the new administrator.

## Walkthrough

1. **Register.** Open `http://localhost:4000/`, choose "Register", enter
   an email and a password (minimum 8 characters). This signs you in
   immediately (a session cookie is set) and, if this is the first account
   ever created, makes you the administrator.
2. **Sign in.** On later visits, use the sign-in form with the same email
   and password. The session cookie lasts 7 days from creation.
3. **Add a pin.** On the map screen, click anywhere on the world map to
   stage a location (latitude/longitude are filled in automatically), or
   type latitude/longitude in manually. Fill in a place name and a visit
   date, optionally add a note, then submit. The new pin appears as a
   marker on the map and in the pin list on the right.
4. **Remove a pin.** Click "Remove" next to a pin in the list. Only pins
   you own can be removed — the backend enforces this on every request,
   not just the UI.
5. **Admin view.** If your account is the administrator, an "Admin" nav
   link appears in the header. It lists every registered user (id, email,
   admin flag, created date) — never password data. Non-admin accounts
   never see this link, and the backend rejects the underlying request
   with `403` even if it's called directly.
6. **Sign out.** The "Sign out" button destroys the session on the server
   and clears the cookie, returning you to the sign-in screen.

## Project layout

```
round-1/
  server.js              Express entry point: wires up middleware,
                          mounts the API routers, and serves public/ as
                          static files on the same origin/port as the API.
  src/
    db.js                 SQLite connection (node:sqlite) and schema setup.
    auth.js                Password hashing (scrypt) and session
                          creation/validation, cookie helpers.
    helpers.js              Shared response/error helpers.
    middleware/
      requireAuth.js         Rejects requests without a valid session.
      requireAdmin.js        Rejects requests from a non-admin user.
    routes/
      auth.js               /api/auth/register, /login, /logout, /me
      pins.js                /api/pins (create, list-own, delete-own)
      admin.js                /api/admin/users (admin-only)
  public/                  Static frontend, no build step:
    index.html               Markup for sign-in, register, map, and admin
                          screens.
    app.js                    All frontend behaviour (vanilla JS): API
                          calls, map click handling, pin rendering.
    styles.css                Styling.
    world.svg                 The world map image the pins are placed on.
  tests/
    run.js                   Self-contained backend test suite (see below).
  data/                    SQLite database file lives here once the
                          server has been run at least once. Empty until
                          then.
  API.md                   Full backend API contract.
  package.json
```

## Running the tests

```
cd round-1
node tests/run.js
```

This was run and confirmed to pass **53/53 tests, exit code 0**.

The suite is self-contained: it starts its own server instance on port
4917 (so it won't collide with a server you have running on the default
4000), runs every test against that instance, then shuts it down and
deletes the database file (and its `-wal`/`-shm` siblings) it created, so
that `round-1/data/` is left exactly as it found it and the "first
registration becomes admin" bootstrap behaviour is preserved for your own
subsequent run.

Confirmed passing coverage includes:

- Registration and both valid and invalid sign-in.
- Pin create and delete.
- Session rejection for a tampered session cookie and for a genuinely
  expired session.
- Cross-user pin isolation — a user cannot list or delete another user's
  pins; a foreign pin id returns `404` and the pin is not deleted.
- A signed-in non-admin user getting `403` from the admin endpoint.

**Known gap in test coverage:** there is no browser-driver (e.g.
Playwright/Selenium) test. Frontend verification is limited to checking
static-asset content types and a source-level review of `public/app.js`.
Actual in-browser DOM behaviour — that clicking the map visually places a
pin, that the 401 handler genuinely drops the user back to a live
sign-in screen, CSS layout correctness — has not been exercised by an
automated test and would need a real browser to confirm.

## Known limitations

These were flagged by a security review of the code as it stands. None of
them are fixed; they are listed here so anyone using or extending this
demo knows what they're accepting.

1. **The server listens on all network interfaces, not just localhost.**
   `server.js` calls `app.listen(PORT)` with no host argument, which binds
   to `::` (all interfaces) rather than `127.0.0.1`. This was verified at
   runtime. In practice this means anyone else on the same network can
   reach the portal, despite it being described here as a "local" app.
   Combined with the admin bootstrap rule, this is the most consequential
   limitation: on an untrusted network, someone else could race you to
   register the first account and become the administrator, or make
   unlimited password-guessing attempts against your account (see next
   point).
2. **No rate limiting or account lockout on sign-in.** Password attempts
   are unlimited.
3. **No CSRF tokens.** This is currently mitigated in practice by the
   session cookie's `SameSite=Lax` attribute, but the CORS middleware
   reflects back whatever `Origin` header a request sends and sets
   `Access-Control-Allow-Credentials: true` with no allowlist — so
   `SameSite=Lax` is the only thing standing between this app and a CSRF
   issue. This should be tightened before this pattern is reused anywhere
   beyond a local demo.
4. **No HTTPS and no `Secure` cookie flag.** The session cookie travels in
   cleartext over plain HTTP.
5. **scrypt uses Node's default cost parameters**, not explicitly tuned
   ones. This is below current OWASP guidance, though low risk for a
   local demo with no real attacker access to the password hashes.
6. **The registration endpoint returns a distinct `409 EMAIL_TAKEN`** for
   an already-registered email, which allows enumerating registered
   addresses. Sign-in itself does not have this problem — it returns an
   identical `401` whether the email is unknown or the password is wrong.
7. **Not implemented at all:** password reset, email verification, pin
   editing (only create/list/delete exist, no update), and pagination on
   any list endpoint.

The review also confirmed several things working as intended, worth
stating plainly rather than leaving ambiguous:

- Pin ownership is enforced in SQL on every pin route — a user's queries
  are always scoped to their own `user_id`.
- The admin route checks the signed-in user's role from the database on
  every request, never from anything client-supplied.
- Session expiry and logout are enforced server-side via a database
  lookup on every request, so logging out genuinely revokes the token
  rather than just clearing a cookie the client could resend.
- No secrets are committed to the repository.
- All user-supplied text (place name, note, email) reaches the DOM via
  `textContent` rather than `innerHTML`, so no unescaped-HTML rendering
  path was found in the frontend.
