/**
 * map.js
 * Loads the bundled assets/world.svg, layers pin markers on top of it in
 * the *same* SVG coordinate space, and converts between latitude/longitude
 * and SVG x/y using a simple equirectangular projection (matching exactly
 * how assets/world.svg itself was generated).
 *
 * viewBox is 0 0 1000 500:
 *   x = (lon + 180) / 360 * 1000
 *   y = (90 - lat)  / 180 * 500
 */

const WorldMap = (function () {
  const VB_W = 1000;
  const VB_H = 500;
  const PIN_GROUP_ID = 'pins-layer';

  function lonLatToXY(lon, lat) {
    return {
      x: (lon + 180) / 360 * VB_W,
      y: (90 - lat) / 180 * VB_H,
    };
  }

  function xyToLonLat(x, y) {
    return {
      lon: (x / VB_W) * 360 - 180,
      lat: 90 - (y / VB_H) * 180,
    };
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  /**
   * @param {HTMLElement} container element the svg will be injected into
   * @param {Object} opts
   * @param {(lat:number, lon:number)=>void} [opts.onMapClick]
   * @param {(pin:Object)=>void} [opts.onPinClick]
   */
  async function init(container, opts = {}) {
    let svgEl;
    try {
      const res = await fetch('assets/world.svg');
      if (!res.ok) throw new Error('failed to load world.svg');
      const markup = await res.text();
      container.innerHTML = markup;
      svgEl = container.querySelector('svg');
    } catch (err) {
      container.innerHTML =
        '<p class="map-error">Could not load the world map image (assets/world.svg).</p>';
      throw err;
    }

    svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    // Dedicated group for pins, always on top of the land/ocean layers.
    const pinLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    pinLayer.setAttribute('id', PIN_GROUP_ID);
    svgEl.appendChild(pinLayer);

    if (opts.onMapClick) {
      svgEl.addEventListener('click', (evt) => {
        // Ignore clicks that landed on an existing pin (they have their
        // own click handler for selection).
        if (evt.target.closest && evt.target.closest('.pin')) return;
        const pt = clientToViewBoxPoint(svgEl, evt.clientX, evt.clientY);
        if (!pt) return;
        const { lon, lat } = xyToLonLat(pt.x, pt.y);
        opts.onMapClick(clamp(lat, -90, 90), clamp(lon, -180, 180));
      });
    }

    return {
      svgEl,
      renderPins(pins) {
        renderPins(svgEl, pins, opts.onPinClick);
      },
      setDraftMarker(lat, lon) {
        setDraftMarker(svgEl, lat, lon);
      },
      clearDraftMarker() {
        clearDraftMarker(svgEl);
      },
    };
  }

  function clientToViewBoxPoint(svgEl, clientX, clientY) {
    const pt = svgEl.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svgEl.getScreenCTM();
    if (!ctm) return null;
    const transformed = pt.matrixTransform(ctm.inverse());
    return { x: transformed.x, y: transformed.y };
  }

  function renderPins(svgEl, pins, onPinClick) {
    const layer = svgEl.querySelector(`#${PIN_GROUP_ID}`);
    if (!layer) return;
    layer.innerHTML = '';
    pins.forEach((pin) => {
      const { x, y } = lonLatToXY(Number(pin.lng), Number(pin.lat));
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'pin');
      g.setAttribute('transform', `translate(${x},${y})`);
      g.setAttribute('tabindex', '0');
      g.setAttribute('role', 'button');
      g.setAttribute(
        'aria-label',
        `${pin.name || 'Pin'} at latitude ${pin.lat}, longitude ${pin.lng}`
      );

      const drop = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      // small teardrop pin shape, tip at (0,0)
      drop.setAttribute(
        'd',
        'M0,0 C-5,-9 -8,-13 -8,-18 A8,8 0 1 1 8,-18 C8,-13 5,-9 0,0 Z'
      );
      drop.setAttribute('class', 'pin-shape');

      const hole = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      hole.setAttribute('cx', '0');
      hole.setAttribute('cy', '-18');
      hole.setAttribute('r', '2.6');
      hole.setAttribute('class', 'pin-hole');

      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = `${pin.name || 'Unnamed place'}${pin.date ? ' — ' + pin.date : ''}`;

      g.appendChild(drop);
      g.appendChild(hole);
      g.appendChild(title);

      if (onPinClick) {
        g.addEventListener('click', (evt) => {
          evt.stopPropagation();
          onPinClick(pin);
        });
      }

      layer.appendChild(g);
    });
  }

  function setDraftMarker(svgEl, lat, lon) {
    clearDraftMarker(svgEl);
    const layer = svgEl.querySelector(`#${PIN_GROUP_ID}`);
    if (!layer) return;
    const { x, y } = lonLatToXY(lon, lat);
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('id', 'draft-pin');
    g.setAttribute('transform', `translate(${x},${y})`);
    const drop = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    drop.setAttribute(
      'd',
      'M0,0 C-5,-9 -8,-13 -8,-18 A8,8 0 1 1 8,-18 C8,-13 5,-9 0,0 Z'
    );
    drop.setAttribute('class', 'pin-shape pin-draft');
    g.appendChild(drop);
    layer.appendChild(g);
  }

  function clearDraftMarker(svgEl) {
    const existing = svgEl.querySelector('#draft-pin');
    if (existing) existing.remove();
  }

  return { init, lonLatToXY, xyToLonLat };
})();
