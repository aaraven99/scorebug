'use strict';

/**
 * Private desktop feed transport. Chromium owns the HTTP sockets; Node's
 * bundled fetch parser must never handle a provider connection in main.
 * The caller supplies an in-memory Electron session after app readiness.
 */
function createDesktopFeedTransport({ session } = {}) {
  if (typeof session?.fetch !== 'function' || typeof session.closeAllConnections !== 'function') {
    throw new TypeError('An Electron feed session is required.');
  }
  const lifetime = new AbortController();
  let stopping;

  async function fetch(input, init = {}) {
    const url = new URL(input);
    const loopback = url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname);
    if ((!loopback && url.protocol !== 'https:') || url.username || url.password || url.hash) {
      throw new TypeError('Feed requests require HTTPS or a local loopback address.');
    }
    const signal = init.signal ? AbortSignal.any([init.signal, lifetime.signal]) : lifetime.signal;
    signal.throwIfAborted();
    return session.fetch(url.href, {
      ...init,
      signal,
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      bypassCustomProtocolHandlers: true
    });
  }

  function stop() {
    if (!stopping) {
      lifetime.abort(new DOMException('Scorebug is shutting down.', 'AbortError'));
      stopping = Promise.resolve().then(() => session.closeAllConnections());
    }
    return stopping;
  }

  return Object.freeze({ kind: 'chromium', fetch, stop });
}

module.exports = { createDesktopFeedTransport };
