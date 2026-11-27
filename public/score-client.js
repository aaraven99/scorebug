import { LIVE_POLL_INTERVAL_MS, FEED_REQUEST_TIMEOUT_MS, nextPollDelay, responseRetryMs, snapshotIsOlder } from './feed-state.js';

export const DEFAULT_PREFERENCES = Object.freeze({ gameId: null, team: 'CHI', date: null, scale: 1, anchor: 'bottom-center', orientation: 'horizontal', snapEnabled: true, locked: false });
const KEY = 'scorebug.preferences.v1';
export const SCOREBOARD_CACHE_KEY = 'scorebug.scoreboards.v1';
export const SCOREBOARD_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 8, MAX_CACHE_CHARS = 750000, MAX_GAMES = 64;
const FUTURE_TOLERANCE_MS = 60000;
const preferencesEvents = new EventTarget();
let preferences = { ...DEFAULT_PREFERENCES };
let channel;

export function isSupportedGameId(value) {
  return typeof value === 'string' && /^(?:\d{1,15}|thescore-\d{1,15})$/.test(value);
}
const canonicalTeamId = (value) => typeof value === 'string' && /^\d{1,8}$/.test(value);
const stampOf = (data) => typeof data?.fetchedAt === 'string' ? Date.parse(data.fetchedAt) : NaN;
const cacheDate = (date) => date == null || date === '' ? 'current' : typeof date === 'string' && /^\d{8}$/.test(date) ? date : null;
function browserStorage() { try { return globalThis.localStorage || null; } catch { return null; } }
function validSnapshot(data) {
  return Boolean(data && typeof data === 'object' && Array.isArray(data.games) && data.games.length <= MAX_GAMES && Number.isFinite(stampOf(data)) && data.games.every((game) => game && isSupportedGameId(game.id) && canonicalTeamId(game.away?.id) && canonicalTeamId(game.home?.id) && game.away.id !== game.home.id));
}
function aliasesOf(game, additions = []) {
  return [...new Set([...(Array.isArray(game?.idAliases) ? game.idAliases : []), ...additions])]
    .filter((id) => isSupportedGameId(id) && id !== game.id).slice(0, 4);
}
function sameFixture(a, b) {
  if (!canonicalTeamId(a?.away?.id) || !canonicalTeamId(a?.home?.id) || a.away.id === a.home.id || a.away.id !== b?.away?.id || a.home.id !== b?.home?.id) return false;
  const left = Date.parse(a.startTime), right = Date.parse(b.startTime);
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= 5 * 60 * 1000;
}

/** Carry only a unique, exact fixture's IDs across provider changes. */
export function reconcileGameIdentity(nextGames, previousGames = []) {
  if (!Array.isArray(nextGames)) return [];
  const previous = Array.isArray(previousGames) ? previousGames : [];
  return nextGames.map((game) => {
    const matches = previous.filter((candidate) => sameFixture(game, candidate));
    const matched = matches.length === 1 && nextGames.filter((candidate) => sameFixture(candidate, matches[0])).length === 1 ? matches[0] : null;
    const aliases = aliasesOf(game, matched ? [matched.id, ...aliasesOf(matched)] : []);
    const result = { ...game };
    if (aliases.length) result.idAliases = aliases; else delete result.idAliases;
    return result;
  });
}

function cachedSnapshot(data, origin) {
  return { ...data, feedStatus: 'cached', stale: true, ...(origin ? { cacheOrigin: origin } : {}) };
}

function cacheEntries(storage, now) {
  try {
    const raw = storage?.getItem(SCOREBOARD_CACHE_KEY);
    if (!raw || raw.length > MAX_CACHE_CHARS) return [];
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1 || !Array.isArray(parsed.entries)) return [];
    const unique = new Map();
    for (const entry of parsed.entries.slice(0, 64)) {
      if (!entry || (entry.date !== 'current' && cacheDate(entry.date) !== entry.date) || !validSnapshot(entry.data)) continue;
      const stamp = stampOf(entry.data);
      if (now - stamp > SCOREBOARD_CACHE_MAX_AGE_MS || stamp - now > FUTURE_TOLERANCE_MS) continue;
      const clean = { date: entry.date, savedAt: Number.isFinite(entry.savedAt) ? Math.min(entry.savedAt, now) : stamp, data: { ...entry.data, games: reconcileGameIdentity(entry.data.games) } };
      if (!unique.has(entry.date) || snapshotIsOlder(unique.get(entry.date).data, entry.data, now)) unique.set(entry.date, clean);
    }
    return [...unique.values()].sort((a, b) => b.savedAt - a.savedAt).slice(0, MAX_CACHE_ENTRIES);
  } catch { return []; }
}

/** Restored scores are always stale; their original successful-check time survives. */
export function readCachedScoreboard(date = null, { storage = browserStorage(), now = Date.now() } = {}) {
  const key = cacheDate(date);
  if (!key) return null;
  const entry = cacheEntries(storage, now).find((value) => value.date === key);
  return entry ? cachedSnapshot(entry.data, 'browser') : null;
}

/** Save at most eight dates, never extending an old snapshot's six-hour life. */
export function writeCachedScoreboard(date, data, { storage = browserStorage(), now = Date.now() } = {}) {
  const key = cacheDate(date), stamp = stampOf(data);
  if (!key || !validSnapshot(data) || now - stamp > SCOREBOARD_CACHE_MAX_AGE_MS || stamp - now > FUTURE_TOLERANCE_MS) return false;
  try {
    const entries = cacheEntries(storage, now), previous = entries.find((entry) => entry.date === key);
    if (previous && snapshotIsOlder(data, previous.data, now)) return false;
    // A cached response from another server process cannot replace fresher
    // browser data. Equal-age snapshots still retain learned provider aliases.
    const keepPrevious = previous && stampOf(previous.data) === stamp && (data.stale || data.feedStatus === 'cached')
      && !previous.data.stale && previous.data.feedStatus !== 'cached' && !snapshotIsOlder(previous.data, data, now);
    const chosen = keepPrevious ? previous.data : data;
    const other = keepPrevious ? data : previous?.data;
    const saved = { ...chosen, games: reconcileGameIdentity(chosen.games, other?.games) };
    let bounded = [{ date: key, savedAt: now, data: saved }, ...entries.filter((entry) => entry.date !== key)].slice(0, MAX_CACHE_ENTRIES);
    let encoded = JSON.stringify({ version: 1, entries: bounded });
    while (encoded.length > MAX_CACHE_CHARS && bounded.length > 1) { bounded.pop(); encoded = JSON.stringify({ version: 1, entries: bounded }); }
    if (encoded.length > MAX_CACHE_CHARS || !storage?.setItem) return false;
    storage.setItem(SCOREBOARD_CACHE_KEY, encoded);
    return true;
  } catch { return false; }
}
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
  const query = new URLSearchParams(globalThis.location?.search || '');
  const patch = {};
  if (isSupportedGameId(query.get('game'))) patch.gameId = query.get('game');
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
  if (gameId) {
    if (!isSupportedGameId(gameId)) return null;
    const exact = games.find((game) => game?.id === gameId);
    if (exact) return exact;
    const aliased = games.filter((game) => game && aliasesOf(game).includes(gameId));
    return aliased.length === 1 ? aliased[0] : null;
  }
  const favorite = games.filter((game) => [game.away?.abbreviation, game.home?.abbreviation].includes(team));
  const candidates = favorite.length ? favorite : games;
  const live = candidates.find((game) => game.isLive || game.phase === 'halftime' || game.phase === 'intermission');
  if (live) return live;
  const upcoming = candidates.filter((game) => game.state === 'pre' && Date.parse(game.startTime) >= now - 3600000).sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
  if (upcoming.length) return upcoming[0];
  return [...candidates].sort((a, b) => (Date.parse(b.startTime) || 0) - (Date.parse(a.startTime) || 0))[0];
}

export function feedIsStale(data, hasError = false, now = Date.now()) {
  const stamp = stampOf(data);
  return hasError || data?.stale === true || data?.feedStatus === 'cached' || !Number.isFinite(stamp) || now - stamp > 45000 || stamp - now > FUTURE_TOLERANCE_MS;
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
  constructor({ date = null, onUpdate, interval = LIVE_POLL_INTERVAL_MS, apiUrl = '/api/scoreboard', fetcher = (...args) => globalThis.fetch(...args), storage = browserStorage(), now = Date.now, baseURL } = {}) {
    this.document = globalThis.document;
    this.date = date; this.onUpdate = onUpdate; this.interval = interval;
    this.apiUrl = new URL(apiUrl, baseURL || this.document?.baseURI || 'http://localhost/').href;
    this.fetcher = fetcher; this.storage = storage; this.now = now;
    this.data = readCachedScoreboard(date, { storage, now: now() });
    this.error = null; this.failures = 0; this.stopped = true; this.generation = 0; this.retryAt = 0;
    this.resume = () => { if (!this.document?.hidden) this.refresh(); };
    this.online = () => this.refresh();
  }
  start() {
    if (!this.stopped) return;
    this.stopped = false;
    globalThis.addEventListener?.('online', this.online);
    globalThis.addEventListener?.('focus', this.resume);
    globalThis.addEventListener?.('pageshow', this.resume);
    this.document?.addEventListener('visibilitychange', this.resume);
    this.document?.addEventListener('resume', this.online);
    const restored = readCachedScoreboard(this.date, { storage: this.storage, now: this.now() });
    if (restored && (!this.data || snapshotIsOlder(this.data, restored, this.now()))) this.data = restored;
    if (this.data && feedIsStale(this.data, Boolean(this.error), this.now())) {
      this.data = cachedSnapshot(this.data, this.data.cacheOrigin || 'memory');
      this.onUpdate?.({ data: this.data, error: this.error, loading: true });
    }
    this.refresh();
  }
  setDate(date) {
    if (this.date === date) return;
    this.date = date; this.generation++; this.controller?.abort(); this.controller = null; this.inFlight = false; clearTimeout(this.timer);
    this.data = readCachedScoreboard(date, { storage: this.storage, now: this.now() });
    this.error = null; this.failures = 0; this.retryAt = 0;
    this.onUpdate?.({ data: this.data, error: null, loading: true });
    this.refresh();
  }
  async refresh() {
    if (this.stopped || this.inFlight) return;
    clearTimeout(this.timer);
    if (this.retryAt > this.now()) {
      this.timer = setTimeout(() => this.refresh(), this.retryAt - this.now());
      return;
    }
    this.inFlight = true;
    const generation = this.generation;
    const started = this.now();
    const controller = new AbortController();
    this.controller = controller;
    const timeout = setTimeout(() => controller.abort(), FEED_REQUEST_TIMEOUT_MS);
    let retryAt = 0;
    try {
      const url = new URL(this.apiUrl);
      if (this.date) url.searchParams.set('date', this.date);
      const response = await this.fetcher(url, { cache: 'no-store', signal: controller.signal, headers: { Accept: 'application/json' } });
      retryAt = this.now() + responseRetryMs(response, null, this.now());
      const body = await response.json();
      retryAt = Math.max(retryAt, this.now() + responseRetryMs(response, body, this.now()));
      if (!response.ok) throw new Error(body?.error?.message || body?.message || (typeof body?.error === 'string' ? body.error : 'The score feed is temporarily unavailable.'));
      if (!validSnapshot(body)) throw new Error('The score feed returned an unexpected response.');
      if (generation !== this.generation || this.stopped) return;

      // A newer snapshot saved by another tab also outranks an old server cache.
      const restored = readCachedScoreboard(this.date, { storage: this.storage, now: this.now() });
      const previous = restored && (!this.data || snapshotIsOlder(this.data, restored, this.now())) ? restored : this.data;
      const stale = feedIsStale(body, false, this.now());
      const newerPrevious = previous && snapshotIsOlder(body, previous, this.now());
      let next = newerPrevious ? previous : body;
      next = { ...next, games: reconcileGameIdentity(next.games, newerPrevious ? body.games : previous?.games) };
      if (stale || newerPrevious) {
        this.data = cachedSnapshot(next, newerPrevious ? next.cacheOrigin || 'memory' : undefined);
        this.failures++;
      } else {
        this.data = next; this.failures = 0;
      }
      this.error = null;
      writeCachedScoreboard(this.date, this.data, { storage: this.storage, now: this.now() });
      this.onUpdate?.({ data: this.data, error: null, loading: false });
    } catch (error) {
      if (generation !== this.generation || this.stopped) return;
      this.failures++; this.error = error;
      const restored = readCachedScoreboard(this.date, { storage: this.storage, now: this.now() });
      if (restored && (!this.data || snapshotIsOlder(this.data, restored, this.now()))) this.data = restored;
      if (this.data) this.data = cachedSnapshot(this.data, this.data.cacheOrigin || 'memory');
      this.onUpdate?.({ data: this.data, error, loading: false });
    } finally {
      clearTimeout(timeout);
      if (generation === this.generation) {
        this.controller = null; this.inFlight = false;
        this.retryAt = retryAt;
        if (!this.stopped) {
          const wait = nextPollDelay({ interval: this.interval, failures: this.failures, started, now: this.now(), retryAt });
          this.timer = setTimeout(() => this.refresh(), wait);
        }
      }
    }
  }
  stop() {
    this.stopped = true; this.generation++; this.controller?.abort(); this.controller = null; this.inFlight = false; clearTimeout(this.timer);
    globalThis.removeEventListener?.('online', this.online);
    globalThis.removeEventListener?.('focus', this.resume);
    globalThis.removeEventListener?.('pageshow', this.resume);
    this.document?.removeEventListener('visibilitychange', this.resume);
    this.document?.removeEventListener('resume', this.online);
  }
}
