'use strict';

const { sendError } = require('../helpers');

// Must run after requireAuth. Responds 403 if the signed-in user is not an
// administrator.
function requireAdmin(req, res, next) {
  if (!req.user || !req.user.is_admin) {
    return sendError(res, 403, 'FORBIDDEN', 'Administrator access is required for this endpoint.');
  }
  next();
}

module.exports = requireAdmin;
