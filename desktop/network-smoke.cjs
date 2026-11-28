'use strict';

// Real sockets, the production desktop transport, and the shared feed reader.
// This helper runs only in native smoke mode; it never intercepts app requests.
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { gzipSync } = require('node:zlib');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const MAX_BYTES = 4 * 1024 * 1024;
const DEADLINE_MS = 4000;
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

async function bounded(promise, label, milliseconds = DEADLINE_MS + 1000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} exceeded ${milliseconds}ms`)), milliseconds);
      }),
    ]);
  } finally { clearTimeout(timer); }
}

class SmokeFeedError extends Error {
  constructor(message, options = {}) { super(message); Object.assign(this, options); }
}

async function runNetworkSmoke({ fetchImpl, appRoot, report = {} }) {
  assert.equal(typeof fetchImpl, 'function', 'Native smoke must receive the production feed transport');
  assert.equal(typeof appRoot, 'string', 'Native smoke must receive the packaged or source app root');
  Object.assign(report, {
    passed: false,
    runtime: {
      electron: process.versions.electron, chrome: process.versions.chrome,
      node: process.versions.node, undici: process.versions.undici,
    },
    repetitions: 3, cases: [], requests: 0,
  });
  const { createFeedService } = await import(pathToFileURL(path.join(appRoot, 'lib', 'feed-service.mjs')).href);
  const records = new Map(), sockets = new Set(), requestTimers = new Set(), unexpectedServerErrors = [];
  const heldBody = Buffer.alloc(64 * 1024, 'a');
  const oversizedJson = JSON.stringify({ ok: true, padding: 'x'.repeat(MAX_BYTES) });
  const compressedOversize = gzipSync(oversizedJson);
  let requestSequence = 0, redirectedRequests = 0, statefulMode = 'healthy';
  let origin;
  const recordFor = id => {
    if (!records.has(id)) records.set(id, {
      received: deferred(), finished: deferred(), closed: deferred(), headers: null,
    });
    return records.get(id);
  };
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const record = recordFor(url.searchParams.get('request'));
    report.requests++;
    record.headers = { ...req.headers };
    record.received.resolve();
    // One fixture owns each socket, including the completion observations.
    res.setHeader('Connection', 'close');
    req.socket.once('finish', () => {
      record.finishedAt = performance.now();
      record.finished.resolve();
    });
    req.socket.once('close', () => {
      record.closedAt = performance.now();
      record.closed.resolve();
    });
    const json = (body, headers = {}) => {
      const bytes = Buffer.from(JSON.stringify(body));
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': bytes.length, ...headers });
      res.end(bytes);
    };
    switch (url.pathname) {
      case '/held-fin':
        // This exact response reproduced the reported Parser.finish assertion
        // in Node 24.22.3 / Undici 7.30.2 when its body was left unread.
        req.socket.end(Buffer.concat([
          Buffer.from(`HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: ${heldBody.length}\r\nConnection: close\r\n\r\n`),
          heldBody,
        ]));
        return;
      case '/closed-before-headers': req.socket.destroy(); return;
      case '/short-content-length':
        req.socket.end('HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 100\r\nConnection: close\r\n\r\n{"short":true}');
        return;
      case '/truncated-chunked':
        req.socket.end('HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n20\r\n{"short":true}');
        return;
      case '/stalled-headers': return;
      case '/stalled-body':
      case '/cancel-body':
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.flushHeaders();
        res.write('{"pending":');
        return;
      case '/declared-oversize':
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': MAX_BYTES + 1 });
        res.flushHeaders();
        res.write('{"pending":');
        return;
      case '/streamed-oversize':
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(oversizedJson);
        return;
      case '/gzip-oversize':
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip', 'Content-Length': compressedOversize.length });
        res.end(compressedOversize);
        return;
      case '/gzip': {
        const bytes = gzipSync(JSON.stringify({ ok: true, decoded: 'native smoke' }));
        res.writeHead(200, { 'Content-Type': 'application/ld+json; charset=utf-8', 'Content-Encoding': 'gzip', 'Content-Length': bytes.length });
        res.end(bytes);
        return;
      }
      case '/redirect':
        res.writeHead(302, { Location: `${origin}/redirect-target`, 'Content-Length': 0 });
        res.end();
        return;
      case '/redirect-target': redirectedRequests++; json({ redirected: true }); return;
      case '/unavailable':
        res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '1' });
        res.flushHeaders();
        res.write('{"unavailable":');
        return;
      case '/malformed':
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"unfinished":');
        return;
      case '/html':
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<!doctype html><title>Unavailable</title>');
        return;
      case '/set-cookie': json({ ok: true }, { 'Set-Cookie': 'scorebug_native_smoke=must-not-be-sent; Path=/; HttpOnly' }); return;
      case '/echo': {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => json({
          method: req.method, authorization: req.headers.authorization || null,
          cookie: req.headers.cookie || null, body,
        }));
        return;
      }
      case '/stateful':
        if (statefulMode === 'broken') { req.socket.destroy(); return; }
        json({ ok: true, value: statefulMode === 'recovered' ? 2 : 1 });
        return;
      default: json({ ok: true, path: url.pathname });
    }
  });
  server.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.on('error', error => {
      if (!['ECONNRESET', 'EPIPE'].includes(error.code)) unexpectedServerErrors.push(error.message);
    });
  });
  server.on('clientError', (error, socket) => {
    if (!['ECONNRESET', 'EPIPE'].includes(error.code)) unexpectedServerErrors.push(error.message);
    socket.destroy();
  });
  const request = (pathname, options = {}) => {
    const id = String(++requestSequence), record = recordFor(id);
    const deadline = new AbortController();
    const timer = setTimeout(() => {
      requestTimers.delete(timer);
      deadline.abort(new DOMException('Native network fixture timed out.', 'TimeoutError'));
    }, DEADLINE_MS);
    requestTimers.add(timer);
    const signal = options.signal ? AbortSignal.any([options.signal, deadline.signal]) : deadline.signal;
    const response = fetchImpl(`${origin}${pathname}?request=${id}`, {
      headers: { Accept: 'application/json' }, ...options, signal,
    });
    return { response, record };
  };
  const healthy = async () => {
    const response = await request('/healthy').response;
    assert.equal(response.status, 200);
    assert.equal((await response.json()).ok, true);
  };
  const feed = (paths, { onResponse, ...options } = {}) => createFeedService({
    sources: paths.map((pathname, index) => ({
      id: index ? 'backup' : 'primary', url: () => `https://scorebug-native-smoke.invalid${pathname}`,
      timeoutMs: DEADLINE_MS,
    })),
    fetchImpl: (url, init) => {
      const target = new URL(url);
      assert.equal(target.origin, 'https://scorebug-native-smoke.invalid');
      return request(target.pathname, init).response.then(response => {
        onResponse?.(response);
        return response;
      });
    },
    normalize: (data, { fetchedAt }) => ({ ...data, fetchedAt }),
    ErrorType: SmokeFeedError, label: 'native smoke', invalidCode: 'INVALID',
    unavailableCode: 'UNAVAILABLE', timeoutCode: 'TIMEOUT', hedgeDelayMs: 1000,
    totalTimeoutMs: DEADLINE_MS, cacheTtlMs: 0, ...options,
  });
  const run = async (pass, name, task) => {
    const result = { pass, name, passed: false };
    report.cases.push(result);
    const started = performance.now();
    try {
      await bounded(task(result), name, DEADLINE_MS * 2);
      await healthy();
      result.passed = true;
    } catch (error) {
      result.error = error.stack || String(error);
      throw error;
    } finally { result.elapsedMs = Math.round(performance.now() - started); }
  };
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
    });
    origin = `http://127.0.0.1:${server.address().port}`;
    for (let pass = 1; pass <= 3; pass++) {
      await run(pass, '64KiB response stays unread through peer FIN, then reads completely', async result => {
        const { response: pending, record } = request('/held-fin');
        const response = await pending;
        assert.equal(response.bodyUsed, false);
        // Observe actual socket completion; a fixed sleep is not evidence that
        // the peer finished while the body remained unread.
        await bounded(Promise.all([record.finished.promise, record.closed.promise]), 'Peer FIN while body is unread');
        assert.equal(response.bodyUsed, false);
        result.peerFinishedAt = record.finishedAt;
        result.peerClosedAt = record.closedAt;
        result.readStartedAt = performance.now();
        assert.ok(result.readStartedAt >= result.peerClosedAt);
        const bytes = Buffer.from(await response.arrayBuffer());
        assert.deepEqual(bytes, heldBody);
        result.bytes = bytes.length;
        await new Promise(resolve => setImmediate(resolve));
      });
      for (const pathname of ['/closed-before-headers', '/short-content-length', '/truncated-chunked']) {
        await run(pass, `Socket failure rejects: ${pathname}`, async () => {
          await assert.rejects(async () => { const response = await request(pathname).response; await response.text(); });
        });
      }
      for (const pathname of ['/stalled-headers', '/stalled-body']) {
        await run(pass, `Abort closes the active socket: ${pathname}`, async result => {
          const controller = new AbortController();
          const { response: pending, record } = request(pathname, { signal: controller.signal });
          if (pathname === '/stalled-body') {
            const response = await pending;
            const reader = response.body.getReader();
            try {
              const first = await reader.read();
              assert.equal(first.done, false);
              assert.ok(first.value.byteLength > 0);
              result.bytesBeforeAbort = first.value.byteLength;
              const rejected = assert.rejects(() => reader.read());
              controller.abort();
              await rejected;
            } finally { reader.releaseLock(); }
          } else {
            const rejected = assert.rejects(async () => { const response = await pending; await response.text(); });
            await bounded(record.received.promise, 'Abort fixture receives request');
            controller.abort();
            await rejected;
          }
          await bounded(record.closed.promise, 'Aborted socket closes');
          result.socketClosed = true;
        });
      }
      for (const pathname of ['/stalled-headers', '/stalled-body']) {
        await run(pass, `A real deadline aborts a stalled provider: ${pathname}`, async result => {
          const read = feed([pathname], {
            onResponse: () => { result.headersReceivedAt = performance.now(); },
            sources: [{ id: 'primary', url: () => `https://scorebug-native-smoke.invalid${pathname}`, timeoutMs: 150 }],
          });
          await assert.rejects(() => read('current'), { code: 'TIMEOUT' });
          result.rejectedAt = performance.now();
          if (pathname === '/stalled-body') {
            assert.ok(Number.isFinite(result.headersReceivedAt), 'Body timeout must happen after response headers arrive');
            assert.ok(result.headersReceivedAt < result.rejectedAt);
          } else assert.equal(result.headersReceivedAt, undefined);
        });
      }
      await run(pass, 'Cancel an unread streaming body and close its socket', async result => {
        const { response: pending, record } = request('/cancel-body');
        const response = await pending;
        await response.body.cancel();
        await bounded(record.closed.promise, 'Cancelled response closes');
        result.socketClosed = true;
      });
      await run(pass, 'A redirect is rejected without requesting its target', async () => {
        const before = redirectedRequests;
        await assert.rejects(() => request('/redirect', { redirect: 'follow' }).response);
        assert.equal(redirectedRequests, before);
      });
      await run(pass, 'Compressed structured JSON is decoded by the shared feed reader', async () => {
        const data = await feed(['/gzip'])('current');
        assert.equal(data.decoded, 'native smoke');
        assert.equal(data.feedStatus, 'primary');
      });
      for (const pathname of ['/declared-oversize', '/streamed-oversize', '/gzip-oversize', '/malformed', '/html']) {
        await run(pass, `Shared reader rejects invalid content: ${pathname}`, async () => {
          await assert.rejects(() => feed([pathname])('current'), { code: 'INVALID' });
        });
      }
      await run(pass, 'A failed provider is cancelled and a real healthy fallback is read', async () => {
        const data = await feed(['/unavailable', '/healthy'])('current');
        assert.equal(data.sourceId, 'backup');
        assert.equal(data.feedStatus, 'backup');
        assert.equal(data.stale, false);
        assert.equal(data.ok, true);
      });
      await run(pass, 'Real outage retains the confirmed value and later polling recovers', async () => {
        let clock = Date.now();
        const read = feed(['/stateful'], { now: () => clock });
        statefulMode = 'healthy';
        const good = await read('current');
        assert.equal(good.value, 1);
        clock += 1001; statefulMode = 'broken';
        const cached = await read('current');
        assert.equal(cached.value, 1);
        assert.equal(cached.fetchedAt, good.fetchedAt);
        assert.equal(cached.stale, true);
        assert.equal(cached.feedStatus, 'cached');
        clock += 4001; statefulMode = 'recovered';
        const recovered = await read('current');
        assert.equal(recovered.value, 2);
        assert.equal(recovered.stale, false);
        assert.equal(recovered.feedStatus, 'primary');
        assert.notEqual(recovered.fetchedAt, good.fetchedAt);
      });
      await run(pass, 'Provider token headers and form bodies survive while cookies are omitted', async () => {
        const setCookie = await request('/set-cookie', { credentials: 'include' }).response;
        await setCookie.text();
        const response = await request('/echo', {
          method: 'POST', credentials: 'include',
          headers: { Authorization: 'Bearer scorebug-native-smoke-token', 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ username: 'native-smoke', password: 'fixture-token' }),
        }).response;
        const echo = await response.json();
        assert.equal(echo.method, 'POST');
        assert.equal(echo.authorization, 'Bearer scorebug-native-smoke-token');
        assert.equal(echo.cookie, null);
        assert.equal(echo.body, 'username=native-smoke&password=fixture-token');
      });
    }
    assert.deepEqual(unexpectedServerErrors, []);
    report.passed = true;
    return report;
  } catch (error) {
    report.error = error.stack || String(error);
    throw error;
  } finally {
    for (const timer of requestTimers) clearTimeout(timer);
    requestTimers.clear();
    server.closeAllConnections?.();
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
    await new Promise(resolve => setImmediate(resolve));
    report.remainingSockets = sockets.size;
    assert.equal(sockets.size, 0, 'Native network fixtures left open sockets');
  }
}

module.exports = { runNetworkSmoke };
