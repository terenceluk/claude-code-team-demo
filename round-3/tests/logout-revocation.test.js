'use strict';
// Independently re-tests backend's claim that logout is real server-side
// token revocation (a jti denylist), not just a client-side discard, and
// that revoking one token does not affect a user's other valid sessions.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./support/testServer');
const { makeClient } = require('./support/client');

const PORT = 4303;
let server;
let client;

before(async () => {
  server = await startServer({ port: PORT });
  client = makeClient(server.baseUrl);
});

after(async () => {
  await server.stop();
});

test('logged-out token is rejected (401) on a subsequent protected request', async () => {
  const reg = await client.post('/api/auth/register', {
    body: { email: 'logout-user@waypoint.test', password: 'GoodPass123!' },
  });
  const token = reg.body.token;

  const before1 = await client.get('/api/auth/me', { token });
  assert.equal(before1.status, 200, 'token should work before logout');

  const logoutRes = await client.post('/api/auth/logout', { token });
  assert.equal(logoutRes.status, 204);

  const after1 = await client.get('/api/auth/me', { token });
  assert.equal(after1.status, 401, 'same token must be rejected immediately after logout');

  // Also check it's rejected on a different route, not just /me.
  const afterPins = await client.get('/api/pins', { token });
  assert.equal(afterPins.status, 401, 'revoked token must be rejected on /api/pins too');
});

test("revoking one session's token leaves the user's OTHER valid session tokens working", async () => {
  const email = 'multisession-user@waypoint.test';
  const password = 'GoodPass123!';
  await client.post('/api/auth/register', { body: { email, password } });

  // Two independent logins => two independent tokens (different jti) for the same user.
  const loginA = await client.post('/api/auth/login', { body: { email, password } });
  const loginB = await client.post('/api/auth/login', { body: { email, password } });
  assert.equal(loginA.status, 200);
  assert.equal(loginB.status, 200);
  const tokenSessionA = loginA.body.token;
  const tokenSessionB = loginB.body.token;
  assert.notEqual(tokenSessionA, tokenSessionB, 'two logins should produce two distinct tokens');

  // Log out session A only.
  const logoutRes = await client.post('/api/auth/logout', { token: tokenSessionA });
  assert.equal(logoutRes.status, 204);

  const checkA = await client.get('/api/auth/me', { token: tokenSessionA });
  assert.equal(checkA.status, 401, 'logged-out session A token must be rejected');

  const checkB = await client.get('/api/auth/me', { token: tokenSessionB });
  assert.equal(checkB.status, 200, "session B's token must remain valid; logout must not be a broad/user-wide revoke");
});

test("logging out one user's token does not revoke a different user's token", async () => {
  await client.post('/api/auth/register', { body: { email: 'victim-of-broad-revoke@waypoint.test', password: 'GoodPass123!' } });
  const victimLogin = await client.post('/api/auth/login', {
    body: { email: 'victim-of-broad-revoke@waypoint.test', password: 'GoodPass123!' },
  });
  const victimToken = victimLogin.body.token;

  const reg2 = await client.post('/api/auth/register', { body: { email: 'logout-actor@waypoint.test', password: 'GoodPass123!' } });
  const actorToken = reg2.body.token;

  const logoutRes = await client.post('/api/auth/logout', { token: actorToken });
  assert.equal(logoutRes.status, 204);

  const victimCheck = await client.get('/api/auth/me', { token: victimToken });
  assert.equal(victimCheck.status, 200, "another user's token must be unaffected by this logout call");
});

test('logout itself requires authentication (401 without a token)', async () => {
  const res = await client.post('/api/auth/logout', {});
  assert.equal(res.status, 401);
});
