(async function () {
  const user = await Auth.requireAuth();
  if (!user) return; // requireAuth already redirected to login
  Auth.initHeader(user);

  const pageError = document.getElementById('page-error');
  const mapContainer = document.getElementById('map-container');
  const form = document.getElementById('pin-form');
  const formError = document.getElementById('pin-form-error');
  const submitBtn = document.getElementById('pin-submit');
  const cancelBtn = document.getElementById('pin-cancel');
  const pinList = document.getElementById('pin-list');
  const pinsStatus = document.getElementById('pins-status');
  const pinEmpty = document.getElementById('pin-empty');

  let pins = [];
  let map = null;

  function showPageError(message) {
    pageError.textContent = message;
    pageError.classList.add('show');
  }
  function hidePageError() {
    pageError.classList.remove('show');
  }
  function showFormError(message) {
    formError.textContent = message;
    formError.classList.add('show');
  }
  function hideFormError() {
    formError.classList.remove('show');
  }

  function formatDate(d) {
    if (!d) return '';
    // Accept either a plain YYYY-MM-DD or a full ISO timestamp.
    return String(d).slice(0, 10);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function renderPinList() {
    pinList.innerHTML = '';
    if (!pins.length) {
      pinEmpty.style.display = '';
      return;
    }
    pinEmpty.style.display = 'none';

    const sorted = [...pins].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

    sorted.forEach((pin) => {
      const li = document.createElement('li');
      li.className = 'pin-item';
      li.innerHTML = `
        <div class="pin-item-head">
          <span class="pin-item-name">${escapeHtml(pin.name || 'Unnamed place')}</span>
          <span class="pin-item-date">${escapeHtml(formatDate(pin.date))}</span>
        </div>
        <div class="pin-item-coords">${Number(pin.lat).toFixed(3)}, ${Number(pin.lng).toFixed(3)}</div>
        ${pin.note ? `<div class="pin-item-note">${escapeHtml(pin.note)}</div>` : ''}
        <div class="pin-item-actions">
          <button type="button" class="danger" data-delete-id="${escapeHtml(pin.id)}">Delete</button>
        </div>
      `;
      pinList.appendChild(li);
    });

    pinList.querySelectorAll('[data-delete-id]').forEach((btn) => {
      btn.addEventListener('click', () => handleDelete(btn.getAttribute('data-delete-id')));
    });
  }

  function renderMapPins() {
    if (map) map.renderPins(pins);
  }

  async function loadPins() {
    hidePageError();
    pinsStatus.style.display = '';
    try {
      pins = await API.listPins();
    } catch (err) {
      pins = [];
      showPageError(err.message || 'Could not load your pins.');
    } finally {
      pinsStatus.style.display = 'none';
      renderPinList();
      renderMapPins();
    }
  }

  async function handleDelete(id) {
    if (!id) return;
    if (!window.confirm('Delete this pin?')) return;
    try {
      await API.deletePin(id);
      pins = pins.filter((p) => String(p.id) !== String(id));
      renderPinList();
      renderMapPins();
    } catch (err) {
      showPageError(err.message || 'Could not delete that pin.');
    }
  }

  function fillCoordsFromClick(lat, lon) {
    document.getElementById('pin-lat').value = lat.toFixed(5);
    document.getElementById('pin-lng').value = lon.toFixed(5);
    if (map) map.setDraftMarker(lat, lon);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideFormError();

    const name = form.name.value.trim();
    const lat = parseFloat(form.lat.value);
    const lng = parseFloat(form.lng.value);
    const date = form.date.value;
    const note = form.note.value.trim();

    if (!name) return showFormError('Please give this place a name.');
    if (Number.isNaN(lat) || lat < -90 || lat > 90) return showFormError('Latitude must be between -90 and 90.');
    if (Number.isNaN(lng) || lng < -180 || lng > 180) return showFormError('Longitude must be between -180 and 180.');
    if (!date) return showFormError('Please choose a date of visit.');

    submitBtn.disabled = true;
    submitBtn.textContent = 'Adding…';
    try {
      const created = await API.createPin({ name, lat, lng, date, note });
      pins.push(created && created.id ? created : { id: `local-${Date.now()}`, name, lat, lng, date, note });
      renderPinList();
      renderMapPins();
      form.reset();
      if (map) map.clearDraftMarker();
    } catch (err) {
      showFormError(err.message || 'Could not add this pin.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Add pin';
    }
  });

  cancelBtn.addEventListener('click', () => {
    form.reset();
    hideFormError();
    if (map) map.clearDraftMarker();
  });

  try {
    map = await WorldMap.init(mapContainer, {
      onMapClick: fillCoordsFromClick,
      onPinClick: (pin) => {
        window.alert(
          `${pin.name || 'Unnamed place'}\n${formatDate(pin.date)}\n\n${pin.note || ''}`
        );
      },
    });
  } catch (err) {
    showPageError('Could not load the map image.');
  }

  await loadPins();
})();
