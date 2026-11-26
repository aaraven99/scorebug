export const DEFAULT_PREFERENCES = Object.freeze({ gameId: null, team: 'CHI', date: null, scale: 1, anchor: 'bottom-center', orientation: 'horizontal', snapEnabled: true, locked: false });
const KEY = 'scorebug.preferences.v1';
const preferencesEvents = new EventTarget();
let preferences = { ...DEFAULT_PREFERENCES };
let channel;
try { preferences = { ...preferences, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { /* private browsing or corrupt storage */ }
try { if (typeof window !== 'undefined') channel = new BroadcastChannel('scorebug.preferences.v1'); } catch { /* optional */ }

export function getPreferences() { return { ...preferences }; }
function acceptPreferences(next) {
  preferences = { ...preferences, ...next };
  try { localStorage.setItem(KEY, JSON.stringify(preferences)); } catch { /* storage is optional */ }
  preferencesEvents.dispatchEvent(new CustomEvent('change', { detail: getPreferences() }));
}
if (channel) channel.onmessage = (event) => { if (event.data && typeof event.data === 'object') acceptPreferences(event.data); };
globalThis.addEventListener?.('storage', (event) => {
  if (event.key === KEY && event.newValue) { try { acceptPreferences(JSON.parse(event.newValue)); } catch { /* ignore invalid data */ } }
});

export async function initializePreferences() {
  if (globalThis.scorebugInitialPreferences) acceptPreferences(globalThis.scorebugInitialPreferences);
  if (globalThis.scorebugDesktop) {
    try { acceptPreferences(await globalThis.scorebugDesktop.getPreferences()); } catch { /* local settings remain available */ }
    globalThis.scorebugDesktop.onPreferencesChanged?.(acceptPreferences);
  }
  const query = new URLSearchParams(location.search);
  const patch = {};
  if (/^\d{1,15}$/.test(query.get('game') || '')) patch.gameId = query.get('game');
  if (/^\d{8}$/.test(query.get('date') || '')) patch.date = query.get('date');
  if (/^[A-Z]{2,4}$/.test(query.get('team') || '')) patch.team = query.get('team');
  if (Object.keys(patch).length) acceptPreferences(patch);
  return getPreferences();
}

export async function updatePreferences(patch) {
  acceptPreferences(patch);
  channel?.postMessage(getPreferences());
  if (globalThis.scorebugDesktop) {
    try { acceptPreferences(await globalThis.scorebugDesktop.setPreferences(patch)); }
    catch (error) { console.warn('Could not save desktop preference:', error.message); }
  }
  return getPreferences();
}
export function onPreferences(callback) {
  const listener = (event) => callback(event.detail);
  preferencesEvents.addEventListener('change', listener);
  return () => preferencesEvents.removeEventListener('change', listener);
}

export function selectGame(games, { gameId, team = 'CHI' } = {}, now = Date.now()) {
  if (!Array.isArray(games) || !games.length) return null;
  if (gameId) return games.find((game) => game.id === gameId) || null;
  const favorite = games.filter((game) => [game.away?.abbreviation, game.home?.abbreviation].includes(team));
  const candidates = favorite.length ? favorite : games;
  const live = candidates.find((game) => game.isLive || game.phase === 'halftime' || game.phase === 'intermission');
  if (live) return live;
  const upcoming = candidates.filter((game) => game.state === 'pre' && Date.parse(game.startTime) >= now - 3600000).sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
  if (upcoming.length) return upcoming[0];
  return [...candidates].sort((a, b) => (Date.parse(b.startTime) || 0) - (Date.parse(a.startTime) || 0))[0];
}

export function feedIsStale(data, hasError = false, now = Date.now()) {
  const stamp = Date.parse(data?.fetchedAt);
  return hasError || !Number.isFinite(stamp) || now - stamp > 45000;
}
export function checkedAgo(data) {
  if (!data?.fetchedAt) return 'Connecting…';
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(data.fetchedAt)) / 1000));
  return `Checked ${seconds < 2 ? 'just now' : seconds < 60 ? `${seconds}s ago` : `${Math.floor(seconds / 60)}m ago`}`;
}
export function gameLabel(game) {
  if (!game) return 'Choose a game';
  return `${game.away.abbreviation} ${game.away.score ?? '–'} · ${game.home.abbreviation} ${game.home.score ?? '–'}`;
}

export class ScoreboardPoller {
  constructor({ date = null, onUpdate, interval = 10000, apiUrl = '/api/scoreboard' } = {}) {
    this.date = date; this.onUpdate = onUpdate; this.interval = interval; this.apiUrl = new URL(apiUrl, document.baseURI).href;
    this.data = null; this.error = null; this.failures = 0; this.stopped = true; this.generation = 0;
    this.resume = () => { if (!document.hidden) this.refresh(); };
    this.online = () => this.refresh();
  }
  start() {
    if (!this.stopped) return;
    this.stopped = false;
    globalThis.addEventListener('online', this.online);
    globalThis.addEventListener('focus', this.resume);
    globalThis.addEventListener('pageshow', this.resume);
    document.addEventListener('visibilitychange', this.resume);
    document.addEventListener('resume', this.online);
    this.refresh();
  }
  setDate(date) {
    if (this.date === date) return;
    this.date = date; this.generation++; this.controller?.abort(); this.inFlight = false;
    this.data = null; this.error = null; this.failures = 0;
    this.onUpdate?.({ data: null, error: null, loading: true });
    this.refresh();
  }
  async refresh() {
    if (this.stopped || this.inFlight) return;
    clearTimeout(this.timer);
    this.inFlight = true;
    const generation = this.generation;
    const started = Date.now();
    const controller = new AbortController();
    this.controller = controller;
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const url = new URL(this.apiUrl);
      if (this.date) url.searchParams.set('date', this.date);
      const response = await fetch(url, { cache: 'no-store', signal: controller.signal, headers: { Accept: 'application/json' } });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || body.message || (typeof body.error === 'string' ? body.error : 'The score feed is temporarily unavailable.'));
      if (!Array.isArray(body.games) || !Number.isFinite(Date.parse(body.fetchedAt))) throw new Error('The score feed returned an unexpected response.');
      if (generation !== this.generation || this.stopped) return;
      this.data = body; this.error = null; this.failures = 0;
      this.onUpdate?.({ data: this.data, error: null, loading: false });
    } catch (error) {
      if (generation !== this.generation || this.stopped) return;
      this.failures++; this.error = error;
      this.onUpdate?.({ data: this.data, error, loading: false });
    } finally {
      clearTimeout(timeout);
      if (generation === this.generation) {
        this.inFlight = false;
        if (!this.stopped) {
          const wait = this.failures ? Math.min(60000, this.interval * 2 ** this.failures) : Math.max(1000, this.interval - (Date.now() - started));
          this.timer = setTimeout(() => this.refresh(), wait);
        }
      }
    }
  }
  stop() {
    this.stopped = true; this.generation++; this.controller?.abort(); this.inFlight = false; clearTimeout(this.timer);
    globalThis.removeEventListener('online', this.online);
    globalThis.removeEventListener('focus', this.resume);
    globalThis.removeEventListener('pageshow', this.resume);
    document.removeEventListener('visibilitychange', this.resume);
    document.removeEventListener('resume', this.online);
  }
}
