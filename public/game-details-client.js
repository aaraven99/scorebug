import { LIVE_POLL_INTERVAL_MS, FEED_REQUEST_TIMEOUT_MS, nextPollDelay, responseRetryMs, snapshotIsOlder } from './feed-state.js';

/** One abortable summary poll per selected game, including while the widget is idle. */
export class GameDetailsPoller {
  constructor({ onUpdate, interval = LIVE_POLL_INTERVAL_MS, fetcher = (...args) => globalThis.fetch(...args), now = Date.now, baseURL } = {}) {
    this.onUpdate = onUpdate || (() => {});
    this.interval = interval;
    this.fetcher = fetcher;
    this.now = now;
    this.document = globalThis.document;
    this.baseURL = baseURL || globalThis.document?.baseURI || 'http://localhost/';
    this.gameId = null;
    this.active = false;
    this.generation = 0;
    this.failures = 0;
    this.retryAt = 0;
    this.resume = () => { if (!this.document?.hidden) this.refresh(); };
    this.online = () => this.refresh();
    this.state = { gameId: null, data: null, error: null, loading: false };
  }
  setGame(value) {
    const id = value == null ? null : String(value);
    if (id === this.gameId) return;
    this.cancel();
    this.gameId = id;
    this.failures = 0;
    this.retryAt = 0;
    this.state = { gameId: id, data: null, error: null, loading: Boolean(id) };
    this.onUpdate(this.state);
    if (this.active && id) this.refresh();
  }
  start() {
    if (this.active) return;
    this.active = true;
    globalThis.addEventListener?.('online', this.online);
    globalThis.addEventListener?.('focus', this.resume);
    globalThis.addEventListener?.('pageshow', this.resume);
    this.document?.addEventListener('visibilitychange', this.resume);
    this.document?.addEventListener('resume', this.online);
    if (this.gameId) this.refresh();
  }
  stop() {
    this.active = false; this.cancel();
    globalThis.removeEventListener?.('online', this.online);
    globalThis.removeEventListener?.('focus', this.resume);
    globalThis.removeEventListener?.('pageshow', this.resume);
    this.document?.removeEventListener('visibilitychange', this.resume);
    this.document?.removeEventListener('resume', this.online);
  }
  cancel() {
    this.generation++;
    clearTimeout(this.timer);
    this.controller?.abort();
    this.controller = null;
  }
  async refresh() {
    if (!this.active || !this.gameId || this.controller) return;
    clearTimeout(this.timer);
    if (this.retryAt > this.now()) {
      this.timer = setTimeout(() => this.refresh(), this.retryAt - this.now());
      return;
    }
    const id = this.gameId, generation = this.generation;
    const started = this.now();
    const controller = new AbortController(); this.controller = controller;
    const timeout = setTimeout(() => controller.abort(), FEED_REQUEST_TIMEOUT_MS);
    let retryAt = 0;
    this.state = { ...this.state, loading: true };
    this.onUpdate(this.state);
    try {
      const url = new URL('/api/game', this.baseURL); url.searchParams.set('id', id);
      const response = await this.fetcher(url, { cache: 'no-store', signal: controller.signal, headers: { Accept: 'application/json' } });
      retryAt = this.now() + responseRetryMs(response, null, this.now());
      const data = await response.json();
      retryAt = Math.max(retryAt, this.now() + responseRetryMs(response, data, this.now()));
      if (!response.ok || data.gameId !== id || !Array.isArray(data.teamStats) || !Number.isFinite(Date.parse(data.fetchedAt))) throw new Error('Game stats unavailable');
      if (!this.active || generation !== this.generation) return;
      const older = snapshotIsOlder(data, this.state.data, this.now());
      const stamp = Date.parse(data.fetchedAt);
      const stale = older || data.stale || data.feedStatus === 'cached' || this.now() - stamp > 45000 || stamp - this.now() > 60000;
      const next = older ? this.state.data : data;
      this.failures = stale ? this.failures + 1 : 0;
      this.state = { gameId: id, data: stale ? { ...next, stale: true, feedStatus: 'cached' } : next, error: null, loading: false };
    } catch (error) {
      if (!this.active || generation !== this.generation) return;
      this.failures++;
      this.state = { ...this.state, data: this.state.data ? { ...this.state.data, stale: true, feedStatus: 'cached' } : null, error, loading: false };
    } finally {
      clearTimeout(timeout);
      if (generation === this.generation) {
        this.controller = null;
        this.retryAt = retryAt;
        if (this.active) {
          this.onUpdate(this.state);
          const delay = nextPollDelay({ interval: this.interval, failures: this.failures, started, now: this.now(), retryAt });
          this.timer = setTimeout(() => this.refresh(), delay);
        }
      }
    }
  }
}
