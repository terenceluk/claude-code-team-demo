'use strict';

/**
 * Confirms every page/asset the frontend references actually loads from
 * the live server with the right status/content-type, that every JS file
 * parses cleanly, and that the world map SVG is present and well-formed.
 */

const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Suite, call, assert, assertEqual } = require('./lib/testkit');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const PAGES = [
  { url: '/', expectType: 'text/html' },
  { url: '/index.html', expectType: 'text/html' },
  { url: '/login.html', expectType: 'text/html' },
  { url: '/register.html', expectType: 'text/html' },
  { url: '/admin.html', expectType: 'text/html' },
  { url: '/css/styles.css', expectType: 'text/css' },
  { url: '/assets/world.svg', expectType: 'svg' },
];

const JS_FILES = [
  'js/api.js',
  'js/auth.js',
  'js/app.js',
  'js/map.js',
  'js/login.js',
  'js/register.js',
  'js/admin.js',
];

async function run() {
  const s = new Suite('Static assets');

  for (const page of PAGES) {
    await s.test(`GET ${page.url} returns 200 with content-type including "${page.expectType}"`, async () => {
      const res = await call(page.url);
      assertEqual(res.status, 200, 'status');
      assert(
        res.contentType.toLowerCase().includes(page.expectType),
        `expected content-type to include "${page.expectType}", got "${res.contentType}"`
      );
    });
  }

  for (const jsFile of JS_FILES) {
    await s.test(`GET /${jsFile} returns 200 with a JS content-type`, async () => {
      const res = await call(`/${jsFile}`);
      assertEqual(res.status, 200, 'status');
      assert(
        /javascript/i.test(res.contentType),
        `expected a javascript content-type, got "${res.contentType}"`
      );
      assert(res.text.length > 0, 'file is non-empty');
    });

    await s.test(`${jsFile} parses as valid JavaScript (node --check)`, () => {
      const filePath = path.join(PUBLIC_DIR, jsFile);
      // Throws if the file has a syntax error; produces no output otherwise.
      execFileSync(process.execPath, ['--check', filePath], { stdio: 'pipe' });
    });
  }

  await s.test('assets/world.svg is present and contains a well-formed <svg> root with the viewBox map.js expects', async () => {
    const res = await call('/assets/world.svg');
    assertEqual(res.status, 200, 'status');
    assert(res.text.includes('<svg'), 'contains an <svg> tag');
    assert(res.text.includes('viewBox="0 0 1000 500"'), 'viewBox matches the 1000x500 space map.js\'s lonLatToXY()/xyToLonLat() assume');
  });

  return s.summary();
}

module.exports = { run };

if (require.main === module) {
  run().then((summary) => {
    process.exit(summary.failed > 0 ? 1 : 0);
  });
}
