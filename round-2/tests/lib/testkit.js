'use strict';

/**
 * Minimal, dependency-free test harness + HTTP client shared by every
 * *.test.js file in round-2/tests/.
 *
 * Uses only Node built-ins (global fetch, node:sqlite, node:child_process,
 * node:path, node:fs) -- no npm packages beyond what the app itself
 * declares (express, which these test files do not even need).
 */

const BASE_URL = process.env.WAYPOINT_TEST_BASE_URL || 'http://localhost:4100';

/** Pull every Set-Cookie value out of a fetch Response, across runtimes. */
function extractSetCookies(res) {
  if (typeof res.headers.getSetCookie === 'function') {
    return res.headers.getSetCookie();
  }
  const single = res.headers.get('set-cookie');
  return single ? [single] : [];
}

/** Build a `Cookie:` header value carrying the waypoint_session token, if present. */
function sessionCookieHeaderFrom(setCookieStrings) {
  for (const sc of setCookieStrings) {
    const match = /^waypoint_session=([^;]*)/.exec(sc);
    if (match) return `waypoint_session=${match[1]}`;
  }
  return null;
}

/**
 * Perform one HTTP call against the live server.
 * @returns {Promise<{status:number, headers:Headers, contentType:string, setCookieList:string[], sessionCookie:string|null, text:string, json:any}>}
 */
async function call(path, { method = 'GET', body, cookie, headers = {} } = {}) {
  const finalHeaders = Object.assign({}, headers);
  if (body !== undefined && finalHeaders['Content-Type'] === undefined) {
    finalHeaders['Content-Type'] = 'application/json';
  }
  if (cookie) finalHeaders['Cookie'] = cookie;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: finalHeaders,
    body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    redirect: 'manual',
  });

  const setCookieList = extractSetCookies(res);
  const sessionCookie = sessionCookieHeaderFrom(setCookieList);
  const text = await res.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch (e) {
      json = null;
    }
  }

  return {
    status: res.status,
    headers: res.headers,
    contentType: res.headers.get('content-type') || '',
    setCookieList,
    sessionCookie,
    text,
    json,
  };
}

class Suite {
  constructor(name) {
    this.name = name;
    this.results = [];
  }

  async test(name, fn) {
    try {
      await fn();
      this.results.push({ name, pass: true });
      console.log(`  [PASS] ${name}`);
    } catch (err) {
      this.results.push({ name, pass: false, error: err && err.message ? err.message : String(err) });
      console.log(`  [FAIL] ${name} -- ${err && err.message ? err.message : String(err)}`);
    }
  }

  summary() {
    const passed = this.results.filter((r) => r.pass).length;
    const failed = this.results.length - passed;
    return { name: this.name, passed, failed, total: this.results.length, results: this.results };
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message || 'Assertion failed');
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(
      `${message || 'Values not equal'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

function uniqueEmail(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

module.exports = { BASE_URL, call, Suite, assert, assertEqual, uniqueEmail };
