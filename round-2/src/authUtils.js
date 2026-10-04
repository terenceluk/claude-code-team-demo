'use strict';

const crypto = require('node:crypto');

const SCRYPT_KEYLEN = 64;
const SESSION_COOKIE_NAME = 'waypoint_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Hash a plaintext password using scrypt with a random salt.
 * Returns a single string "salt:hash" (both hex-encoded) suitable for
 * storage in the users.password_hash column.
 */
function hashPassword(plainPassword) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(plainPassword, salt, SCRYPT_KEYLEN);
  return `${salt}:${derivedKey.toString('hex')}`;
}

/**
 * Verify a plaintext password against a stored "salt:hash" string.
 * Uses a timing-safe comparison.
 */
function verifyPassword(plainPassword, storedHash) {
  const [salt, hashHex] = String(storedHash).split(':');
  if (!salt || !hashHex) return false;
  const derivedKey = crypto.scryptSync(plainPassword, salt, SCRYPT_KEYLEN);
  const storedBuffer = Buffer.from(hashHex, 'hex');
  if (storedBuffer.length !== derivedKey.length) return false;
  return crypto.timingSafeEqual(derivedKey, storedBuffer);
}

/** Generate a cryptographically random opaque session token (hex string). */
function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

/** Parse the Cookie request header into a plain object. */
function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (key) {
      cookies[key] = decodeURIComponent(value);
    }
  });
  return cookies;
}

/** Build a Set-Cookie header value for establishing a session. */
function serializeSessionCookie(token, maxAgeMs) {
  const maxAgeSeconds = Math.floor(maxAgeMs / 1000);
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

/** Build a Set-Cookie header value that clears the session cookie. */
function serializeClearCookie() {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

module.exports = {
  SCRYPT_KEYLEN,
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  hashPassword,
  verifyPassword,
  generateSessionToken,
  parseCookies,
  serializeSessionCookie,
  serializeClearCookie,
};
