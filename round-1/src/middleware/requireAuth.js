'use strict';

const { db } = require('../db');
const { parseCookies, getSession, SESSION_COOKIE_NAME } = require('../auth');
const { sendError } = require('../helpers');

// Populates req.user (the raw users table row) when a valid, unexpired
// session cookie is present. Responds 401 otherwise. Every pin route and
// the admin route depend on this running first.
function requireAuth(req, res, next) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE_NAME];
  const session = getSession(token);

  if (!session) {
    return sendError(res, 401, 'UNAUTHENTICATED', 'You must be signed in to perform this action.');
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id);
  if (!user) {
    return sendError(res, 401, 'UNAUTHENTICATED', 'You must be signed in to perform this action.');
  }

  req.user = user;
  req.sessionToken = token;
  next();
}

module.exports = requireAuth;
