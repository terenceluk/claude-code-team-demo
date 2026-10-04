'use strict';

const express = require('express');
const { db } = require('../db');
const {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  parseCookies,
  getSession,
  SESSION_COOKIE_NAME,
} = require('../auth');
const { sendError, serializeUser, isValidEmail } = require('../helpers');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

// POST /api/auth/register
// body: { email: string, password: string (min 8 chars) }
// The very first account ever created in this database is automatically
// granted administrator status (see API.md "Admin bootstrap").
router.post('/register', (req, res) => {
  const { email, password } = req.body || {};

  if (!isValidEmail(email)) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'A valid email address is required.');
  }
  if (typeof password !== 'string' || password.length < 8) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Password must be a string of at least 8 characters.');
  }

  const normalizedEmail = email.trim().toLowerCase();

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (existing) {
    return sendError(res, 409, 'EMAIL_TAKEN', 'An account with this email already exists.');
  }

  const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  const isAdmin = userCount === 0 ? 1 : 0;

  const { hash, salt } = hashPassword(password);
  const createdAt = new Date().toISOString();

  const result = db
    .prepare(
      'INSERT INTO users (email, password_hash, password_salt, is_admin, created_at) VALUES (?, ?, ?, ?, ?)'
    )
    .run(normalizedEmail, hash, salt, isAdmin, createdAt);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);

  const { token, expiresAt } = createSession(user.id);
  setSessionCookie(res, token, expiresAt);

  res.status(201).json({ user: serializeUser(user) });
});

// POST /api/auth/login
// body: { email: string, password: string }
router.post('/login', (req, res) => {
  const { email, password } = req.body || {};

  if (!isValidEmail(email) || typeof password !== 'string' || password.length === 0) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Email and password are required.');
  }

  const normalizedEmail = email.trim().toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail);

  if (!user || !verifyPassword(password, user.password_salt, user.password_hash)) {
    return sendError(res, 401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
  }

  const { token, expiresAt } = createSession(user.id);
  setSessionCookie(res, token, expiresAt);

  res.status(200).json({ user: serializeUser(user) });
});

// POST /api/auth/logout
// Requires a valid session cookie. Destroys the session server-side and
// clears the cookie. Safe to call even if the session is already invalid.
router.post('/logout', (req, res) => {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE_NAME];
  if (token) {
    destroySession(token);
  }
  clearSessionCookie(res);
  res.status(200).json({ message: 'Logged out.' });
});

// GET /api/auth/me
// Returns the currently signed-in user, based on the session cookie.
router.get('/me', requireAuth, (req, res) => {
  res.status(200).json({ user: serializeUser(req.user) });
});

module.exports = router;
