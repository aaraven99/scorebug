import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { addWebAnalytics } from '../scripts/analytics.mjs';
import { startWebAnalytics } from '../scripts/web-analytics.mjs';

const run = promisify(execFile);
const publicLocation = { protocol: 'https:', hostname: 'sports-scorebug.vercel.app', pathname: '/' };

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'scorebug-analytics-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = pathToFileURL(`${directory}${path.sep}`);
  await Promise.all(['index.html', 'widget.html', 'details.html'].map(name => writeFile(new URL(name, root), '<!doctype html><html><head></head><body></body></html>')));
  return root;
}

test('local and preview builds do not inject or copy analytics', async t => {
  for (const environment of [{}, { VERCEL_ENV: 'development' }, { VERCEL_ENV: 'preview' }]) {
    const output = await fixture(t);
    assert.equal(await addWebAnalytics(output, environment), false);
    assert.doesNotMatch(await readFile(new URL('index.html', output), 'utf8'), /analytics/);
    await assert.rejects(access(new URL('web-analytics/', output)), { code: 'ENOENT' });
  }
});

test('production builds add the official SDK once to public pages only', async t => {
  const output = await fixture(t);
  const environment = { VERCEL_ENV: 'production' };
  await addWebAnalytics(output, environment);
  await addWebAnalytics(output, environment);
  for (const page of ['index.html', 'widget.html']) {
    const html = await readFile(new URL(page, output), 'utf8');
    assert.equal(html.match(/src="\/web-analytics\/start.js"/g)?.length, 1);
  }
  assert.doesNotMatch(await readFile(new URL('details.html', output), 'utf8'), /analytics/);
  assert.equal(
    await readFile(new URL('web-analytics/vercel-analytics.js', output), 'utf8'),
    await readFile(new URL(import.meta.resolve('@vercel/analytics')), 'utf8')
  );
});

test('the browser guard excludes local, desktop, non-public and preview sessions', () => {
  let calls = 0;
  const inject = () => { calls += 1; };
  const cases = [
    { location: { ...publicLocation, protocol: 'file:' } },
    { location: { ...publicLocation, protocol: 'http:' } },
    ...['localhost', 'test.localhost', 'scorebug.local', '127.0.0.1', '192.168.1.2', '[::1]'].map(hostname => ({ location: { ...publicLocation, hostname } })),
    { location: { ...publicLocation, pathname: '/details.html' } },
    { location: publicLocation, scorebugDesktop: {} },
    { location: publicLocation, navigator: { userAgent: 'Chrome/1 Electron/45.5.0' } }
  ];
  for (const browser of cases) assert.equal(startWebAnalytics(inject, { environment: 'production' }, browser), false);
  for (const environment of ['preview', 'development', undefined]) {
    assert.equal(startWebAnalytics(inject, { environment }, { location: publicLocation }), false);
  }
  assert.equal(startWebAnalytics(inject, { environment: 'production' }, undefined), false);
  assert.equal(calls, 0);
});

test('a production page initializes once, with production mode enforced', () => {
  const browser = { location: publicLocation };
  const calls = [];
  const configuration = { environment: 'production', options: { mode: 'development', debug: true } };
  assert.equal(startWebAnalytics(options => calls.push(options), configuration, browser), true);
  assert.equal(startWebAnalytics(options => calls.push(options), configuration, browser), false);
  assert.deepEqual(calls, [{ mode: 'production', debug: false }]);
});

test('built bootstrap runs the real SDK with same-origin Vercel paths and no duplicate script', async t => {
  const output = await fixture(t);
  await writeFile(new URL('package.json', output), '{"type":"module"}');
  await addWebAnalytics(output, {
    VERCEL_ENV: 'production',
    VERCEL_OBSERVABILITY_CLIENT_CONFIG: JSON.stringify({
      analytics: { scriptSrc: '/observability/script.js', viewEndpoint: '/observability/view', eventEndpoint: '//other.example/event', sessionEndpoint: 'https://other.example/session' },
      unrelatedSecret: 'must-not-be-exposed'
    })
  });
  const bootstrap = new URL('web-analytics/start.js', output).href;
  const code = `
    const scripts = [];
    globalThis.window = { location: ${JSON.stringify(publicLocation)} };
    globalThis.document = {
      head: { querySelector: () => scripts[0], appendChild: script => scripts.push(script) },
      createElement: () => ({ dataset: {} })
    };
    await import(${JSON.stringify(bootstrap)});
    await import(${JSON.stringify(`${bootstrap}?second-load`)});
    process.stdout.write(JSON.stringify({ scripts, mode: window.vam }));
  `;
  const { stdout } = await run(process.execPath, ['--input-type=module', '-e', code]);
  const result = JSON.parse(stdout);
  assert.equal(result.scripts.length, 1);
  assert.equal(result.scripts[0].src, '/observability/script.js');
  assert.equal(result.scripts[0].dataset.sdkn, '@vercel/analytics');
  assert.equal(result.scripts[0].dataset.sdkv, '2.0.1');
  assert.equal(result.scripts[0].dataset.viewEndpoint, '/observability/view');
  assert.equal(result.scripts[0].dataset.eventEndpoint, undefined);
  assert.equal(result.scripts[0].dataset.sessionEndpoint, undefined);
  assert.equal(result.scripts[0].defer, true);
  assert.equal(result.mode, 'production');
  assert.doesNotMatch(await readFile(new URL(bootstrap), 'utf8'), /must-not-be-exposed|other\.example/);
});

test('without dynamic Vercel config the built SDK uses its standard same-origin endpoint', async t => {
  const output = await fixture(t);
  await writeFile(new URL('package.json', output), '{"type":"module"}');
  await addWebAnalytics(output, { VERCEL_ENV: 'production' });
  const bootstrap = new URL('web-analytics/start.js', output).href;
  const code = `
    globalThis.window = { location: ${JSON.stringify(publicLocation)} };
    globalThis.document = {
      head: { querySelector: () => null, appendChild: script => process.stdout.write(script.src) },
      createElement: () => ({ dataset: {} })
    };
    await import(${JSON.stringify(bootstrap)});
  `;
  const { stdout } = await run(process.execPath, ['--input-type=module', '-e', code]);
  assert.equal(stdout, '/_vercel/insights/script.js');
  assert.match(await readFile(new URL('web-analytics/LICENSE.txt', output), 'utf8'), /MIT License/);
});
