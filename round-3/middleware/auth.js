const jwt = require('jsonwebtoken');
const db = require('../db/connection');

// Documented local-dev fallback. Set WAYPOINT_JWT_SECRET in the environment
// for anything beyond a throwaway laptop instance.
const SECRET = process.env.WAYPOINT_JWT_SECRET || 'waypoint-dev-secret-do-not-use-in-production';

if (!process.env.WAYPOINT_JWT_SECRET) {
  // Runs once at module load (startup), not per request. Intentionally not
  // gated to production or suppressed under NODE_ENV=test: a warning that
  // only appears in production is one nobody sees while there's still time
  // to act on it. Set WAYPOINT_JWT_SECRET to silence it.
  console.warn(
    'WARNING: WAYPOINT_JWT_SECRET is not set — using the INSECURE local-dev fallback secret. Do not run this way outside a throwaway local instance.'
  );
}

const isRevoked = db.prepare('SELECT 1 FROM revoked_tokens WHERE jti = ? AND expires_at > ?');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  let payload;
  try {
    payload = jwt.verify(token, SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (payload.jti && isRevoked.get(payload.jti, nowSeconds)) {
    return res.status(401).json({ error: 'Token has been signed out' });
  }

  req.user = { id: payload.sub, email: payload.email, role: payload.role };
  req.tokenPayload = payload;
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin, SECRET };
