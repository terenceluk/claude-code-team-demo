'use strict';

function sendError(res, status, code, message) {
  res.status(status).json({ error: { code, message } });
}

function serializeUser(row) {
  return {
    id: row.id,
    email: row.email,
    isAdmin: !!row.is_admin,
    createdAt: row.created_at,
  };
}

function serializePin(row) {
  return {
    id: row.id,
    userId: row.user_id,
    latitude: row.latitude,
    longitude: row.longitude,
    placeName: row.place_name,
    visitDate: row.visit_date,
    note: row.note === null || row.note === undefined ? null : row.note,
    createdAt: row.created_at,
  };
}

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

// Accepts an ISO date (YYYY-MM-DD) or a full ISO datetime string.
function isValidDateString(value) {
  if (typeof value !== 'string' || value.trim() === '') return false;
  const time = Date.parse(value);
  return !Number.isNaN(time);
}

module.exports = {
  sendError,
  serializeUser,
  serializePin,
  isValidEmail,
  isFiniteNumber,
  isValidDateString,
};
