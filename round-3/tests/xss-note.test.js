'use strict';
// Independently re-tests frontend's claim that a user-supplied XSS payload
// in a note renders inert. Two separate checks, as instructed:
//  1) API round-trip: the server stores/returns the note text faithfully
//     (it should NOT mangle or strip it -- escaping is the frontend's job).
//  2) Static analysis of the frontend rendering code: it must use
//     textContent (not innerHTML) for user-supplied pin fields.
// NOTE: no browser-automation tool (e.g. Playwright/Puppeteer) is available
// in this environment, so actual DOM execution is NOT verified end-to-end.
// This is a real coverage gap, called out plainly in TEST-REPORT.md rather
// than being implied by these tests passing.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer } = require('./support/testServer');
const { makeClient, registerAndLogin } = require('./support/client');

const PORT = 4306;
let server;
let client;
let user;

before(async () => {
  server = await startServer({ port: PORT });
  client = makeClient(server.baseUrl);
  user = await registerAndLogin(client, 'xss-user@waypoint.test', 'GoodPass123!');
});

after(async () => {
  await server.stop();
});

test('a script-tag payload in note round-trips through the API unmangled', async () => {
  const payload = '<script>window.__xss_fired = true;</script>';
  const created = await client.post('/api/pins', {
    token: user.token,
    body: {
      place_name: 'XSS Test Pin',
      latitude: 1,
      longitude: 1,
      visited_on: '2024-01-01',
      note: payload,
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.pin.note, payload, 'server must store/return the note text faithfully, unescaped/unmangled');

  const fetched = await client.get(`/api/pins/${created.body.pin.id}`, { token: user.token });
  assert.equal(fetched.body.pin.note, payload);
});

test('an HTML-injection payload in place_name round-trips through the API unmangled', async () => {
  const payload = '<img src=x onerror=alert(1)>';
  const created = await client.post('/api/pins', {
    token: user.token,
    body: {
      place_name: payload,
      latitude: 1,
      longitude: 1,
      visited_on: '2024-01-01',
      note: null,
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.pin.place_name, payload);
});

test('static check: frontend renders pin place_name/note/date via textContent, not innerHTML', () => {
  const mapJsPath = path.join(__dirname, '..', 'public', 'js', 'map.js');
  const src = fs.readFileSync(mapJsPath, 'utf8');

  // Every assignment of a pin field into the DOM should go through
  // textContent. Flag any innerHTML assignment involving pin.* as a defect.
  const dangerousInnerHtmlWithPinField = /\.innerHTML\s*=[^=][\s\S]{0,80}pin\./.test(src);
  assert.ok(!dangerousInnerHtmlWithPinField, 'map.js appears to assign a pin field via innerHTML instead of textContent');

  assert.match(src, /popupPlaceEl\.textContent\s*=\s*pin\.place_name/, 'expected place_name to be rendered via textContent');
  assert.match(src, /popupNoteEl\.textContent\s*=\s*pin\.note/, 'expected note to be rendered via textContent');
});
