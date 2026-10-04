const express = require('express');
const db = require('../db/connection');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/users', requireAuth, requireAdmin, (req, res) => {
  const rows = db
    .prepare(
      `SELECT u.id, u.email, u.role, u.created_at, COUNT(p.id) AS pin_count
       FROM users u
       LEFT JOIN pins p ON p.user_id = u.id
       GROUP BY u.id
       ORDER BY u.id ASC`
    )
    .all();
  res.json({ users: rows });
});

module.exports = router;
