'use strict';
// Minimal HTTP client used by the test suite. Talks directly to the real
// running server over fetch -- no mocking. Field/route names below are
// taken from round-3/API.md, not from assumptions about the implementation.

function makeClient(baseUrl) {
  async function raw(method, path, { token, body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(baseUrl + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch (e) {
        json = null;
      }
    }
    return { status: res.status, body: json, rawText: text, headers: res.headers };
  }

  return {
    get: (path, opts) => raw('GET', path, opts),
    post: (path, opts) => raw('POST', path, opts),
    put: (path, opts) => raw('PUT', path, opts),
    patch: (path, opts) => raw('PATCH', path, opts),
    del: (path, opts) => raw('DELETE', path, opts),
  };
}

async function registerAndLogin(client, email, password) {
  const res = await client.post('/api/auth/register', { body: { email, password } });
  if (res.status !== 201) {
    throw new Error(`registerAndLogin: register failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { token: res.body.token, user: res.body.user };
}

module.exports = { makeClient, registerAndLogin };
