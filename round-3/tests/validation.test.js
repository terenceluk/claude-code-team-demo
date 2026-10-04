'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./support/testServer');
const { makeClient, registerAndLogin } = require('./support/client');

const PORT = 4305;
let server;
let client;
let user;

const validPin = () => ({
  place_name: 'Valid Place',
  latitude: 10,
  longitude: 20,
  visited_on: '2024-01-01',
  note: 'ok',
});

before(async () => {
  server = await startServer({ port: PORT });
  client = makeClient(server.baseUrl);
  user = await registerAndLogin(client, 'validation-user@waypoint.test', 'GoodPass123!');
});

after(async () => {
  await server.stop();
});

test('latitude above 90 is rejected', async () => {
  const res = await client.post('/api/pins', { token: user.token, body: { ...validPin(), latitude: 91 } });
  assert.equal(res.status, 400);
});

test('latitude below -90 is rejected', async () => {
  const res = await client.post('/api/pins', { token: user.token, body: { ...validPin(), latitude: -91 } });
  assert.equal(res.status, 400);
});

test('longitude above 180 is rejected', async () => {
  const res = await client.post('/api/pins', { token: user.token, body: { ...validPin(), longitude: 181 } });
  assert.equal(res.status, 400);
});

test('longitude below -180 is rejected', async () => {
  const res = await client.post('/api/pins', { token: user.token, body: { ...validPin(), longitude: -181 } });
  assert.equal(res.status, 400);
});

test('boundary values -90/90 and -180/180 are accepted', async () => {
  const res = await client.post('/api/pins', { token: user.token, body: { ...validPin(), latitude: -90, longitude: 180 } });
  assert.equal(res.status, 201);
});

test('malformed date string is rejected', async () => {
  const res = await client.post('/api/pins', { token: user.token, body: { ...validPin(), visited_on: 'not-a-date' } });
  assert.equal(res.status, 400);
});

test('date in wrong format (MM/DD/YYYY) is rejected', async () => {
  const res = await client.post('/api/pins', { token: user.token, body: { ...validPin(), visited_on: '01/01/2024' } });
  assert.equal(res.status, 400);
});

// Regression coverage for the routes/pins.js:20-24 isRealCalendarDate fix
// (originally reported as a FAIL in this file: Date.parse silently rolled
// impossible day-of-month values over into the next month instead of
// rejecting them). Each rollover-class date is checked on create AND on
// both update verbs, since POST and PUT/PATCH share one validator
// (validatePinInput) but a partial/half-applied fix is a realistic risk.
const impossibleDates = ['2024-02-30', '2024-04-31', '2023-02-29'];

for (const badDate of impossibleDates) {
  test(`non-existent calendar date ${badDate} is rejected on create`, async () => {
    const res = await client.post('/api/pins', { token: user.token, body: { ...validPin(), visited_on: badDate } });
    assert.equal(res.status, 400, `expected ${badDate} to be rejected on POST`);
  });

  test(`non-existent calendar date ${badDate} is rejected on PUT update`, async () => {
    const created = await client.post('/api/pins', { token: user.token, body: validPin() });
    const res = await client.put(`/api/pins/${created.body.pin.id}`, {
      token: user.token,
      body: { visited_on: badDate },
    });
    assert.equal(res.status, 400, `expected ${badDate} to be rejected on PUT`);
  });

  test(`non-existent calendar date ${badDate} is rejected on PATCH update`, async () => {
    const created = await client.post('/api/pins', { token: user.token, body: validPin() });
    const res = await client.patch(`/api/pins/${created.body.pin.id}`, {
      token: user.token,
      body: { visited_on: badDate },
    });
    assert.equal(res.status, 400, `expected ${badDate} to be rejected on PATCH`);
  });
}

test('leap-year Feb 29 (2024-02-29) is still ACCEPTED, not over-corrected into rejection', async () => {
  const res = await client.post('/api/pins', { token: user.token, body: { ...validPin(), visited_on: '2024-02-29' } });
  assert.equal(res.status, 201);
  assert.equal(res.body.pin.visited_on, '2024-02-29');
});

test('leap-year Feb 29 is still accepted on a PATCH update too', async () => {
  const created = await client.post('/api/pins', { token: user.token, body: validPin() });
  const res = await client.patch(`/api/pins/${created.body.pin.id}`, {
    token: user.token,
    body: { visited_on: '2024-02-29' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.pin.visited_on, '2024-02-29');
});

test('out-of-range month (2024-13-01) is still rejected', async () => {
  const res = await client.post('/api/pins', { token: user.token, body: { ...validPin(), visited_on: '2024-13-01' } });
  assert.equal(res.status, 400);
});

test('all-zero date (0000-00-00) matches the YYYY-MM-DD shape but is rejected as not a real date', async () => {
  const res = await client.post('/api/pins', { token: user.token, body: { ...validPin(), visited_on: '0000-00-00' } });
  assert.equal(res.status, 400);
});

test('over-long place_name (>200 chars) is rejected', async () => {
  const res = await client.post('/api/pins', { token: user.token, body: { ...validPin(), place_name: 'x'.repeat(201) } });
  assert.equal(res.status, 400);
});

test('place_name at exactly 200 chars is accepted', async () => {
  const res = await client.post('/api/pins', { token: user.token, body: { ...validPin(), place_name: 'x'.repeat(200) } });
  assert.equal(res.status, 201);
});

test('empty place_name is rejected', async () => {
  const res = await client.post('/api/pins', { token: user.token, body: { ...validPin(), place_name: '   ' } });
  assert.equal(res.status, 400);
});

test('missing place_name is rejected', async () => {
  const body = validPin();
  delete body.place_name;
  const res = await client.post('/api/pins', { token: user.token, body });
  assert.equal(res.status, 400);
});

test('over-long note (>2000 chars) is rejected', async () => {
  const res = await client.post('/api/pins', { token: user.token, body: { ...validPin(), note: 'x'.repeat(2001) } });
  assert.equal(res.status, 400);
});

test('note at exactly 2000 chars is accepted', async () => {
  const res = await client.post('/api/pins', { token: user.token, body: { ...validPin(), note: 'x'.repeat(2000) } });
  assert.equal(res.status, 201);
});

test('note may be omitted (defaults to null)', async () => {
  const body = validPin();
  delete body.note;
  const res = await client.post('/api/pins', { token: user.token, body });
  assert.equal(res.status, 201);
  assert.equal(res.body.pin.note, null);
});

test('note may be explicitly null', async () => {
  const res = await client.post('/api/pins', { token: user.token, body: { ...validPin(), note: null } });
  assert.equal(res.status, 201);
  assert.equal(res.body.pin.note, null);
});

test('PATCH only validates fields present in the body (partial update)', async () => {
  const created = await client.post('/api/pins', { token: user.token, body: validPin() });
  const id = created.body.pin.id;
  // Send only a note update; place_name/lat/lon/date should stay as-is even
  // though they are not re-sent.
  const patchRes = await client.patch(`/api/pins/${id}`, { token: user.token, body: { note: 'updated only' } });
  assert.equal(patchRes.status, 200);
  assert.equal(patchRes.body.pin.place_name, 'Valid Place');
  assert.equal(patchRes.body.pin.note, 'updated only');
});

test('PATCH with an invalid field value among partial fields is rejected', async () => {
  const created = await client.post('/api/pins', { token: user.token, body: validPin() });
  const id = created.body.pin.id;
  const patchRes = await client.patch(`/api/pins/${id}`, { token: user.token, body: { latitude: 999 } });
  assert.equal(patchRes.status, 400);
});
