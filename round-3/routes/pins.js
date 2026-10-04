const express = require('express');
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const MAX_PLACE_NAME = 200;
const MAX_NOTE = 2000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const PIN_COLUMNS = 'id, place_name, latitude, longitude, visited_on, note, created_at';

// Date.parse (and `new Date(string)`) silently rolls an out-of-range day
// over into the next month instead of rejecting it (e.g. '2024-02-30'
// becomes March 1st), so DATE_RE + Date.parse alone lets impossible dates
// through. Round-trip the components through Date.UTC and confirm nothing
// rolled over. UTC (not local time) so the result can't shift by a day
// depending on the server's timezone.
function isRealCalendarDate(raw) {
  const [y, m, d] = raw.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// Validates req.body against the pin shape. In partial mode (PATCH/PUT),
// fields that are simply absent are left out of `out` rather than rejected.
function validatePinInput(body, { partial = false } = {}) {
  const errors = [];
  const out = {};

  if (body.place_name !== undefined || !partial) {
    if (typeof body.place_name !== 'string' || !body.place_name.trim()) {
      errors.push('place_name is required and must be a non-empty string');
    } else if (body.place_name.trim().length > MAX_PLACE_NAME) {
      errors.push(`place_name must be ${MAX_PLACE_NAME} characters or fewer`);
    } else {
      out.place_name = body.place_name.trim();
    }
  }

  if (body.latitude !== undefined || !partial) {
    const lat = Number(body.latitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      errors.push('latitude must be a number between -90 and 90');
    } else {
      out.latitude = lat;
    }
  }

  if (body.longitude !== undefined || !partial) {
    const lon = Number(body.longitude);
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
      errors.push('longitude must be a number between -180 and 180');
    } else {
      out.longitude = lon;
    }
  }

  if (body.visited_on !== undefined || !partial) {
    const raw = body.visited_on;
    if (typeof raw !== 'string' || !DATE_RE.test(raw) || !isRealCalendarDate(raw)) {
      errors.push('visited_on must be a valid date in YYYY-MM-DD format');
    } else {
      out.visited_on = raw;
    }
  }

  if (body.note !== undefined) {
    if (body.note !== null && typeof body.note !== 'string') {
      errors.push('note must be a string or null');
    } else if (typeof body.note === 'string' && body.note.length > MAX_NOTE) {
      errors.push(`note must be ${MAX_NOTE} characters or fewer`);
    } else {
      out.note = body.note === undefined ? null : body.note;
    }
  } else if (!partial) {
    out.note = null;
  }

  return { errors, out };
}

router.get('/', (req, res) => {
  const rows = db
    .prepare(`SELECT ${PIN_COLUMNS} FROM pins WHERE user_id = ? ORDER BY visited_on DESC, id DESC`)
    .all(req.user.id);
  res.json({ pins: rows });
});

router.post('/', (req, res) => {
  const { errors, out } = validatePinInput(req.body || {});
  if (errors.length) {
    return res.status(400).json({ error: errors.join('; ') });
  }

  // user_id always comes from the verified token, never the request body.
  const info = db
    .prepare(
      'INSERT INTO pins (user_id, place_name, latitude, longitude, visited_on, note) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(req.user.id, out.place_name, out.latitude, out.longitude, out.visited_on, out.note);

  const pin = db.prepare(`SELECT ${PIN_COLUMNS} FROM pins WHERE id = ?`).get(info.lastInsertRowid);
  res.status(201).json({ pin });
});

// Loads a pin and 404s (never 403) if it doesn't exist OR belongs to someone
// else, so pin ids aren't enumerable by a logged-in attacker.
function loadOwnPin(req, res, next) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(404).json({ error: 'Pin not found' });
  }
  const pin = db
    .prepare(`SELECT ${PIN_COLUMNS}, user_id FROM pins WHERE id = ?`)
    .get(id);
  if (!pin || pin.user_id !== req.user.id) {
    return res.status(404).json({ error: 'Pin not found' });
  }
  req.pin = pin;
  next();
}

router.get('/:id', loadOwnPin, (req, res) => {
  const { user_id, ...pin } = req.pin;
  res.json({ pin });
});

function updatePin(req, res) {
  const { errors, out } = validatePinInput(req.body || {}, { partial: true });
  if (errors.length) {
    return res.status(400).json({ error: errors.join('; ') });
  }

  const merged = {
    place_name: out.place_name !== undefined ? out.place_name : req.pin.place_name,
    latitude: out.latitude !== undefined ? out.latitude : req.pin.latitude,
    longitude: out.longitude !== undefined ? out.longitude : req.pin.longitude,
    visited_on: out.visited_on !== undefined ? out.visited_on : req.pin.visited_on,
    note: out.note !== undefined ? out.note : req.pin.note,
  };

  db.prepare(
    'UPDATE pins SET place_name = ?, latitude = ?, longitude = ?, visited_on = ?, note = ? WHERE id = ? AND user_id = ?'
  ).run(merged.place_name, merged.latitude, merged.longitude, merged.visited_on, merged.note, req.pin.id, req.user.id);

  const pin = db.prepare(`SELECT ${PIN_COLUMNS} FROM pins WHERE id = ?`).get(req.pin.id);
  res.json({ pin });
}

router.put('/:id', loadOwnPin, updatePin);
router.patch('/:id', loadOwnPin, updatePin);

router.delete('/:id', loadOwnPin, (req, res) => {
  db.prepare('DELETE FROM pins WHERE id = ? AND user_id = ?').run(req.pin.id, req.user.id);
  res.status(204).end();
});

module.exports = router;
