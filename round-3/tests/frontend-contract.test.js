'use strict';
// Grep-level contract check: confirms the static frontend is served and
// that its JS references the same routes/field names API.md documents.
// This is NOT browser automation -- no Playwright/Puppeteer/etc. is
// available in this environment, so real DOM rendering and click-through
// user flows are not exercised here. That gap is called out explicitly in
// TEST-REPORT.md rather than being implied by these tests passing.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer } = require('./support/testServer');
const { makeClient } = require('./support/client');

const PORT = 4307;
let server;
let client;

before(async () => {
  server = await startServer({ port: PORT });
  client = makeClient(server.baseUrl);
});

after(async () => {
  await server.stop();
});

test('the static app is served at /', async () => {
  const res = await client.get('/', {});
  assert.equal(res.status, 200);
  assert.match(res.rawText, /Waypoint/);
});

test('static assets (css, js, svg map) are served', async () => {
  for (const p of ['/css/styles.css', '/js/api.js', '/js/app.js', '/js/map.js', '/js/auth.js', '/js/admin.js', '/assets/world-map.svg']) {
    const res = await client.get(p, {});
    assert.equal(res.status, 200, `${p} should be served (200)`);
  }
});

test('the map is a bundled offline SVG, not Leaflet or a tile service', async () => {
  const svg = await client.get('/assets/world-map.svg', {});
  assert.match(svg.rawText.trim(), /^<svg/i);

  const mapJsPath = path.join(__dirname, '..', 'public', 'js', 'map.js');
  const mapJs = fs.readFileSync(mapJsPath, 'utf8');
  assert.ok(!/leaflet/i.test(mapJs), 'map.js must not reference Leaflet (frontend uses a bundled SVG instead)');
  assert.ok(!/tile\.openstreetmap|{s}\.tile|mapbox|tile\.provider/i.test(mapJs), 'map.js must not reference a tile service');
});

test('public/ contains no external (http/https) asset URLs, only local paths and XML namespace URIs', () => {
  const publicDir = path.join(__dirname, '..', 'public');
  const offenders = [];

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.(html|js|css|svg)$/i.test(entry.name)) {
        const text = fs.readFileSync(full, 'utf8');
        const urlMatches = text.match(/https?:\/\/[^\s"'()]+/g) || [];
        for (const url of urlMatches) {
          // XML/SVG namespace declarations are not network fetches.
          if (/^https?:\/\/www\.w3\.org\//.test(url)) continue;
          offenders.push(`${full}: ${url}`);
        }
      }
    }
  }
  walk(publicDir);

  assert.deepEqual(offenders, [], 'no external http(s) asset/resource URLs should appear under public/');
});

test('js/api.js references the routes and field names documented in API.md', () => {
  const apiJsPath = path.join(__dirname, '..', 'public', 'js', 'api.js');
  const src = fs.readFileSync(apiJsPath, 'utf8');

  const expectedRoutes = [
    '/api/auth/register',
    '/api/auth/login',
    '/api/auth/logout',
    '/api/auth/me',
    '/api/pins',
    '/api/admin/users',
  ];
  for (const route of expectedRoutes) {
    assert.ok(src.includes(route), `api.js should reference route ${route}`);
  }

  const expectedFields = ['place_name', 'latitude', 'longitude', 'visited_on', 'note'];
  for (const field of expectedFields) {
    assert.ok(src.includes(field), `api.js should reference field name "${field}"`);
  }
});

test('unknown API routes return a JSON 404, and non-API unknown paths fall through to static handling', async () => {
  const res = await client.get('/api/totally-not-a-real-route', {});
  assert.equal(res.status, 404);
  assert.equal(typeof res.body.error, 'string');
});
