'use strict';

const express = require('express');
const { db } = require('../db');
const { sendError, serializePin, isFiniteNumber, isValidDateString } = require('../helpers');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

// Every route below requires authentication, and every query/mutation is
// scoped to req.user.id so a signed-in user can only ever see or delete
// pins that they themselves created.
router.use(requireAuth);

// POST /api/pins
// body: { latitude: number, longitude: number, placeName: string,
//         visitDate: string (ISO date, e.g. "2026-07-29"), note?: string }
router.post('/', (req, res) => {
  const { latitude, longitude, placeName, visitDate, note } = req.body || {};

  if (!isFiniteNumber(latitude) || latitude < -90 || latitude > 90) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'latitude must be a number between -90 and 90.');
  }
  if (!isFiniteNumber(longitude) || longitude < -180 || longitude > 180) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'longitude must be a number between -180 and 180.');
  }
  if (typeof placeName !== 'string' || placeName.trim().length === 0) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'placeName must be a non-empty string.');
  }
  if (!isValidDateString(visitDate)) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'visitDate must be a valid date string (e.g. "2026-07-29").');
  }
  if (note !== undefined && note !== null && typeof note !== 'string') {
    return sendError(res, 400, 'VALIDATION_ERROR', 'note must be a string if provided.');
  }

  const createdAt = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO pins (user_id, latitude, longitude, place_name, visit_date, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(req.user.id, latitude, longitude, placeName.trim(), visitDate, note ?? null, createdAt);

  const pin = db.prepare('SELECT * FROM pins WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ pin: serializePin(pin) });
});

// GET /api/pins
// Returns only the pins owned by the signed-in user, newest first.
router.get('/', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM pins WHERE user_id = ? ORDER BY datetime(created_at) DESC, id DESC')
    .all(req.user.id);
  res.status(200).json({ pins: rows.map(serializePin) });
});

// DELETE /api/pins/:id
// Deletes a pin, but only if it belongs to the signed-in user. A pin that
// does not exist, or that belongs to someone else, both produce an
// identical 404 response so ownership cannot be probed.
router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Pin id must be a positive integer.');
  }

  const pin = db.prepare('SELECT * FROM pins WHERE id = ?').get(id);
  if (!pin || pin.user_id !== req.user.id) {
    return sendError(res, 404, 'NOT_FOUND', 'No pin with that id was found.');
  }

  db.prepare('DELETE FROM pins WHERE id = ?').run(id);
  res.status(200).json({ message: 'Pin deleted.' });
});

module.exports = router;
