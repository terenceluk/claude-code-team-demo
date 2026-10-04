'use strict';

const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../middleware');

const router = express.Router();

const listUsersStmt = db.prepare(
  'SELECT id, email, role, created_at FROM users ORDER BY id ASC'
);

function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    createdAt: row.created_at,
  };
}

// GET /api/admin/users - list every registered user (admin only)
router.get('/users', requireAdmin, (_req, res) => {
  const rows = listUsersStmt.all();
  res.status(200).json({ users: rows.map(publicUser) });
});

module.exports = router;
