/** One abortable summary poll per selected game, including while the widget is idle. */
export class GameDetailsPoller {
  constructor({ onUpdate, interval = 10000, fetcher = (...args) => globalThis.fetch(...args), baseURL } = {}) {
    this.onUpdate = onUpdate || (() => {});
    this.interval = interval;
    this.fetcher = fetcher;
    this.baseURL = baseURL || globalThis.document?.baseURI || 'http://localhost/';
    this.gameId = null;
    this.active = false;
    this.generation = 0;
    this.failures = 0;
    this.state = { gameId: null, data: null, error: null, loading: false };
  }
  setGame(value) {
    const id = value == null ? null : String(value);
    if (id === this.gameId) return;
    this.cancel();
    this.gameId = id;
    this.failures = 0;
    this.state = { gameId: id, data: null, error: null, loading: Boolean(id) };
    this.onUpdate(this.state);
    if (this.active && id) this.refresh();
  }
  start() { if (this.active) return; this.active = true; if (this.gameId) this.refresh(); }
  stop() { this.active = false; this.cancel(); }
  cancel() {
    this.generation++;
    clearTimeout(this.timer);
    this.controller?.abort();
    this.controller = null;
  }
  async refresh() {
    if (!this.active || !this.gameId || this.controller) return;
    clearTimeout(this.timer);
    const id = this.gameId, generation = this.generation;
    const controller = new AbortController(); this.controller = controller;
    const timeout = setTimeout(() => controller.abort(), 18000);
    this.state = { ...this.state, loading: true };
    this.onUpdate(this.state);
    try {
      const url = new URL('/api/game', this.baseURL); url.searchParams.set('id', id);
      const response = await this.fetcher(url, { cache: 'no-store', signal: controller.signal, headers: { Accept: 'application/json' } });
      const data = await response.json();
      if (!response.ok || data.gameId !== id || !Array.isArray(data.teamStats) || !Number.isFinite(Date.parse(data.fetchedAt))) throw new Error('Game stats unavailable');
      if (!this.active || generation !== this.generation) return;
      this.failures = 0;
      this.state = { gameId: id, data, error: null, loading: false };
    } catch (error) {
      if (!this.active || generation !== this.generation) return;
      this.failures++;
      this.state = { ...this.state, error, loading: false };
    } finally {
      clearTimeout(timeout);
      if (generation === this.generation) {
        this.controller = null;
        if (this.active) {
          this.onUpdate(this.state);
          const delay = this.failures ? Math.min(60000, this.interval * 2 ** Math.min(this.failures, 3)) : this.interval;
          this.timer = setTimeout(() => this.refresh(), delay);
        }
      }
    }
  }
}
