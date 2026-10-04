// api.js — thin fetch wrapper around the Waypoint backend.
// Endpoint paths and field names below are sourced from round-3/API.md
// (written by the backend teammate). Do not change these without
// re-checking that file.

const WaypointAPI = (() => {
  const TOKEN_KEY = 'waypoint_token';

  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  function setToken(token) {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  }

  function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
  }

  // Called by app.js on 401 to force sign-out + redirect.
  let onUnauthorized = null;
  function setUnauthorizedHandler(fn) {
    onUnauthorized = fn;
  }

  async function request(path, { method = 'GET', body, auth = true } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (auth) {
      const token = getToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;
    }

    let res;
    try {
      res = await fetch(path, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new ApiError('Network error — is the server reachable?', 0, null);
    }

    let data = null;
    const text = await res.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (e) {
        data = null;
      }
    }

    // A 401 on an *authenticated* request means the session is invalid/
    // expired -> force sign-out. A 401 from login itself (auth: false) is
    // just "wrong email or password" and should surface as a normal
    // inline error instead.
    if (res.status === 401 && auth) {
      if (onUnauthorized) onUnauthorized();
      throw new ApiError('Session expired. Please sign in again.', 401, data);
    }

    if (!res.ok) {
      const message = (data && (data.error || data.message)) || `Request failed (${res.status})`;
      throw new ApiError(message, res.status, data);
    }

    return data;
  }

  class ApiError extends Error {
    constructor(message, status, data) {
      super(message);
      this.status = status;
      this.data = data;
    }
  }

  // ---- Auth ----
  // register/login return { token, user } at the top level (no wrapper).
  function register(email, password) {
    return request('/api/auth/register', { method: 'POST', body: { email, password }, auth: false });
  }

  function login(email, password) {
    return request('/api/auth/login', { method: 'POST', body: { email, password }, auth: false });
  }

  function logout() {
    return request('/api/auth/logout', { method: 'POST' });
  }

  function me() {
    return request('/api/auth/me', { method: 'GET' }).then((data) => data.user);
  }

  // ---- Pins ----
  // Field names match API.md exactly: place_name, latitude, longitude,
  // visited_on, note. Responses are wrapped in { pin } / { pins }.
  function listPins() {
    return request('/api/pins', { method: 'GET' }).then((data) => data.pins);
  }

  function createPin(pin) {
    return request('/api/pins', { method: 'POST', body: pin }).then((data) => data.pin);
  }

  function updatePin(id, pin) {
    return request(`/api/pins/${id}`, { method: 'PUT', body: pin }).then((data) => data.pin);
  }

  function deletePin(id) {
    return request(`/api/pins/${id}`, { method: 'DELETE' });
  }

  // ---- Admin ----
  function listUsers() {
    return request('/api/admin/users', { method: 'GET' }).then((data) => data.users);
  }

  return {
    ApiError,
    getToken,
    setToken,
    clearToken,
    setUnauthorizedHandler,
    register,
    login,
    logout,
    me,
    listPins,
    createPin,
    updatePin,
    deletePin,
    listUsers,
  };
})();
