// app.js — view routing and orchestration, wiring api.js/auth.js/map.js/admin.js
// together with the DOM.

(() => {
  const views = {
    signin: document.getElementById('view-signin'),
    register: document.getElementById('view-register'),
    map: document.getElementById('view-map'),
    admin: document.getElementById('view-admin'),
  };
  const header = document.getElementById('app-header');
  const navMap = document.getElementById('nav-map');
  const navAdmin = document.getElementById('nav-admin');
  const currentUserEmailEl = document.getElementById('current-user-email');

  let pinsCache = [];
  let editingPinId = null;

  // ---------------- Toast ----------------
  let toastTimer = null;
  function showToast(message, isError) {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.classList.remove('hidden');
    el.classList.toggle('toast--error', !!isError);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 4000);
  }

  // ---------------- View routing ----------------
  function showView(name) {
    Object.entries(views).forEach(([key, el]) => {
      el.classList.toggle('hidden', key !== name);
    });

    const signedIn = name === 'map' || name === 'admin';
    header.classList.toggle('hidden', !signedIn);

    navMap.classList.toggle('nav-link--active', name === 'map');
    navAdmin.classList.toggle('nav-link--active', name === 'admin');

    if (name === 'map') {
      loadPins();
    }
    if (name === 'admin') {
      loadUsers();
    }
  }

  function refreshHeaderForUser(user) {
    if (!user) return;
    currentUserEmailEl.textContent = user.email || '';
    navAdmin.classList.toggle('hidden', !WaypointAuth.isAdmin(user));
  }

  function handleUnauthorized() {
    WaypointAuth.signOut();
    WaypointMap.clearMarkers();
    pinsCache = [];
    renderPinList(pinsCache);
    showToast('Session expired. Please sign in again.', true);
    showView('signin');
  }
  WaypointAPI.setUnauthorizedHandler(handleUnauthorized);

  // ---------------- Sign in / Register ----------------
  const formSignin = document.getElementById('form-signin');
  const signinError = document.getElementById('signin-error');
  const signinSubmit = document.getElementById('signin-submit');

  function setFieldError(el, message) {
    if (!message) {
      el.classList.add('hidden');
      el.textContent = '';
    } else {
      el.textContent = message;
      el.classList.remove('hidden');
    }
  }

  formSignin.addEventListener('submit', async (e) => {
    e.preventDefault();
    setFieldError(signinError, null);
    const email = document.getElementById('signin-email').value.trim();
    const password = document.getElementById('signin-password').value;

    signinSubmit.disabled = true;
    signinSubmit.textContent = 'Signing in…';
    try {
      const result = await WaypointAPI.login(email, password);
      WaypointAPI.setToken(result.token);
      WaypointAuth.setCurrentUser(result.user);
      refreshHeaderForUser(result.user);
      formSignin.reset();
      showView('map');
    } catch (err) {
      setFieldError(signinError, err.message || 'Sign in failed.');
    } finally {
      signinSubmit.disabled = false;
      signinSubmit.textContent = 'Sign in';
    }
  });

  const formRegister = document.getElementById('form-register');
  const registerError = document.getElementById('register-error');
  const registerSubmit = document.getElementById('register-submit');

  formRegister.addEventListener('submit', async (e) => {
    e.preventDefault();
    setFieldError(registerError, null);
    const email = document.getElementById('register-email').value.trim();
    const password = document.getElementById('register-password').value;

    registerSubmit.disabled = true;
    registerSubmit.textContent = 'Creating account…';
    try {
      // 201 always includes { token, user } — sign the user straight in.
      const result = await WaypointAPI.register(email, password);
      WaypointAPI.setToken(result.token);
      WaypointAuth.setCurrentUser(result.user);
      refreshHeaderForUser(result.user);
      formRegister.reset();
      showToast('Account created.');
      showView('map');
    } catch (err) {
      setFieldError(registerError, err.message || 'Registration failed.');
    } finally {
      registerSubmit.disabled = false;
      registerSubmit.textContent = 'Create account';
    }
  });

  document.getElementById('go-register').addEventListener('click', () => showView('register'));
  document.getElementById('go-signin').addEventListener('click', () => showView('signin'));

  document.getElementById('btn-sign-out').addEventListener('click', async () => {
    // Best-effort server-side revocation; sign out locally regardless of
    // whether the network call succeeds (e.g. already-expired token).
    try {
      await WaypointAPI.logout();
    } catch (err) {
      // ignore — we're signing out either way
    }
    WaypointAuth.signOut();
    // Reset map/pin UI state so nothing from this session (open popups,
    // markers) is left over if a different user signs in next.
    WaypointMap.clearMarkers();
    pinsCache = [];
    renderPinList(pinsCache);
    showView('signin');
  });

  navMap.addEventListener('click', () => showView('map'));
  navAdmin.addEventListener('click', () => showView('admin'));

  // ---------------- Pin list (sidebar) ----------------
  const pinListEl = document.getElementById('pin-list');
  const pinListStatusEl = document.getElementById('pin-list-status');

  function renderPinList(pins) {
    pinListEl.innerHTML = '';
    if (!pins || pins.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'pin-list__empty';
      empty.textContent = 'No pins yet — click the map to add one.';
      pinListEl.appendChild(empty);
      return;
    }
    const sorted = [...pins].sort((a, b) => {
      const da = new Date(a.visited_on || 0).getTime();
      const db = new Date(b.visited_on || 0).getTime();
      return da - db;
    });
    sorted.forEach((pin) => {
      const li = document.createElement('li');
      li.className = 'pin-list__item';

      const placeEl = document.createElement('div');
      placeEl.className = 'pin-list__place';
      placeEl.textContent = pin.place_name; // textContent — never interpreted as markup

      const dateEl = document.createElement('div');
      dateEl.className = 'pin-list__date';
      dateEl.textContent = pin.visited_on;

      li.append(placeEl, dateEl);
      li.addEventListener('click', () => WaypointMap.panTo(pin));
      pinListEl.appendChild(li);
    });
  }

  async function loadPins() {
    pinListStatusEl.textContent = 'Loading pins…';
    pinListStatusEl.classList.remove('error');
    try {
      const pins = await WaypointAPI.listPins();
      pinsCache = pins || [];
      renderPinList(pinsCache);
      WaypointMap.renderPins(pinsCache);
      pinListStatusEl.textContent = '';
    } catch (err) {
      if (err.status === 401) return; // handled by unauthorized handler
      pinListStatusEl.textContent = err.message || 'Could not load pins.';
      pinListStatusEl.classList.add('error');
      showToast(err.message || 'Could not load pins.', true);
    }
  }

  // ---------------- Add / edit pin modal ----------------
  const pinModal = document.getElementById('pin-modal');
  const pinModalTitle = document.getElementById('pin-modal-title');
  const formPin = document.getElementById('form-pin');
  const pinFormError = document.getElementById('pin-form-error');
  const pinDeleteBtn = document.getElementById('pin-delete');
  const pinSubmitBtn = document.getElementById('pin-submit');

  function openPinModal({ mode, pin, lat, lng }) {
    setFieldError(pinFormError, null);
    formPin.reset();
    editingPinId = null;

    if (mode === 'edit' && pin) {
      pinModalTitle.textContent = 'Edit pin';
      editingPinId = pin.id;
      document.getElementById('pin-id').value = pin.id;
      document.getElementById('pin-lat').value = pin.latitude;
      document.getElementById('pin-lng').value = pin.longitude;
      document.getElementById('pin-place').value = pin.place_name || '';
      document.getElementById('pin-date').value = (pin.visited_on || '').slice(0, 10);
      document.getElementById('pin-note').value = pin.note || '';
      pinDeleteBtn.classList.remove('hidden');
    } else {
      pinModalTitle.textContent = 'Add pin';
      document.getElementById('pin-lat').value = lat;
      document.getElementById('pin-lng').value = lng;
      pinDeleteBtn.classList.add('hidden');
    }

    pinModal.classList.remove('hidden');
    document.getElementById('pin-place').focus();
  }

  function closePinModal() {
    pinModal.classList.add('hidden');
    editingPinId = null;
  }

  document.getElementById('pin-modal-close').addEventListener('click', closePinModal);
  document.getElementById('pin-cancel').addEventListener('click', closePinModal);
  pinModal.addEventListener('click', (e) => {
    if (e.target === pinModal) closePinModal();
  });

  document.getElementById('btn-add-pin').addEventListener('click', () => {
    const center = WaypointMap.currentCenter ? WaypointMap.currentCenter() : { lat: 20, lng: 0 };
    openPinModal({ mode: 'add', lat: center.lat, lng: center.lng });
  });

  formPin.addEventListener('submit', async (e) => {
    e.preventDefault();
    setFieldError(pinFormError, null);

    const noteValue = document.getElementById('pin-note').value.trim();
    const payload = {
      place_name: document.getElementById('pin-place').value.trim(),
      visited_on: document.getElementById('pin-date').value,
      note: noteValue === '' ? null : noteValue,
      latitude: parseFloat(document.getElementById('pin-lat').value),
      longitude: parseFloat(document.getElementById('pin-lng').value),
    };

    pinSubmitBtn.disabled = true;
    pinSubmitBtn.textContent = 'Saving…';
    try {
      let pin;
      if (editingPinId) {
        pin = await WaypointAPI.updatePin(editingPinId, payload);
      } else {
        pin = await WaypointAPI.createPin(payload);
      }
      WaypointMap.addOrUpdateMarker(pin);
      await loadPins();
      closePinModal();
      showToast('Pin saved.');
    } catch (err) {
      setFieldError(pinFormError, err.message || 'Could not save pin.');
    } finally {
      pinSubmitBtn.disabled = false;
      pinSubmitBtn.textContent = 'Save pin';
    }
  });

  pinDeleteBtn.addEventListener('click', async () => {
    if (!editingPinId) return;
    if (!confirm('Delete this pin?')) return;
    try {
      await WaypointAPI.deletePin(editingPinId);
      WaypointMap.removeMarker(editingPinId);
      await loadPins();
      closePinModal();
      showToast('Pin deleted.');
    } catch (err) {
      setFieldError(pinFormError, err.message || 'Could not delete pin.');
    }
  });

  async function handleMarkerAction(action, pin) {
    if (action === 'edit') {
      WaypointMap.hidePopup();
      openPinModal({ mode: 'edit', pin });
      return;
    }
    if (action === 'delete') {
      if (!confirm('Delete this pin?')) return;
      try {
        await WaypointAPI.deletePin(pin.id);
        WaypointMap.removeMarker(pin.id);
        await loadPins();
        showToast('Pin deleted.');
      } catch (err) {
        showToast(err.message || 'Could not delete pin.', true);
      }
    }
  }

  function handleMapClick(lat, lng) {
    WaypointMap.hidePopup();
    openPinModal({ mode: 'add', lat, lng });
  }

  // ---------------- Admin (users) ----------------
  const adminStatusEl = document.getElementById('admin-status');
  const adminTableBody = document.getElementById('admin-table-body');

  async function loadUsers() {
    adminStatusEl.textContent = 'Loading users…';
    adminStatusEl.classList.remove('error');
    try {
      const users = await WaypointAPI.listUsers();
      WaypointAdmin.render(adminTableBody, users);
      adminStatusEl.textContent = '';
    } catch (err) {
      if (err.status === 401) return;
      if (err.status === 403) {
        adminStatusEl.textContent = 'You do not have permission to view this page.';
        adminStatusEl.classList.add('error');
        return;
      }
      adminStatusEl.textContent = err.message || 'Could not load users.';
      adminStatusEl.classList.add('error');
    }
  }

  // ---------------- Init ----------------
  async function boot() {
    // Map init fetches the bundled SVG asset — wait for it so that if the
    // map view is shown immediately (already-signed-in user), pins have
    // somewhere to render into.
    await WaypointMap.init({
      mapClick: handleMapClick,
      markerAction: handleMarkerAction,
    });

    const existingUser = WaypointAuth.getCurrentUser();
    const existingToken = WaypointAPI.getToken();
    if (existingUser && existingToken) {
      refreshHeaderForUser(existingUser);
      showView('map');
    } else {
      showView('signin');
    }
  }
  boot();
})();
