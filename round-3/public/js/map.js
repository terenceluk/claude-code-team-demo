// map.js — bundled offline SVG world map and marker management.
// No external tiles, no CDN, no network access at runtime beyond the
// same-origin fetch of the bundled assets/world-map.svg file.
//
// Projection: equirectangular (plate carrée), matching assets/world-map.svg
// exactly (viewBox "0 0 1000 500"):
//   x = (lon + 180) / 360 * 1000
//   y = (90 - lat)  / 180 * 500
// and inverted for click-to-place:
//   lon = x / 1000 * 360 - 180
//   lat = 90 - y / 500 * 180

const WaypointMap = (() => {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const MAP_W = 1000;
  const MAP_H = 500;

  let svgRoot = null;
  let pinsLayer = null;
  let markers = new Map(); // pinId -> SVGCircleElement
  let onMapClick = null; // callback(lat, lng)
  let onMarkerAction = null; // callback(action, pin) where action = 'edit' | 'delete'
  let pinsById = new Map(); // pinId -> pin data, for popup lookups

  function project(lat, lng) {
    const x = (lng + 180) / 360 * MAP_W;
    const y = (90 - lat) / 180 * MAP_H;
    return [x, y];
  }

  function unproject(x, y) {
    const lng = (x / MAP_W) * 360 - 180;
    const lat = 90 - (y / MAP_H) * 180;
    return [
      Math.max(-90, Math.min(90, lat)),
      Math.max(-180, Math.min(180, lng)),
    ];
  }

  // Converts a mouse/pointer client position to local SVG user-space
  // coordinates (the same 0-1000 x 0-500 space the projection uses),
  // accounting for however the viewBox is currently scaled on screen.
  function clientToSvgPoint(clientX, clientY) {
    if (!svgRoot) return null;
    const ctm = svgRoot.getScreenCTM();
    if (!ctm) return null;
    const pt = svgRoot.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    return pt.matrixTransform(ctm.inverse());
  }

  async function init({ mapClick, markerAction }) {
    onMapClick = mapClick;
    onMarkerAction = markerAction;

    const wrap = document.getElementById('svg-map-wrap');
    const loadingEl = document.getElementById('map-loading');

    let svgText;
    try {
      const res = await fetch('assets/world-map.svg');
      if (!res.ok) throw new Error(`status ${res.status}`);
      svgText = await res.text();
    } catch (err) {
      if (loadingEl) loadingEl.textContent = 'Could not load the map. Try reloading the page.';
      return;
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, 'image/svg+xml');
    const parsedSvg = doc.documentElement;
    if (!parsedSvg || parsedSvg.nodeName !== 'svg') {
      if (loadingEl) loadingEl.textContent = 'Map file could not be parsed.';
      return;
    }

    if (loadingEl) loadingEl.remove();

    svgRoot = parsedSvg;
    svgRoot.setAttribute('id', 'world-map');
    svgRoot.setAttribute('role', 'img');
    svgRoot.setAttribute('aria-label', 'World map with your travel pins');
    wrap.appendChild(svgRoot);

    pinsLayer = document.createElementNS(SVG_NS, 'g');
    pinsLayer.setAttribute('id', 'pins-layer');
    svgRoot.appendChild(pinsLayer);

    svgRoot.addEventListener('click', (e) => {
      // Ignore clicks that landed on a pin marker itself — those are
      // handled by the marker's own click handler.
      if (e.target.closest && e.target.closest('.pin-marker')) return;
      const pt = clientToSvgPoint(e.clientX, e.clientY);
      if (!pt) return;
      const [lat, lng] = unproject(pt.x, pt.y);
      if (onMapClick) onMapClick(lat, lng);
    });
  }

  function markerId(pin) {
    return `pin-marker-${pin.id}`;
  }

  function buildMarker(pin) {
    const [x, y] = project(pin.latitude, pin.longitude);
    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('id', markerId(pin));
    circle.setAttribute('class', 'pin-marker');
    circle.setAttribute('cx', x);
    circle.setAttribute('cy', y);
    circle.setAttribute('r', 6);
    circle.setAttribute('tabindex', '0');
    circle.setAttribute('role', 'button');
    circle.setAttribute('aria-label', `${pin.place_name}, visited ${pin.visited_on}`);

    const activate = (e) => {
      e.stopPropagation();
      showPopup(pin.id);
    };
    circle.addEventListener('click', activate);
    circle.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activate(e);
      }
    });

    return circle;
  }

  function addOrUpdateMarker(pin) {
    pinsById.set(pin.id, pin);
    const existing = markers.get(pin.id);
    if (existing) {
      const [x, y] = project(pin.latitude, pin.longitude);
      existing.setAttribute('cx', x);
      existing.setAttribute('cy', y);
      existing.setAttribute('aria-label', `${pin.place_name}, visited ${pin.visited_on}`);
      if (popupState.openPinId === pin.id) renderPopupContent(pin);
      return existing;
    }
    const marker = buildMarker(pin);
    pinsLayer.appendChild(marker);
    markers.set(pin.id, marker);
    return marker;
  }

  function removeMarker(pinId) {
    const marker = markers.get(pinId);
    if (marker) {
      marker.remove();
      markers.delete(pinId);
    }
    pinsById.delete(pinId);
    if (popupState.openPinId === pinId) hidePopup();
  }

  function clearMarkers() {
    markers.forEach((marker) => marker.remove());
    markers.clear();
    pinsById.clear();
    hidePopup();
  }

  function renderPins(pins) {
    const incomingIds = new Set(pins.map((p) => p.id));
    // Drop markers for pins that no longer exist.
    Array.from(markers.keys()).forEach((id) => {
      if (!incomingIds.has(id)) removeMarker(id);
    });
    pins.forEach((pin) => addOrUpdateMarker(pin));
  }

  // ---------------- Popup ----------------
  const popupState = { openPinId: null };
  const popupEl = document.getElementById('pin-popup');
  const popupPlaceEl = document.getElementById('pin-popup-place');
  const popupDateEl = document.getElementById('pin-popup-date');
  const popupNoteEl = document.getElementById('pin-popup-note');
  const popupEditBtn = document.getElementById('pin-popup-edit');
  const popupDeleteBtn = document.getElementById('pin-popup-delete');
  const popupCloseBtn = document.getElementById('pin-popup-close');

  function renderPopupContent(pin) {
    // textContent (not innerHTML) so user-supplied place name / note can
    // never be interpreted as markup.
    popupPlaceEl.textContent = pin.place_name;
    popupDateEl.textContent = pin.visited_on;
    popupNoteEl.textContent = pin.note || '';
    popupNoteEl.classList.toggle('hidden', !pin.note);
  }

  const MARGIN = 10; // keep the popup this far from the map container's edges

  function positionPopup(marker) {
    // popupEl is absolutely positioned relative to .map-container (the
    // nearest positioned ancestor).
    const container = document.querySelector('.map-container');
    const containerRect = container.getBoundingClientRect();
    const markerRect = marker.getBoundingClientRect();
    const markerX = markerRect.left - containerRect.left + markerRect.width / 2;
    const markerY = markerRect.top - containerRect.top;

    // Measure the popup itself (must be visible to have real dimensions).
    popupEl.classList.remove('hidden');
    const popupW = popupEl.offsetWidth;
    const popupH = popupEl.offsetHeight;

    // Horizontal: center on the marker, then clamp within the container
    // so the box never runs off either edge.
    let left = markerX - popupW / 2;
    left = Math.max(MARGIN, Math.min(left, containerRect.width - popupW - MARGIN));

    // Vertical: prefer above the marker (arrow pointing down); flip below
    // it if there isn't room above.
    const gap = 14;
    let top = markerY - popupH - gap;
    let flipped = false;
    if (top < MARGIN) {
      top = markerY + gap + 12; // +12 clears the marker's own radius
      flipped = true;
    }

    // Keep the little arrow visually pointing at the marker even though
    // the box itself may have been shifted to stay on-screen.
    let arrowX = markerX - left;
    arrowX = Math.max(16, Math.min(arrowX, popupW - 16));

    popupEl.style.left = `${left}px`;
    popupEl.style.top = `${top}px`;
    popupEl.style.setProperty('--arrow-x', `${arrowX}px`);
    popupEl.classList.toggle('pin-popup--flipped', flipped);
  }

  function showPopup(pinId) {
    const pin = pinsById.get(pinId);
    const marker = markers.get(pinId);
    if (!pin || !marker) return;
    popupState.openPinId = pinId;
    renderPopupContent(pin);
    positionPopup(marker);
    popupEl.classList.remove('hidden');
    markers.forEach((m) => m.classList.remove('pin-marker--active'));
    marker.classList.add('pin-marker--active');

    popupEditBtn.onclick = () => {
      if (onMarkerAction) onMarkerAction('edit', pin);
    };
    popupDeleteBtn.onclick = () => {
      if (onMarkerAction) onMarkerAction('delete', pin);
    };
  }

  function hidePopup() {
    popupState.openPinId = null;
    popupEl.classList.add('hidden');
    markers.forEach((m) => m.classList.remove('pin-marker--active'));
  }

  popupCloseBtn.addEventListener('click', hidePopup);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && popupState.openPinId != null) hidePopup();
  });
  window.addEventListener('resize', () => {
    if (popupState.openPinId == null) return;
    const marker = markers.get(popupState.openPinId);
    if (marker) positionPopup(marker);
  });

  // "Pan to" a pin: the whole world is always visible on this map (no
  // tile-based panning/zooming needed), so panning is expressed as
  // opening the pin's popup and briefly pulsing its marker to draw the
  // eye to it.
  function panTo(pin) {
    const marker = markers.get(pin.id);
    if (!marker) return;
    showPopup(pin.id);
    marker.classList.remove('pin-marker--pulse');
    // Force reflow so the animation can be retriggered on repeat clicks.
    void marker.getBoundingClientRect();
    marker.classList.add('pin-marker--pulse');
  }

  function currentCenter() {
    // No pan/zoom state to track — default new pins to the map's center
    // (lat 0, lng 0) when added via the "+ Add pin" button.
    return { lat: 0, lng: 0 };
  }

  return {
    init,
    currentCenter,
    renderPins,
    addOrUpdateMarker,
    removeMarker,
    clearMarkers,
    panTo,
    hidePopup,
  };
})();
