'use strict';

const express = require('express');
const db = require('../db');
const {
  hashPassword,
  verifyPassword,
  generateSessionToken,
  serializeSessionCookie,
  serializeClearCookie,
  SESSION_TTL_MS,
} = require('../authUtils');
const { sendError } = require('../errors');
const { requireAuth } = require('../middleware');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const countUsersStmt = db.prepare('SELECT COUNT(*) AS count FROM users');
const insertUserStmt = db.prepare(
  'INSERT INTO users (email, password_hash, role, created_at) VALUES (?, ?, ?, ?)'
);
const getUserByEmailStmt = db.prepare('SELECT * FROM users WHERE email = ?');
const insertSessionStmt = db.prepare(
  'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
);
const deleteSessionStmt = db.prepare('DELETE FROM sessions WHERE token = ?');

function publicUser(userRow) {
  return {
    id: userRow.id,
    email: userRow.email,
    role: userRow.role,
    createdAt: userRow.created_at,
  };
}

function createSessionAndRespond(res, userRow, status) {
  const token = generateSessionToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  insertSessionStmt.run(token, userRow.id, now.toISOString(), expiresAt.toISOString());
  res.setHeader('Set-Cookie', serializeSessionCookie(token, SESSION_TTL_MS));
  res.status(status).json({ user: publicUser(userRow) });
}

// POST /api/auth/register
router.post('/register', (req, res) => {
  const { email, password } = req.body || {};

  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'A valid email address is required.');
  }
  if (typeof password !== 'string' || password.length < 8) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Password must be at least 8 characters long.');
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existing = getUserByEmailStmt.get(normalizedEmail);
  if (existing) {
    return sendError(res, 409, 'CONFLICT', 'An account with that email already exists.');
  }

  // Admin bootstrap rule: the very first account ever created becomes the
  // administrator. Every account after that defaults to the 'user' role.
  const isFirstUser = countUsersStmt.get().count === 0;
  const role = isFirstUser ? 'admin' : 'user';

  const passwordHash = hashPassword(password);
  const createdAt = new Date().toISOString();
  const info = insertUserStmt.run(normalizedEmail, passwordHash, role, createdAt);

  const userRow = {
    id: Number(info.lastInsertRowid),
    email: normalizedEmail,
    role,
    created_at: createdAt,
  };

  createSessionAndRespond(res, userRow, 201);
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { email, password } = req.body || {};

  if (typeof email !== 'string' || typeof password !== 'string') {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Email and password are required.');
  }

  const normalizedEmail = email.trim().toLowerCase();
  const userRow = getUserByEmailStmt.get(normalizedEmail);

  if (!userRow || !verifyPassword(password, userRow.password_hash)) {
    return sendError(res, 401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
  }

  createSessionAndRespond(res, userRow, 200);
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  if (req.sessionToken) {
    deleteSessionStmt.run(req.sessionToken);
  }
  res.setHeader('Set-Cookie', serializeClearCookie());
  res.status(200).json({ ok: true });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  const userRow = getUserByEmailStmt.get(req.user.email);
  if (!userRow) {
    return sendError(res, 401, 'UNAUTHORIZED', 'Session is no longer valid.');
  }
  res.status(200).json({ user: publicUser(userRow) });
});

module.exports = router;
