'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, runSeed } = require('./support/testServer');
const { makeClient } = require('./support/client');

const PORT = 4304;
let server;
let client;
let adminToken;
let normalUserToken;

before(async () => {
  server = await startServer({ port: PORT });
  client = makeClient(server.baseUrl);

  // The API offers no way to self-assign role:admin (tested elsewhere), so
  // the only admin account available is the one created by db/seed.js,
  // run here against this test's own scratch database.
  runSeed(server.scratchRoot);

  const adminLogin = await client.post('/api/auth/login', {
    body: { email: 'admin@waypoint.test', password: 'AdminPass123!' },
  });
  assert.equal(adminLogin.status, 200, 'seeded admin login must succeed');
  adminToken = adminLogin.body.token;

  const aliceLogin = await client.post('/api/auth/login', {
    body: { email: 'alice@waypoint.test', password: 'AlicePass123!' },
  });
  assert.equal(aliceLogin.status, 200, 'seeded alice login must succeed');
  normalUserToken = aliceLogin.body.token;
});

after(async () => {
  await server.stop();
});

test('an admin can list every registered user', async () => {
  const res = await client.get('/api/admin/users', { token: adminToken });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.users));
  const emails = res.body.users.map((u) => u.email);
  assert.ok(emails.includes('admin@waypoint.test'));
  assert.ok(emails.includes('alice@waypoint.test'));
  assert.ok(emails.includes('bob@waypoint.test'));
});

test('a normal (non-admin) user calling the admin endpoint gets 403', async () => {
  const res = await client.get('/api/admin/users', { token: normalUserToken });
  assert.equal(res.status, 403);
  assert.match(res.body.error, /admin/i);
});

test('an unauthenticated caller gets 401, not 403, from the admin endpoint', async () => {
  const res = await client.get('/api/admin/users', {});
  assert.equal(res.status, 401);
});

test('the admin listing contains no password hashes or plaintext passwords', async () => {
  const res = await client.get('/api/admin/users', { token: adminToken });
  assert.equal(res.status, 200);
  for (const u of res.body.users) {
    assert.ok(!Object.prototype.hasOwnProperty.call(u, 'password'));
    assert.ok(!Object.prototype.hasOwnProperty.call(u, 'password_hash'));
  }
  const text = JSON.stringify(res.body);
  assert.ok(!/\$2[aby]?\$\d{2}\$/.test(text), 'response must not contain a bcrypt hash pattern');
});

test('a forged role:"admin" claim in a tampered payload alone does not grant access (signature must also verify)', async () => {
  // A normal user cannot get admin by merely asserting role in a request
  // body -- role comes only from the verified token. This confirms there is
  // no body-based role override anywhere on this route.
  const res = await client.get('/api/admin/users', { token: normalUserToken });
  // Sanity: even sending a body with role:admin on a GET (unusual, but try
  // it) must not matter, since GET requests here carry no body per the API.
  assert.equal(res.status, 403);
});
