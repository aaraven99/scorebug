const initialized = Symbol.for('scorebug.webAnalytics');
const publicPages = new Set(['/', '/index.html', '/widget.html']);

// This module is included only in the production website build. Keep these
// runtime checks too, so serving that build locally never records a visit.
export function startWebAnalytics(inject, { environment, options = {} } = {}, browser = globalThis.window) {
  const location = browser?.location;
  const hostname = location?.hostname?.toLowerCase() || '';
  if (environment !== 'production' || location?.protocol !== 'https:' || !hostname) return false;
  if (!publicPages.has(location.pathname)) return false;
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) return false;
  if (hostname.includes(':') || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return false;
  if (browser.scorebugDesktop || /\bElectron\//i.test(browser.navigator?.userAgent || '')) return false;
  if (browser[initialized]) return false;

  inject({ ...options, mode: 'production', debug: false });
  browser[initialized] = true;
  return true;
}
