const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/connection');
const { requireAuth, SECRET } = require('../middleware/auth');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
const TOKEN_TTL = '7d';
const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

const SALT_ROUNDS = 12;

function signToken(user) {
  const jti = crypto.randomUUID();
  const token = jwt.sign(
    { sub: user.id, email: user.email, role: user.role, jti },
    SECRET,
    { expiresIn: TOKEN_TTL }
  );
  return token;
}

router.post('/register', (req, res) => {
  const { email, password } = req.body || {};

  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
    return res.status(400).json({ error: 'A valid email address is required' });
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (existing) {
    return res.status(409).json({ error: 'An account with that email already exists' });
  }

  // role is always 'user' here; admins are created only via `npm run seed`.
  const passwordHash = bcrypt.hashSync(password, SALT_ROUNDS);
  const info = db
    .prepare('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)')
    .run(normalizedEmail, passwordHash, 'user');

  const user = { id: info.lastInsertRowid, email: normalizedEmail, role: 'user' };
  const token = signToken(user);
  res.status(201).json({ token, user });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const row = db
    .prepare('SELECT id, email, password_hash, role FROM users WHERE email = ?')
    .get(normalizedEmail);

  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const user = { id: row.id, email: row.email, role: row.role };
  const token = signToken(user);
  res.json({ token, user });
});

router.post('/logout', requireAuth, (req, res) => {
  const { jti, exp } = req.tokenPayload;
  const nowSeconds = Math.floor(Date.now() / 1000);
  // Opportunistic cleanup of anything already expired, then record this jti
  // as revoked until its natural expiry so /me and /pins reject it immediately.
  db.prepare('DELETE FROM revoked_tokens WHERE expires_at <= ?').run(nowSeconds);
  db.prepare('INSERT OR REPLACE INTO revoked_tokens (jti, expires_at) VALUES (?, ?)').run(
    jti,
    exp || nowSeconds + TOKEN_TTL_SECONDS
  );
  res.status(204).end();
});

router.get('/me', requireAuth, (req, res) => {
  const row = db
    .prepare('SELECT id, email, role, created_at FROM users WHERE id = ?')
    .get(req.user.id);
  if (!row) {
    return res.status(401).json({ error: 'User no longer exists' });
  }
  res.json({ user: row });
});

module.exports = router;
