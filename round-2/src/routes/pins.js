'use strict';

const express = require('express');
const db = require('../db');
const { sendError } = require('../errors');
const { requireAuth } = require('../middleware');

const router = express.Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const insertPinStmt = db.prepare(
  `INSERT INTO pins (user_id, latitude, longitude, place_name, visit_date, note, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
);
const listPinsStmt = db.prepare(
  'SELECT * FROM pins WHERE user_id = ? ORDER BY visit_date DESC, id DESC'
);
const getPinStmt = db.prepare('SELECT * FROM pins WHERE id = ? AND user_id = ?');
const deletePinStmt = db.prepare('DELETE FROM pins WHERE id = ? AND user_id = ?');

function publicPin(row) {
  return {
    id: row.id,
    latitude: row.latitude,
    longitude: row.longitude,
    placeName: row.place_name,
    visitDate: row.visit_date,
    note: row.note === null || row.note === undefined ? null : row.note,
    createdAt: row.created_at,
  };
}

function validatePinBody(body) {
  const errors = [];
  const { latitude, longitude, placeName, visitDate, note } = body || {};

  if (typeof latitude !== 'number' || Number.isNaN(latitude) || latitude < -90 || latitude > 90) {
    errors.push('latitude must be a number between -90 and 90.');
  }
  if (typeof longitude !== 'number' || Number.isNaN(longitude) || longitude < -180 || longitude > 180) {
    errors.push('longitude must be a number between -180 and 180.');
  }
  if (typeof placeName !== 'string' || placeName.trim().length === 0 || placeName.length > 200) {
    errors.push('placeName is required and must be 1-200 characters.');
  }
  if (typeof visitDate !== 'string' || !DATE_RE.test(visitDate)) {
    errors.push('visitDate is required and must be in YYYY-MM-DD format.');
  }
  if (note !== undefined && note !== null && typeof note !== 'string') {
    errors.push('note must be a string when provided.');
  }
  if (typeof note === 'string' && note.length > 2000) {
    errors.push('note must be 2000 characters or fewer.');
  }

  return errors;
}

// All pin routes require a signed-in user.
router.use(requireAuth);

// GET /api/pins - list the signed-in user's own pins
router.get('/', (req, res) => {
  const rows = listPinsStmt.all(req.user.id);
  res.status(200).json({ pins: rows.map(publicPin) });
});

// POST /api/pins - create a pin owned by the signed-in user
router.post('/', (req, res) => {
  const errors = validatePinBody(req.body);
  if (errors.length > 0) {
    return sendError(res, 400, 'VALIDATION_ERROR', errors.join(' '));
  }

  const { latitude, longitude, placeName, visitDate, note } = req.body;
  const createdAt = new Date().toISOString();

  const info = insertPinStmt.run(
    req.user.id,
    latitude,
    longitude,
    placeName.trim(),
    visitDate,
    note === undefined || note === null ? null : note,
    createdAt
  );

  const row = getPinStmt.get(Number(info.lastInsertRowid), req.user.id);
  res.status(201).json({ pin: publicPin(row) });
});

// DELETE /api/pins/:id - delete a pin owned by the signed-in user
router.delete('/:id', (req, res) => {
  const pinId = Number(req.params.id);
  if (!Number.isInteger(pinId) || pinId <= 0) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Pin id must be a positive integer.');
  }

  const existing = getPinStmt.get(pinId, req.user.id);
  if (!existing) {
    return sendError(res, 404, 'NOT_FOUND', 'No pin with that id was found for the current user.');
  }

  deletePinStmt.run(pinId, req.user.id);
  res.status(200).json({ ok: true, id: pinId });
});

module.exports = router;
