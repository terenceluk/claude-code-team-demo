'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./support/testServer');
const { makeClient } = require('./support/client');

const PORT = 4301;
let server;
let client;

before(async () => {
  server = await startServer({ port: PORT });
  client = makeClient(server.baseUrl);
});

after(async () => {
  await server.stop();
});

test('register succeeds with valid email/password', async () => {
  const res = await client.post('/api/auth/register', {
    body: { email: 'auth-user1@waypoint.test', password: 'GoodPass123!' },
  });
  assert.equal(res.status, 201);
  assert.equal(typeof res.body.token, 'string');
  assert.equal(res.body.user.email, 'auth-user1@waypoint.test');
  assert.equal(res.body.user.role, 'user');
});

test('duplicate email is rejected with 409', async () => {
  await client.post('/api/auth/register', {
    body: { email: 'dupe@waypoint.test', password: 'GoodPass123!' },
  });
  const res = await client.post('/api/auth/register', {
    body: { email: 'dupe@waypoint.test', password: 'AnotherPass123!' },
  });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /already exists/i);
});

test('duplicate email is rejected case-insensitively', async () => {
  await client.post('/api/auth/register', {
    body: { email: 'CaseTest@Waypoint.test', password: 'GoodPass123!' },
  });
  const res = await client.post('/api/auth/register', {
    body: { email: 'casetest@waypoint.test', password: 'AnotherPass123!' },
  });
  assert.equal(res.status, 409);
});

test('malformed email is rejected with 400', async () => {
  const res = await client.post('/api/auth/register', {
    body: { email: 'not-an-email', password: 'GoodPass123!' },
  });
  assert.equal(res.status, 400);
});

test('missing password is rejected with 400', async () => {
  const res = await client.post('/api/auth/register', {
    body: { email: 'nopass@waypoint.test' },
  });
  assert.equal(res.status, 400);
});

test('weak (too short) password is rejected with 400', async () => {
  const res = await client.post('/api/auth/register', {
    body: { email: 'weakpass@waypoint.test', password: 'short1' },
  });
  assert.equal(res.status, 400);
});

test('register cannot self-assign role admin', async () => {
  const res = await client.post('/api/auth/register', {
    body: { email: 'wannabe-admin@waypoint.test', password: 'GoodPass123!', role: 'admin' },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.user.role, 'user', 'client-supplied role must be ignored');

  // Confirm it stuck server-side too, not just in the immediate response.
  const login = await client.post('/api/auth/login', {
    body: { email: 'wannabe-admin@waypoint.test', password: 'GoodPass123!' },
  });
  assert.equal(login.body.user.role, 'user');
});

test('login with correct credentials returns a token', async () => {
  await client.post('/api/auth/register', {
    body: { email: 'logintest@waypoint.test', password: 'GoodPass123!' },
  });
  const res = await client.post('/api/auth/login', {
    body: { email: 'logintest@waypoint.test', password: 'GoodPass123!' },
  });
  assert.equal(res.status, 200);
  assert.equal(typeof res.body.token, 'string');
  assert.equal(res.body.user.email, 'logintest@waypoint.test');
});

test('login with wrong password is rejected with 401', async () => {
  await client.post('/api/auth/register', {
    body: { email: 'wrongpass@waypoint.test', password: 'GoodPass123!' },
  });
  const res = await client.post('/api/auth/login', {
    body: { email: 'wrongpass@waypoint.test', password: 'IncorrectPass123!' },
  });
  assert.equal(res.status, 401);
});

test('login with unknown email is rejected with 401', async () => {
  const res = await client.post('/api/auth/login', {
    body: { email: 'no-such-account@waypoint.test', password: 'GoodPass123!' },
  });
  assert.equal(res.status, 401);
});

test('wrong-password and unknown-email login errors are indistinguishable', async () => {
  await client.post('/api/auth/register', {
    body: { email: 'indist@waypoint.test', password: 'GoodPass123!' },
  });
  const wrongPassword = await client.post('/api/auth/login', {
    body: { email: 'indist@waypoint.test', password: 'WrongOne123!' },
  });
  const unknownEmail = await client.post('/api/auth/login', {
    body: { email: 'never-registered@waypoint.test', password: 'WrongOne123!' },
  });
  assert.equal(wrongPassword.status, unknownEmail.status);
  assert.deepEqual(wrongPassword.body, unknownEmail.body);
});

test('password is never present in register response body', async () => {
  const res = await client.post('/api/auth/register', {
    body: { email: 'nopwleak-register@waypoint.test', password: 'GoodPass123!' },
  });
  const text = JSON.stringify(res.body);
  assert.ok(!text.includes('GoodPass123!'), 'plaintext password leaked in register response');
  assert.ok(!Object.prototype.hasOwnProperty.call(res.body.user, 'password'));
  assert.ok(!Object.prototype.hasOwnProperty.call(res.body.user, 'password_hash'));
});

test('password is never present in login response body', async () => {
  await client.post('/api/auth/register', {
    body: { email: 'nopwleak-login@waypoint.test', password: 'GoodPass123!' },
  });
  const res = await client.post('/api/auth/login', {
    body: { email: 'nopwleak-login@waypoint.test', password: 'GoodPass123!' },
  });
  const text = JSON.stringify(res.body);
  assert.ok(!text.includes('GoodPass123!'));
  assert.ok(!Object.prototype.hasOwnProperty.call(res.body.user, 'password'));
  assert.ok(!Object.prototype.hasOwnProperty.call(res.body.user, 'password_hash'));
});

test('password is never present in GET /api/auth/me response', async () => {
  const reg = await client.post('/api/auth/register', {
    body: { email: 'nopwleak-me@waypoint.test', password: 'GoodPass123!' },
  });
  const res = await client.get('/api/auth/me', { token: reg.body.token });
  assert.equal(res.status, 200);
  const text = JSON.stringify(res.body);
  assert.ok(!text.includes('GoodPass123!'));
  assert.ok(!Object.prototype.hasOwnProperty.call(res.body.user, 'password'));
  assert.ok(!Object.prototype.hasOwnProperty.call(res.body.user, 'password_hash'));
});

test('stored password is a bcrypt hash, not the plaintext', async () => {
  const Database = require('better-sqlite3');
  const path = require('node:path');
  await client.post('/api/auth/register', {
    body: { email: 'hashcheck@waypoint.test', password: 'GoodPass123!' },
  });
  const dbPath = path.join(server.scratchRoot, 'db', 'waypoint.sqlite');
  const db = new Database(dbPath, { readonly: true });
  const row = db.prepare('SELECT password_hash FROM users WHERE email = ?').get('hashcheck@waypoint.test');
  db.close();
  assert.ok(row, 'user row should exist');
  assert.notEqual(row.password_hash, 'GoodPass123!');
  assert.match(row.password_hash, /^\$2[aby]?\$\d{2}\$/, 'expected a bcrypt hash format');
});
