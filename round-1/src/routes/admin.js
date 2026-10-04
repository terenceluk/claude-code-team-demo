'use strict';

const express = require('express');
const { db } = require('../db');
const { serializeUser } = require('../helpers');
const requireAuth = require('../middleware/requireAuth');
const requireAdmin = require('../middleware/requireAdmin');

const router = express.Router();

// GET /api/admin/users
// Administrator-only. Lists every registered user (no password data).
router.get('/users', requireAuth, requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM users ORDER BY id ASC').all();
  res.status(200).json({ users: rows.map(serializeUser) });
});

module.exports = router;
