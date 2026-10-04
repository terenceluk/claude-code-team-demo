/**
 * api.js
 * -----------------------------------------------------------------------
 * SINGLE SOURCE OF TRUTH FOR BACKEND ASSUMPTIONS.
 *
 * The backend for this app was being built in parallel and its contract
 * was not available while this UI was written. Every route path, field
 * name, auth mechanism, and error shape below is a GUESS. If/when the
 * real backend contract is known, this file (plus the small "shape"
 * helpers at the bottom) should be the only place that needs to change.
 *
 * See FRONTEND-ASSUMPTIONS.md for the itemized list and rationale.
 * -----------------------------------------------------------------------
 */

const API = (function () {
  // Same-origin relative base: server serves public/ and the API from
  // the same origin (http://localhost:4100), so no absolute host is used.
  const BASE = '/api';

  // ASSUMPTION: token-based auth. Server returns a bearer token on
  // login/register, which we store client-side and send back as
  // "Authorization: Bearer <token>" on every subsequent request.
  // (Alternative would have been an httpOnly session cookie, in which
  // case none of this storage/header code would be needed - see
  // FRONTEND-ASSUMPTIONS.md item on auth mechanism.)
  const TOKEN_KEY = 'waypoint_token';
  const USER_KEY = 'waypoint_user';

  const ENDPOINTS = {
    // ASSUMPTION: registration route + field names.
    register: () => `${BASE}/auth/register`, // POST { name, email, password }
    // ASSUMPTION: login route + field names.
    login: () => `${BASE}/auth/login`, // POST { email, password }
    // ASSUMPTION: route to re-validate a stored token / fetch the
    // current user (used to confirm auth on page load and to read the
    // isAdmin flag from a trusted source rather than stale localStorage).
    me: () => `${BASE}/auth/me`, // GET
    // ASSUMPTION: no dedicated logout endpoint is required for a bearer
    // token scheme (sign-out is just discarding the local token), but we
    // still attempt to hit one in case the server tracks sessions/blacklists
    // tokens server-side. Failure of this call is treated as ok-to-ignore.
    logout: () => `${BASE}/auth/logout`, // POST

    // ASSUMPTION: pins are a REST resource scoped to the signed-in user
    // via the auth token; the server is assumed to only return/accept
    // pins belonging to the caller.
    pins: () => `${BASE}/pins`, // GET (list mine), POST (create)
    pin: (id) => `${BASE}/pins/${encodeURIComponent(id)}`, // DELETE

    // ASSUMPTION: admin-only route returning all registered users.
    // ASSUMPTION: the server itself enforces that only an admin may call
    // this; the client only hides the UI entry point for non-admins.
    adminUsers: () => `${BASE}/admin/users`, // GET
  };

  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  function setSession(token, user) {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
  }

  function getCachedUser() {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  /**
   * Extracts a human readable message from an error response body.
   * ASSUMPTION: server error responses look like { "error": "message" }.
   * We also fall back to a couple of other common shapes ({message},
   * plain string, or nothing at all) so the UI degrades gracefully
   * regardless of which shape the real backend actually uses.
   */
  function extractErrorMessage(body, fallback) {
    if (!body) return fallback;
    if (typeof body === 'string') return body || fallback;
    if (body.error && typeof body.error === 'string') return body.error;
    if (body.message && typeof body.message === 'string') return body.message;
    if (Array.isArray(body.errors) && body.errors.length) {
      return body.errors.map((e) => (typeof e === 'string' ? e : e.message)).join(', ');
    }
    return fallback;
  }

  async function request(url, { method = 'GET', body, auth = true } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (auth) {
      const token = getToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;
    }

    let res;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (networkErr) {
      // Server unreachable / offline / CORS / DNS failure, etc.
      const err = new Error(
        'Could not reach the server. Please check that it is running and try again.'
      );
      err.isNetworkError = true;
      throw err;
    }

    let data = null;
    const text = await res.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (e) {
        data = text;
      }
    }

    if (!res.ok) {
      const message = extractErrorMessage(data, `Request failed (${res.status})`);
      const err = new Error(message);
      err.status = res.status;
      err.body = data;
      throw err;
    }

    return data;
  }

  return {
    ENDPOINTS,
    getToken,
    setSession,
    getCachedUser,
    clearSession,

    async register({ name, email, password }) {
      // ASSUMPTION: response shape { token, user: { id, name, email, isAdmin } }
      const data = await request(ENDPOINTS.register(), {
        method: 'POST',
        body: { name, email, password },
        auth: false,
      });
      return data;
    },

    async login({ email, password }) {
      // ASSUMPTION: response shape { token, user: { id, name, email, isAdmin } }
      const data = await request(ENDPOINTS.login(), {
        method: 'POST',
        body: { email, password },
        auth: false,
      });
      return data;
    },

    async fetchMe() {
      // ASSUMPTION: response shape { id, name, email, isAdmin }
      // (some backends wrap this as { user: {...} }; we defensively
      // unwrap both shapes in auth.js)
      return request(ENDPOINTS.me(), { method: 'GET' });
    },

    async logout() {
      try {
        await request(ENDPOINTS.logout(), { method: 'POST' });
      } catch (e) {
        // ignore - logout is best-effort server-side; we always clear
        // local state regardless.
      }
    },

    async listPins() {
      // ASSUMPTION: response is a bare array of pin objects:
      // [{ id, name, lat, lng, date, note }, ...]
      // (if the real API wraps it as { pins: [...] } we unwrap that too)
      const data = await request(ENDPOINTS.pins(), { method: 'GET' });
      if (Array.isArray(data)) return data;
      if (data && Array.isArray(data.pins)) return data.pins;
      return [];
    },

    async createPin({ name, lat, lng, date, note }) {
      // ASSUMPTION: request body field names are name/lat/lng/date/note,
      // and the server derives the owning user from the auth token
      // (no userId sent from the client).
      return request(ENDPOINTS.pins(), {
        method: 'POST',
        body: { name, lat, lng, date, note },
      });
    },

    async deletePin(id) {
      return request(ENDPOINTS.pin(id), { method: 'DELETE' });
    },

    async listUsers() {
      // ASSUMPTION: response is a bare array of user objects:
      // [{ id, name, email, isAdmin, createdAt }, ...]
      const data = await request(ENDPOINTS.adminUsers(), { method: 'GET' });
      if (Array.isArray(data)) return data;
      if (data && Array.isArray(data.users)) return data.users;
      return [];
    },
  };
})();
