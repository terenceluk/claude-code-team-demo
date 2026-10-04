'use strict';

const path = require('node:path');
const express = require('express');
const { sendError } = require('./src/helpers');
const authRoutes = require('./src/routes/auth');
const pinRoutes = require('./src/routes/pins');
const adminRoutes = require('./src/routes/admin');

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const app = express();

// The frontend may be served from a different origin/port during local
// development (e.g. a Vite/webpack dev server), so CORS is opened up but
// restricted to reflecting the request's own Origin with credentials
// enabled, which is required for the session cookie to be sent/received
// from a different port. No external service is involved; this is purely
// local header handling.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

app.use(express.json());

// Malformed JSON bodies land here via express.json()'s error passthrough.
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return sendError(res, 400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }
  next(err);
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.use('/api/auth', authRoutes);
app.use('/api/pins', pinRoutes);
app.use('/api/admin', adminRoutes);

// Serves the frontend's built static assets (the frontend agent owns the
// contents of public/, this server only hosts it) so the browser UI is
// reachable at http://localhost:4000/ on the same origin as the API,
// which keeps the session cookie same-origin with no CORS involved.
// Explicitly skipped for /api/* and /health so those routes always fall
// through to the JSON handlers/404 above rather than ever being shadowed
// by a same-named static file.
app.use((req, res, next) => {
  if (req.path === '/health' || req.path.startsWith('/api/')) {
    return next();
  }
  express.static(PUBLIC_DIR)(req, res, next);
});

app.use((req, res) => {
  sendError(res, 404, 'NOT_FOUND', 'No route matches this request.');
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
});

app.listen(PORT, () => {
  console.log(`Waypoint API listening on http://localhost:${PORT}`);
});
