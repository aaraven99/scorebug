'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDesktopFeedTransport } = require('./network-transport.cjs');

function fixture(handler = async () => new Response('{"ok":true}')) {
  const calls = [];
  let closes = 0;
  const session = {
    async fetch(url, options) {
      assert.equal(this, session, 'Electron must receive its own session as the receiver');
      calls.push({ url, options });
      return handler(url, options);
    },
    async closeAllConnections() { closes++; }
  };
  return { session, calls, get closes() { return closes; }, transport: createDesktopFeedTransport({ session }) };
}

test('desktop feeds use the supplied Chromium session and preserve explicit token requests', async () => {
  const f = fixture();
  const body = new URLSearchParams({ username: 'fixture-user', password: 'fixture-password' });
  const init = { method: 'POST', body, headers: { Authorization: 'Bearer test-only', Accept: 'application/json' },
    credentials: 'include', redirect: 'follow', cache: 'force-cache', bypassCustomProtocolHandlers: false };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('Node fetch must never receive a desktop feed'); };
  try {
    assert.deepEqual(await (await f.transport.fetch('https://feed.example/token', init)).json(), { ok: true });
  } finally { globalThis.fetch = originalFetch; }
  assert.equal(f.transport.kind, 'chromium');
  assert.equal(f.calls.length, 1);
  const sent = f.calls[0].options;
  assert.equal(sent.method, 'POST');
  assert.equal(sent.body, body);
  assert.equal(sent.headers.Authorization, 'Bearer test-only');
  assert.equal(sent.credentials, 'omit');
  assert.equal(sent.redirect, 'error');
  assert.equal(sent.cache, 'no-store');
  assert.equal(sent.bypassCustomProtocolHandlers, true);
  assert.equal(init.credentials, 'include', 'The caller options must not be mutated');
  await f.transport.stop();
});

test('desktop feed transport rejects unsafe protocols and URL credentials before dispatch', async () => {
  const f = fixture();
  for (const url of ['file:///etc/passwd', 'data:application/json,{}', 'ftp://feed.example/',
    'http://feed.example/', 'http://127.0.0.1.example/', 'https://user:pass@feed.example/', 'https://feed.example/#private']) {
    await assert.rejects(f.transport.fetch(url), TypeError);
  }
  assert.equal(f.calls.length, 0);
  await f.transport.fetch(new URL('http://127.0.0.1:1234/fixture'));
  await f.transport.fetch('http://[::1]:1234/fixture');
  assert.equal(f.calls.length, 2);
  await f.transport.stop();
});

test('an already cancelled caller never starts a native request', async () => {
  const f = fixture(), caller = new AbortController();
  const reason = new DOMException('The caller cancelled.', 'AbortError');
  caller.abort(reason);
  await assert.rejects(f.transport.fetch('https://feed.example/', { signal: caller.signal }), error => error === reason);
  assert.equal(f.calls.length, 0);
  await f.transport.stop();
});

test('caller cancellation stays attached after the response headers arrive', async () => {
  const f = fixture(async (_url, { signal }) => new Response(new ReadableStream({
    start(controller) { signal.addEventListener('abort', () => controller.error(signal.reason), { once: true }); }
  })));
  const caller = new AbortController();
  const response = await f.transport.fetch('https://feed.example/', { signal: caller.signal });
  const reading = response.text();
  caller.abort(new DOMException('Body deadline elapsed.', 'TimeoutError'));
  await assert.rejects(reading, { name: 'TimeoutError' });
  assert.equal(f.closes, 0, 'A single failed request must not stop the shared transport');
  await f.transport.stop();
});

test('shutdown aborts pending headers and bodies, closes once, and prevents new requests', async () => {
  const f = fixture(async (url, { signal }) => url.endsWith('/headers')
    ? new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
    : new Response(new ReadableStream({
      start(controller) { signal.addEventListener('abort', () => controller.error(signal.reason), { once: true }); }
    })));
  const caller = new AbortController();
  const headers = f.transport.fetch('https://feed.example/headers', { signal: caller.signal });
  const body = (await f.transport.fetch('https://feed.example/body')).text();
  const headerCheck = assert.rejects(headers, { name: 'AbortError' });
  const bodyCheck = assert.rejects(body, { name: 'AbortError' });
  const stopping = f.transport.stop();
  assert.equal(f.transport.stop(), stopping);
  await Promise.all([stopping, headerCheck, bodyCheck]);
  assert.equal(f.closes, 1);
  assert.equal(caller.signal.aborted, false, 'Shutdown must not mutate a caller-owned controller');
  await assert.rejects(f.transport.fetch('https://feed.example/again'), { name: 'AbortError' });
  assert.equal(f.calls.length, 2);
});

test('a rejected request does not prevent the next poll or stop another client', async () => {
  let attempts = 0;
  const first = fixture(async () => {
    if (++attempts === 1) throw new TypeError('Connection closed.');
    return Response.json({ score: 7 });
  });
  const second = fixture();
  await assert.rejects(first.transport.fetch('https://feed.example/'), /Connection closed/);
  assert.deepEqual(await (await first.transport.fetch('https://feed.example/')).json(), { score: 7 });
  await first.transport.stop();
  assert.deepEqual(await (await second.transport.fetch('https://feed.example/')).json(), { ok: true });
  await second.transport.stop();
});

test('shutdown failure remains observable and cannot reopen the transport', async () => {
  const failure = new Error('Native shutdown failed.');
  const f = fixture();
  f.session.closeAllConnections = async () => { throw failure; };
  const stopping = f.transport.stop();
  await assert.rejects(stopping, error => error === failure);
  assert.equal(f.transport.stop(), stopping);
  await assert.rejects(f.transport.fetch('https://feed.example/'), { name: 'AbortError' });
  assert.equal(f.calls.length, 0);
});

test('desktop startup requires an explicit native network session', () => {
  assert.throws(() => createDesktopFeedTransport(), TypeError);
  assert.throws(() => createDesktopFeedTransport({ session: { fetch: globalThis.fetch } }), TypeError);
});
