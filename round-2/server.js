'use strict';

const path = require('node:path');
const express = require('express');

const { resolveSession } = require('./src/middleware');
const { sendError } = require('./src/errors');
const authRoutes = require('./src/routes/auth');
const pinsRoutes = require('./src/routes/pins');
const adminRoutes = require('./src/routes/admin');

const PORT = process.env.PORT ? Number(process.env.PORT) : 4100;
const PUBLIC_DIR = path.join(__dirname, 'public');

const app = express();

app.disable('x-powered-by');
app.use(express.json());
app.use(resolveSession);

// --- API routes (must be registered before the static file handler so
// that no static asset can ever shadow an API path). ---

app.get('/api/health', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'waypoint-api', time: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/pins', pinsRoutes);
app.use('/api/admin', adminRoutes);

// Any other /api/* path that wasn't matched above is an API 404, not a
// static-file lookup.
app.use('/api', (_req, res) => {
  sendError(res, 404, 'NOT_FOUND', 'No such API route.');
});

// --- Static UI files (served by another agent's build) ---
app.use(express.static(PUBLIC_DIR));

// --- Error handling ---

// Handles malformed JSON bodies from express.json() and any other
// synchronous errors thrown by route handlers.
app.use((err, _req, res, _next) => {
  if (err && err.type === 'entity.parse.failed') {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Request body must be valid JSON.');
  }
  console.error(err); // eslint-disable-line no-console
  sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
});

app.listen(PORT, () => {
  console.log(`Waypoint API listening on http://localhost:${PORT}`); // eslint-disable-line no-console
});

module.exports = app;
