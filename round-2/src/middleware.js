'use strict';

const db = require('./db');
const { parseCookies, SESSION_COOKIE_NAME } = require('./authUtils');
const { sendError } = require('./errors');

const getSessionStmt = db.prepare(
  `SELECT sessions.token, sessions.user_id, sessions.expires_at,
          users.id AS user_id, users.email, users.role
   FROM sessions
   JOIN users ON users.id = sessions.user_id
   WHERE sessions.token = ?`
);

const deleteSessionStmt = db.prepare('DELETE FROM sessions WHERE token = ?');

/**
 * Resolve the current session (if any) from the request's cookies.
 * Attaches req.user = { id, email, role } and req.sessionToken when valid.
 * Expired sessions are deleted and treated as absent.
 */
function resolveSession(req, _res, next) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) return next();

  const row = getSessionStmt.get(token);
  if (!row) return next();

  if (new Date(row.expires_at).getTime() < Date.now()) {
    deleteSessionStmt.run(token);
    return next();
  }

  req.user = { id: row.user_id, email: row.email, role: row.role };
  req.sessionToken = token;
  next();
}

/** Require that the request carries a valid, unexpired session. */
function requireAuth(req, res, next) {
  if (!req.user) {
    return sendError(res, 401, 'UNAUTHORIZED', 'You must be signed in to perform this action.');
  }
  next();
}

/** Require that the signed-in user has the admin role. */
function requireAdmin(req, res, next) {
  if (!req.user) {
    return sendError(res, 401, 'UNAUTHORIZED', 'You must be signed in to perform this action.');
  }
  if (req.user.role !== 'admin') {
    return sendError(res, 403, 'FORBIDDEN', 'This action requires administrator privileges.');
  }
  next();
}

module.exports = { resolveSession, requireAuth, requireAdmin };
