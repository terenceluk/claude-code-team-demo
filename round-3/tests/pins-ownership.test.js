'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { startServer } = require('./support/testServer');
const { makeClient, registerAndLogin } = require('./support/client');

const PORT = 4302;
const SECRET = 'test-only-secret-do-not-reuse';
let server;
let client;
let userA, userB;

before(async () => {
  server = await startServer({ port: PORT, secret: SECRET });
  client = makeClient(server.baseUrl);
  userA = await registerAndLogin(client, 'ownerA@waypoint.test', 'GoodPass123!');
  userB = await registerAndLogin(client, 'ownerB@waypoint.test', 'GoodPass123!');
});

after(async () => {
  await server.stop();
});

const pinPayload = (overrides = {}) => ({
  place_name: 'Kyoto, Japan',
  latitude: 35.0116,
  longitude: 135.7681,
  visited_on: '2024-04-02',
  note: 'Cherry blossoms.',
  ...overrides,
});

test('user A can create pins and list exactly their own', async () => {
  const p1 = await client.post('/api/pins', { token: userA.token, body: pinPayload({ place_name: 'A-Pin-1' }) });
  const p2 = await client.post('/api/pins', { token: userA.token, body: pinPayload({ place_name: 'A-Pin-2' }) });
  assert.equal(p1.status, 201);
  assert.equal(p2.status, 201);

  const list = await client.get('/api/pins', { token: userA.token });
  assert.equal(list.status, 200);
  const names = list.body.pins.map((p) => p.place_name);
  assert.ok(names.includes('A-Pin-1'));
  assert.ok(names.includes('A-Pin-2'));
});

test("GET /api/pins as user B does not include any of user A's pins", async () => {
  const bPin = await client.post('/api/pins', { token: userB.token, body: pinPayload({ place_name: 'B-Pin-1' }) });
  assert.equal(bPin.status, 201);

  const list = await client.get('/api/pins', { token: userB.token });
  assert.equal(list.status, 200);
  const names = list.body.pins.map((p) => p.place_name);
  assert.ok(names.includes('B-Pin-1'));
  assert.ok(!names.includes('A-Pin-1'), "B's pin list must not contain A's pins");
  assert.ok(!names.includes('A-Pin-2'), "B's pin list must not contain A's pins");
});

test('pin responses never include user_id', async () => {
  const created = await client.post('/api/pins', { token: userA.token, body: pinPayload({ place_name: 'NoUserIdCheck' }) });
  assert.ok(!Object.prototype.hasOwnProperty.call(created.body.pin, 'user_id'));
  const fetched = await client.get(`/api/pins/${created.body.pin.id}`, { token: userA.token });
  assert.ok(!Object.prototype.hasOwnProperty.call(fetched.body.pin, 'user_id'));
});

test("user B cannot read user A's pin by id (404, indistinguishable from not-found)", async () => {
  const created = await client.post('/api/pins', { token: userA.token, body: pinPayload({ place_name: 'A-Secret-Pin' }) });
  const aPinId = created.body.pin.id;

  const asB = await client.get(`/api/pins/${aPinId}`, { token: userB.token });
  assert.equal(asB.status, 404);
  assert.equal(asB.body.error, 'Pin not found');

  // still exists and unchanged for A
  const asA = await client.get(`/api/pins/${aPinId}`, { token: userA.token });
  assert.equal(asA.status, 200);
  assert.equal(asA.body.pin.place_name, 'A-Secret-Pin');
});

test("user B cannot update user A's pin (404, and A's pin is unchanged afterward)", async () => {
  const created = await client.post('/api/pins', { token: userA.token, body: pinPayload({ place_name: 'A-Update-Target' }) });
  const aPinId = created.body.pin.id;

  const attempt = await client.put(`/api/pins/${aPinId}`, {
    token: userB.token,
    body: { place_name: 'HIJACKED-BY-B' },
  });
  assert.equal(attempt.status, 404);
  assert.equal(attempt.body.error, 'Pin not found');

  const verify = await client.get(`/api/pins/${aPinId}`, { token: userA.token });
  assert.equal(verify.status, 200);
  assert.equal(verify.body.pin.place_name, 'A-Update-Target', "A's pin must be unchanged after B's forbidden update attempt");
});

test("user B cannot update user A's pin via PATCH either", async () => {
  const created = await client.post('/api/pins', { token: userA.token, body: pinPayload({ place_name: 'A-Patch-Target' }) });
  const aPinId = created.body.pin.id;

  const attempt = await client.patch(`/api/pins/${aPinId}`, {
    token: userB.token,
    body: { note: 'hijacked note' },
  });
  assert.equal(attempt.status, 404);

  const verify = await client.get(`/api/pins/${aPinId}`, { token: userA.token });
  assert.equal(verify.body.pin.note, 'Cherry blossoms.');
});

test("user B cannot delete user A's pin (404, and the pin still exists afterward)", async () => {
  const created = await client.post('/api/pins', { token: userA.token, body: pinPayload({ place_name: 'A-Delete-Target' }) });
  const aPinId = created.body.pin.id;

  const attempt = await client.del(`/api/pins/${aPinId}`, { token: userB.token });
  assert.equal(attempt.status, 404);
  assert.equal(attempt.body.error, 'Pin not found');

  const verify = await client.get(`/api/pins/${aPinId}`, { token: userA.token });
  assert.equal(verify.status, 200, "A's pin must still exist after B's forbidden delete attempt");
  assert.equal(verify.body.pin.place_name, 'A-Delete-Target');
});

test('POST /api/pins with a forged user_id in the body is still owned by the caller', async () => {
  // userB attempts to create a pin claiming to be userA via a forged user_id.
  const forged = await client.post('/api/pins', {
    token: userB.token,
    body: pinPayload({ place_name: 'Forged-Ownership-Pin', user_id: userA.user.id }),
  });
  assert.equal(forged.status, 201);
  const forgedPinId = forged.body.pin.id;

  // It must show up in B's own list, not A's.
  const bList = await client.get('/api/pins', { token: userB.token });
  assert.ok(bList.body.pins.some((p) => p.id === forgedPinId), 'forged pin should belong to the caller (B)');

  const aList = await client.get('/api/pins', { token: userA.token });
  assert.ok(!aList.body.pins.some((p) => p.id === forgedPinId), 'forged pin must NOT be attributed to the forged user_id (A)');

  // Confirm directly against the database too.
  const Database = require('better-sqlite3');
  const path = require('node:path');
  const dbPath = path.join(server.scratchRoot, 'db', 'waypoint.sqlite');
  const db = new Database(dbPath, { readonly: true });
  const row = db.prepare('SELECT user_id FROM pins WHERE id = ?').get(forgedPinId);
  db.close();
  assert.equal(row.user_id, userB.user.id, 'pin must be owned by the authenticated caller, not the forged user_id');
});

test('unauthenticated requests to every protected route return 401', async () => {
  const created = await client.post('/api/pins', { token: userA.token, body: pinPayload({ place_name: 'For-401-Checks' }) });
  const pinId = created.body.pin.id;

  const checks = [
    ['GET', '/api/pins'],
    ['POST', '/api/pins'],
    [`GET`, `/api/pins/${pinId}`],
    ['PUT', `/api/pins/${pinId}`],
    ['PATCH', `/api/pins/${pinId}`],
    ['DELETE', `/api/pins/${pinId}`],
    ['GET', '/api/auth/me'],
    ['POST', '/api/auth/logout'],
    ['GET', '/api/admin/users'],
  ];

  for (const [method, path] of checks) {
    const res = await client[
      method === 'GET' ? 'get' : method === 'POST' ? 'post' : method === 'PUT' ? 'put' : method === 'PATCH' ? 'patch' : 'del'
    ](path, {});
    assert.equal(res.status, 401, `${method} ${path} without auth should be 401, got ${res.status}`);
  }
});

test('garbage token returns 401, not 200', async () => {
  const res = await client.get('/api/pins', { token: 'this-is-not-a-jwt' });
  assert.equal(res.status, 401);
});

test('tampered token (valid JWT with a mutated signature/payload char) returns 401', async () => {
  const valid = userA.token;
  // Flip a character in the middle of the payload segment to corrupt it
  // while keeping the three-dot JWT shape.
  const parts = valid.split('.');
  const payload = parts[1];
  const mutatedChar = payload[10] === 'A' ? 'B' : 'A';
  parts[1] = payload.slice(0, 10) + mutatedChar + payload.slice(11);
  const tampered = parts.join('.');

  const res = await client.get('/api/pins', { token: tampered });
  assert.equal(res.status, 401);
});

test('expired token returns 401, not 200', async () => {
  const expired = jwt.sign(
    { sub: userA.user.id, email: userA.user.email, role: 'user', jti: 'expired-test-jti' },
    SECRET,
    { expiresIn: -10 } // already expired 10 seconds ago
  );
  const res = await client.get('/api/pins', { token: expired });
  assert.equal(res.status, 401);
});

test('token signed with the wrong secret returns 401', async () => {
  const forged = jwt.sign(
    { sub: userA.user.id, email: userA.user.email, role: 'admin', jti: 'wrong-secret-jti' },
    'a-completely-different-secret',
    { expiresIn: '1h' }
  );
  const res = await client.get('/api/pins', { token: forged });
  assert.equal(res.status, 401);
});
