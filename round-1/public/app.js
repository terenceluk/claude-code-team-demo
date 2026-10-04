'use strict';

/*
 * Waypoint frontend - vanilla JS, no build step, no external libraries.
 *
 * Lat/lon <-> pixel projection (must match the comment in world.svg):
 *
 *   x = (longitude + 180) / 360 * WIDTH
 *   y = (90 - latitude)   / 180 * HEIGHT
 *
 * Since the map is rendered at a fixed 2:1 aspect ratio (see .map-container
 * in styles.css, `aspect-ratio: 2 / 1`) and the SVG's viewBox is 1000x500
 * (also 2:1), the pixel width/height of the rendered <img> always maps 1:1
 * in proportion to the SVG viewBox, so we can work entirely in fractions
 * (0..1) of the rendered element's bounding box instead of carrying the
 * 1000x500 constants around:
 *
 *   xFrac = (longitude + 180) / 360
 *   yFrac = (90 - latitude) / 180
 *
 * and the inverse, used to turn a mouse click into a lat/lon:
 *
 *   longitude = xFrac * 360 - 180
 *   latitude  = 90 - yFrac * 180
 */

function lonLatToFrac(lon, lat) {
  return {
    xFrac: (lon + 180) / 360,
    yFrac: (90 - lat) / 180,
  };
}

function fracToLonLat(xFrac, yFrac) {
  return {
    lon: xFrac * 360 - 180,
    lat: 90 - yFrac * 180,
  };
}

// ---------------------------------------------------------------------------
// API helper
// ---------------------------------------------------------------------------

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    method: options.method || 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (e) {
      data = null;
    }
  }

  if (!res.ok) {
    const code = data && data.error ? data.error.code : 'UNKNOWN_ERROR';
    const message = data && data.error ? data.error.message : `Request failed with status ${res.status}`;
    const err = new ApiError(res.status, code, message);
    // A 401 on a login/register attempt just means "wrong credentials" /
    // "not signed in yet" - not an expired session - so it's handled
    // locally by the calling form and must not trigger the global
    // "drop back to sign-in" flow (options.skipAuthRedirect).
    if (res.status === 401 && !options.skipAuthRedirect) {
      handleUnauthenticated();
    }
    throw err;
  }

  return data;
}

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------

const state = {
  user: null,
  pins: [],
  pendingLatLon: null, // { lat, lon } from a map click, staged into the form
};

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const el = {
  header: document.getElementById('app-header'),
  navMapBtn: document.getElementById('nav-map-btn'),
  navAdminBtn: document.getElementById('nav-admin-btn'),
  currentUserEmail: document.getElementById('current-user-email'),
  logoutBtn: document.getElementById('logout-btn'),

  screens: {
    signin: document.getElementById('screen-signin'),
    register: document.getElementById('screen-register'),
    map: document.getElementById('screen-map'),
    admin: document.getElementById('screen-admin'),
  },

  signinForm: document.getElementById('signin-form'),
  signinEmail: document.getElementById('signin-email'),
  signinPassword: document.getElementById('signin-password'),
  signinError: document.getElementById('signin-error'),
  goToRegister: document.getElementById('go-to-register'),

  registerForm: document.getElementById('register-form'),
  registerEmail: document.getElementById('register-email'),
  registerPassword: document.getElementById('register-password'),
  registerError: document.getElementById('register-error'),
  goToSignin: document.getElementById('go-to-signin'),

  mapContainer: document.getElementById('map-container'),
  mapImg: document.getElementById('world-map-img'),
  pinLayer: document.getElementById('pin-layer'),

  addPinForm: document.getElementById('add-pin-form'),
  pinLat: document.getElementById('pin-lat'),
  pinLon: document.getElementById('pin-lon'),
  pinPlace: document.getElementById('pin-place'),
  pinDate: document.getElementById('pin-date'),
  pinNote: document.getElementById('pin-note'),
  addPinError: document.getElementById('add-pin-error'),

  pinList: document.getElementById('pin-list'),
  pinListEmpty: document.getElementById('pin-list-empty'),

  adminUserList: document.getElementById('admin-user-list'),
  adminError: document.getElementById('admin-error'),

  toast: document.getElementById('toast'),
};

// ---------------------------------------------------------------------------
// Screen / navigation helpers
// ---------------------------------------------------------------------------

function showScreen(name) {
  Object.entries(el.screens).forEach(([key, node]) => {
    node.classList.toggle('hidden', key !== name);
  });
  el.navMapBtn.classList.toggle('active', name === 'map');
  el.navAdminBtn.classList.toggle('active', name === 'admin');
}

function showToast(message, isError) {
  el.toast.textContent = message;
  el.toast.classList.remove('hidden');
  el.toast.classList.toggle('error', Boolean(isError));
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    el.toast.classList.add('hidden');
  }, 3500);
}

function setFormError(node, message) {
  if (message) {
    node.textContent = message;
    node.classList.remove('hidden');
  } else {
    node.textContent = '';
    node.classList.add('hidden');
  }
}

let unauthHandled = false;
function handleUnauthenticated() {
  if (unauthHandled) return;
  unauthHandled = true;
  state.user = null;
  state.pins = [];
  el.header.classList.add('hidden');
  showScreen('signin');
  setTimeout(() => {
    unauthHandled = false;
  }, 0);
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

async function refreshCurrentUser() {
  try {
    const data = await api('/api/auth/me', { skipAuthRedirect: true });
    state.user = data.user;
    return data.user;
  } catch (err) {
    state.user = null;
    return null;
  }
}

function applySignedInUi() {
  el.header.classList.remove('hidden');
  el.currentUserEmail.textContent = state.user.email;
  el.navAdminBtn.classList.toggle('hidden', !state.user.isAdmin);
}

async function enterAppSignedIn() {
  applySignedInUi();
  showScreen('map');
  await loadPins();
}

el.signinForm.addEventListener('submit', async (evt) => {
  evt.preventDefault();
  setFormError(el.signinError, '');
  const email = el.signinEmail.value.trim();
  const password = el.signinPassword.value;
  try {
    const data = await api('/api/auth/login', { method: 'POST', body: { email, password }, skipAuthRedirect: true });
    state.user = data.user;
    el.signinForm.reset();
    await enterAppSignedIn();
  } catch (err) {
    setFormError(el.signinError, err.message || 'Sign in failed.');
  }
});

el.registerForm.addEventListener('submit', async (evt) => {
  evt.preventDefault();
  setFormError(el.registerError, '');
  const email = el.registerEmail.value.trim();
  const password = el.registerPassword.value;
  try {
    const data = await api('/api/auth/register', { method: 'POST', body: { email, password } });
    state.user = data.user;
    el.registerForm.reset();
    await enterAppSignedIn();
  } catch (err) {
    setFormError(el.registerError, err.message || 'Registration failed.');
  }
});

el.goToRegister.addEventListener('click', () => {
  setFormError(el.signinError, '');
  showScreen('register');
});

el.goToSignin.addEventListener('click', () => {
  setFormError(el.registerError, '');
  showScreen('signin');
});

el.logoutBtn.addEventListener('click', async () => {
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } catch (err) {
    // Logout endpoint always succeeds per API.md; ignore network errors here.
  }
  state.user = null;
  state.pins = [];
  el.header.classList.add('hidden');
  showScreen('signin');
});

el.navMapBtn.addEventListener('click', () => {
  showScreen('map');
});

el.navAdminBtn.addEventListener('click', async () => {
  showScreen('admin');
  await loadAdminUsers();
});

// ---------------------------------------------------------------------------
// Map + pins
// ---------------------------------------------------------------------------

function clientEventToFrac(evt) {
  const rect = el.mapContainer.getBoundingClientRect();
  let xFrac = (evt.clientX - rect.left) / rect.width;
  let yFrac = (evt.clientY - rect.top) / rect.height;
  xFrac = Math.min(1, Math.max(0, xFrac));
  yFrac = Math.min(1, Math.max(0, yFrac));
  return { xFrac, yFrac };
}

el.mapContainer.addEventListener('click', (evt) => {
  // Ignore clicks that landed on an existing pin marker (handled separately).
  if (evt.target.closest('.map-pin')) return;
  const { xFrac, yFrac } = clientEventToFrac(evt);
  const { lon, lat } = fracToLonLat(xFrac, yFrac);
  el.pinLat.value = round4(lat);
  el.pinLon.value = round4(lon);
  state.pendingLatLon = { lat, lon };
  renderPendingMarker();
});

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

function renderPendingMarker() {
  let marker = el.pinLayer.querySelector('.map-pin.pending');
  if (!state.pendingLatLon) {
    if (marker) marker.remove();
    return;
  }
  if (!marker) {
    marker = buildPinMarkerNode();
    marker.classList.add('pending');
    el.pinLayer.appendChild(marker);
  }
  positionMarker(marker, state.pendingLatLon.lat, state.pendingLatLon.lon);
}

function buildPinMarkerNode() {
  const wrapper = document.createElement('div');
  wrapper.className = 'map-pin';
  wrapper.innerHTML =
    '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M12 0C7.6 0 4 3.6 4 8c0 6 8 16 8 16s8-10 8-16c0-4.4-3.6-8-8-8z" fill="#dc2626" stroke="#7f1d1d" stroke-width="1"/>' +
    '<circle cx="12" cy="8" r="3" fill="#fff"/>' +
    '</svg>';
  return wrapper;
}

function positionMarker(node, lat, lon) {
  const { xFrac, yFrac } = lonLatToFrac(lon, lat);
  node.style.left = `${xFrac * 100}%`;
  node.style.top = `${yFrac * 100}%`;
}

async function loadPins() {
  try {
    const data = await api('/api/pins');
    state.pins = data.pins;
    renderPins();
  } catch (err) {
    if (err.status !== 401) {
      showToast(err.message || 'Could not load pins.', true);
    }
  }
}

function renderPins() {
  // Markers
  el.pinLayer.querySelectorAll('.map-pin:not(.pending)').forEach((n) => n.remove());
  state.pins.forEach((pin) => {
    const node = buildPinMarkerNode();
    node.title = pin.placeName; // set via property, not innerHTML - safe from injection
    positionMarker(node, pin.latitude, pin.longitude);
    node.addEventListener('click', (evt) => {
      evt.stopPropagation();
      focusPinListItem(pin.id);
    });
    el.pinLayer.appendChild(node);
  });

  // List
  el.pinList.innerHTML = '';
  el.pinListEmpty.classList.toggle('hidden', state.pins.length > 0);
  state.pins.forEach((pin) => {
    el.pinList.appendChild(buildPinListItem(pin));
  });
}

function buildPinListItem(pin) {
  const li = document.createElement('li');
  li.className = 'pin-item';
  li.id = `pin-item-${pin.id}`;

  const header = document.createElement('div');
  header.className = 'pin-item-header';

  const titleWrap = document.createElement('div');
  const title = document.createElement('div');
  title.className = 'pin-item-title';
  title.textContent = pin.placeName; // text content only - never raw HTML
  titleWrap.appendChild(title);

  const meta = document.createElement('div');
  meta.className = 'pin-item-meta';
  meta.textContent = `${formatDate(pin.visitDate)} - ${pin.latitude.toFixed(4)}, ${pin.longitude.toFixed(4)}`;
  titleWrap.appendChild(meta);

  header.appendChild(titleWrap);

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'btn btn-danger';
  removeBtn.textContent = 'Remove';
  removeBtn.addEventListener('click', () => removePin(pin.id));
  header.appendChild(removeBtn);

  li.appendChild(header);

  if (pin.note) {
    const note = document.createElement('div');
    note.className = 'pin-item-note';
    note.textContent = pin.note; // text content only - never raw HTML
    li.appendChild(note);
  }

  return li;
}

function formatDate(raw) {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function focusPinListItem(pinId) {
  const node = document.getElementById(`pin-item-${pinId}`);
  if (node) {
    node.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    node.classList.add('pin-item-flash');
    setTimeout(() => node.classList.remove('pin-item-flash'), 800);
  }
}

el.addPinForm.addEventListener('submit', async (evt) => {
  evt.preventDefault();
  setFormError(el.addPinError, '');

  const latitude = Number(el.pinLat.value);
  const longitude = Number(el.pinLon.value);
  const placeName = el.pinPlace.value.trim();
  const visitDate = el.pinDate.value;
  const note = el.pinNote.value.trim();

  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    setFormError(el.addPinError, 'Latitude must be a number between -90 and 90.');
    return;
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    setFormError(el.addPinError, 'Longitude must be a number between -180 and 180.');
    return;
  }
  if (!placeName) {
    setFormError(el.addPinError, 'Place name is required.');
    return;
  }
  if (!visitDate) {
    setFormError(el.addPinError, 'Visit date is required.');
    return;
  }

  try {
    const body = { latitude, longitude, placeName, visitDate };
    if (note) body.note = note;
    const data = await api('/api/pins', { method: 'POST', body });
    state.pins = [data.pin, ...state.pins];
    renderPins();
    el.addPinForm.reset();
    state.pendingLatLon = null;
    renderPendingMarker();
    showToast('Pin added.');
  } catch (err) {
    if (err.status !== 401) {
      setFormError(el.addPinError, err.message || 'Could not add pin.');
    }
  }
});

async function removePin(pinId) {
  try {
    await api(`/api/pins/${pinId}`, { method: 'DELETE' });
    state.pins = state.pins.filter((p) => p.id !== pinId);
    renderPins();
    showToast('Pin removed.');
  } catch (err) {
    if (err.status !== 401) {
      showToast(err.message || 'Could not remove pin.', true);
    }
  }
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

async function loadAdminUsers() {
  setFormError(el.adminError, '');
  el.adminUserList.innerHTML = '';
  try {
    const data = await api('/api/admin/users');
    data.users.forEach((user) => {
      const tr = document.createElement('tr');

      const idCell = document.createElement('td');
      idCell.textContent = String(user.id);

      const emailCell = document.createElement('td');
      emailCell.textContent = user.email; // text content only - never raw HTML

      const adminCell = document.createElement('td');
      adminCell.textContent = user.isAdmin ? 'Yes' : 'No';

      const createdCell = document.createElement('td');
      createdCell.textContent = formatDate(user.createdAt);

      tr.appendChild(idCell);
      tr.appendChild(emailCell);
      tr.appendChild(adminCell);
      tr.appendChild(createdCell);
      el.adminUserList.appendChild(tr);
    });
  } catch (err) {
    if (err.status === 403) {
      setFormError(el.adminError, 'You do not have permission to view this page.');
    } else if (err.status !== 401) {
      setFormError(el.adminError, err.message || 'Could not load users.');
    }
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

(async function boot() {
  const user = await refreshCurrentUser();
  if (user) {
    await enterAppSignedIn();
  } else {
    el.header.classList.add('hidden');
    showScreen('signin');
  }
})();
