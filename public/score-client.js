import { normalizePreferencePatch, normalizeFavorites, normalizeFavoriteStyleIds, supportedGameId, gameLeague, matchesFavorite, validLeagueId, leagueOfId, validDate } from './preferences-model.js';
import { LIVE_POLL_INTERVAL_MS, FEED_REQUEST_TIMEOUT_MS, nextPollDelay, responseRetryMs, snapshotIsOlder } from './feed-state.js';

export const DEFAULT_PREFERENCES = Object.freeze({ gameId: null, team: null, date: null, leagueId: 'nfl', styleId: 'nfl-blades', styleAuto: true, racingRows: 6, favorites: [], favoriteStyleIds: Object.freeze([]), scale: 1, anchor: 'bottom-center', orientation: 'horizontal', snapEnabled: true, locked: false });
// Older open tabs rewrite records using their older schema. Migrate their last
// saved choice once, then keep the current schema out of that write-back loop.
const KEY = 'scorebug.preferences.v2';
const LEGACY_KEY = 'scorebug.preferences.v1';
// v2.0.1 tabs still share the base record. Keep new style favorites separate so
// their schema cannot discard it, while ordinary settings keep syncing normally.
export const FAVORITE_STYLES_KEY = 'scorebug.favorite-styles.v1';
export const SCOREBOARD_CACHE_KEY = 'scorebug.scoreboards.v1';
export const SCOREBOARD_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 24, MAX_CACHE_CHARS = 2000000, MAX_GAMES = 256;
const FUTURE_TOLERANCE_MS = 60000;
const preferencesEvents = new EventTarget();
let preferences = { ...DEFAULT_PREFERENCES };
let channel;
let favoriteStylesChannel;
let preferencesInitialized = false;

export function isSupportedGameId(value) {
  return supportedGameId(value);
}
const canonicalTeamId = (value) => typeof value === 'string' && /^(?:\d{1,8}|[a-z][a-z0-9.-]{0,39}:[a-zA-Z0-9_-]{1,48})$/.test(value);
const stampOf = (data) => typeof data?.fetchedAt === 'string' ? Date.parse(data.fetchedAt) : NaN;
const cacheDate = (date) => date == null || date === '' ? 'current' : validDate(date) ? date : null;
function browserStorage() { try { return globalThis.localStorage || null; } catch { return null; } }
function validSnapshot(data, leagueId = data?.leagueId || 'nfl') {
  return Boolean(data && typeof data === 'object' && (!data.leagueId || data.leagueId === leagueId) && Array.isArray(data.games) && data.games.length <= MAX_GAMES && Number.isFinite(stampOf(data)) && data.games.every((game) => {
    if (!game || !isSupportedGameId(game.id) || gameLeague(game) !== leagueId) return false;
    if (['race', 'leaderboard'].includes(game.kind)) return Array.isArray(game.entries) && game.entries.length <= 500;
    return canonicalTeamId(game.away?.id) && canonicalTeamId(game.home?.id) && game.away.id !== game.home.id;
  }));
}
function aliasesOf(game, additions = []) {
  return [...new Set([...(Array.isArray(game?.idAliases) ? game.idAliases : []), ...additions])]
    .filter((id) => isSupportedGameId(id) && id !== game.id).slice(0, 4);
}
function sameFixture(a, b) {
  if (gameLeague(a) !== gameLeague(b)) return false;
  if (['race', 'leaderboard'].includes(a?.kind)) return a.id === b?.id;
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
      const leagueId = validLeagueId(entry.leagueId) ? entry.leagueId : 'nfl';
      if (!validSnapshot(entry.data, leagueId)) continue;
      const entryKey = `${leagueId}/${entry.date}`;
      const clean = { leagueId, date: entry.date, savedAt: Number.isFinite(entry.savedAt) ? Math.min(entry.savedAt, now) : stamp, data: { ...entry.data, games: reconcileGameIdentity(entry.data.games) } };
      if (!unique.has(entryKey) || snapshotIsOlder(unique.get(entryKey).data, entry.data, now)) unique.set(entryKey, clean);
    }
    return [...unique.values()].sort((a, b) => b.savedAt - a.savedAt).slice(0, MAX_CACHE_ENTRIES);
  } catch { return []; }
}

/** Restored scores are always stale; their original successful-check time survives. */
export function readCachedScoreboard(date = null, { storage = browserStorage(), now = Date.now(), leagueId = 'nfl' } = {}) {
  const key = cacheDate(date);
  if (!key) return null;
  const entry = cacheEntries(storage, now).find((value) => value.date === key && value.leagueId === leagueId);
  return entry ? cachedSnapshot(entry.data, 'browser') : null;
}

/** Save at most eight dates, never extending an old snapshot's six-hour life. */
export function writeCachedScoreboard(date, data, { storage = browserStorage(), now = Date.now(), leagueId = 'nfl' } = {}) {
  const key = cacheDate(date), stamp = stampOf(data);
  if (!key || !validSnapshot(data, leagueId) || now - stamp > SCOREBOARD_CACHE_MAX_AGE_MS || stamp - now > FUTURE_TOLERANCE_MS) return false;
  try {
    const entries = cacheEntries(storage, now), previous = entries.find((entry) => entry.date === key && entry.leagueId === leagueId);
    if (previous && snapshotIsOlder(data, previous.data, now)) return false;
    // A cached response from another server process cannot replace fresher
    // browser data. Equal-age snapshots still retain learned provider aliases.
    const keepPrevious = previous && stampOf(previous.data) === stamp && (data.stale || data.feedStatus === 'cached')
      && !previous.data.stale && previous.data.feedStatus !== 'cached' && !snapshotIsOlder(previous.data, data, now);
    const chosen = keepPrevious ? previous.data : data;
    const other = keepPrevious ? data : previous?.data;
    const saved = { ...chosen, games: reconcileGameIdentity(chosen.games, other?.games) };
    let bounded = [{ leagueId, date: key, savedAt: now, data: saved }, ...entries.filter((entry) => entry.date !== key || entry.leagueId !== leagueId).filter((entry,index,all)=>entry.leagueId !== leagueId || all.slice(0,index).filter(e=>e.leagueId===leagueId).length<7)].slice(0, MAX_CACHE_ENTRIES);
    let encoded = JSON.stringify({ version: 1, entries: bounded });
    while (encoded.length > MAX_CACHE_CHARS && bounded.length > 1) { bounded.pop(); encoded = JSON.stringify({ version: 1, entries: bounded }); }
    if (encoded.length > MAX_CACHE_CHARS || !storage?.setItem) return false;
    storage.setItem(SCOREBOARD_CACHE_KEY, encoded);
    return true;
  } catch { return false; }
}
try {
  const current = localStorage.getItem(KEY);
  const stored = JSON.parse((current === null ? localStorage.getItem(LEGACY_KEY) : current) || '{}');
  const saved = normalizePreferencePatch(stored);
  // Versions before 2.0.1 saved the chosen style without an automatic-style
  // flag. Preserve that choice; only a new profile starts in automatic mode.
  if (saved.styleId && !Object.hasOwn(stored, 'styleAuto')) saved.styleAuto = false;
  preferences = { ...preferences, ...saved };
  if (current === null) persistPreferences();
} catch { /* private browsing or corrupt storage */ }
try {
  const saved = localStorage.getItem(FAVORITE_STYLES_KEY);
  if (saved !== null) preferences.favoriteStyleIds = normalizeFavoriteStyleIds(JSON.parse(saved));
  else if (preferences.favoriteStyleIds.length) persistFavoriteStyles();
} catch { /* Favorite styles remain available in memory. */ }
try { if (typeof window !== 'undefined') channel = new BroadcastChannel(KEY); } catch { /* optional */ }
try { if (typeof window !== 'undefined') favoriteStylesChannel = new BroadcastChannel(FAVORITE_STYLES_KEY); } catch { /* optional */ }

export function getPreferences() { return { ...preferences, favorites: normalizeFavorites(preferences.favorites), favoriteStyleIds: normalizeFavoriteStyleIds(preferences.favoriteStyleIds) }; }
function sharedPreferencePatch(value) {
  const { favoriteStyleIds, ...shared } = normalizePreferencePatch(value);
  return shared;
}
function syncPreferenceURL() {
  if (!preferencesInitialized || !globalThis.location?.href || !globalThis.history?.replaceState) return;
  try {
    const url = new URL(globalThis.location.href), before = url.href;
    // A pop-out's original style/rows must not override later choices on reload.
    for (const [key, param] of [['leagueId','league'], ['styleId','style'], ['gameId','game'], ['date','date'], ['racingRows','rows']]) {
      if (!url.searchParams.has(param)) continue;
      if (preferences[key] == null) url.searchParams.delete(param);
      else url.searchParams.set(param, String(preferences[key]));
    }
    if (url.href !== before) globalThis.history.replaceState(null, '', url.href);
  } catch { /* Sandboxed or opaque windows still receive shared preferences. */ }
}
function persistPreferences() {
  try {
    const { favoriteStyleIds, ...shared } = preferences;
    const value = JSON.stringify(shared);
    if (localStorage.getItem(KEY) !== value) localStorage.setItem(KEY, value);
  } catch { /* storage is optional */ }
}
function persistFavoriteStyles() {
  try {
    const value = JSON.stringify(preferences.favoriteStyleIds);
    if (localStorage.getItem(FAVORITE_STYLES_KEY) !== value) localStorage.setItem(FAVORITE_STYLES_KEY, value);
  } catch { /* storage is optional */ }
}
function acceptPreferences(next, { persist = true } = {}) {
  const patch = normalizePreferencePatch(next);
  const updated = { ...preferences, ...patch };
  const changed = JSON.stringify(updated) !== JSON.stringify(preferences);
  preferences = updated;
  if (persist) {
    if (Object.keys(sharedPreferencePatch(patch)).length) persistPreferences();
    if (Object.hasOwn(patch, 'favoriteStyleIds')) persistFavoriteStyles();
  }
  syncPreferenceURL();
  if (changed) preferencesEvents.dispatchEvent(new CustomEvent('change', { detail: getPreferences() }));
}
if (channel) channel.onmessage = (event) => {
  if (!event.data || typeof event.data !== 'object') return;
  try {
    const current = localStorage.getItem(KEY);
    // A later user choice may already be committed while an older channel
    // message waits in another tab's queue. Only that latest record can win.
    if (current !== null && JSON.stringify(sharedPreferencePatch(JSON.parse(current))) !== JSON.stringify(sharedPreferencePatch(event.data))) return;
  } catch { /* BroadcastChannel still works when storage is unavailable. */ }
  acceptPreferences(sharedPreferencePatch(event.data), { persist: false });
};
if (favoriteStylesChannel) favoriteStylesChannel.onmessage = (event) => {
  if (!Array.isArray(event.data)) return;
  const ids = normalizeFavoriteStyleIds(event.data);
  try {
    const current = localStorage.getItem(FAVORITE_STYLES_KEY);
    if (current !== null && JSON.stringify(normalizeFavoriteStyleIds(JSON.parse(current))) !== JSON.stringify(ids)) return;
  } catch { /* Channel sync also works without local storage. */ }
  acceptPreferences({ favoriteStyleIds: ids }, { persist: false });
};
globalThis.addEventListener?.('storage', (event) => {
  if (![KEY, FAVORITE_STYLES_KEY].includes(event.key) || !event.newValue) return;
  try {
    if (localStorage.getItem(event.key) !== event.newValue) return;
    const parsed = JSON.parse(event.newValue);
    if (event.key === FAVORITE_STYLES_KEY) {
      if (Array.isArray(parsed)) acceptPreferences({ favoriteStyleIds: normalizeFavoriteStyleIds(parsed) }, { persist: false });
    } else acceptPreferences(sharedPreferencePatch(parsed), { persist: false });
  } catch { /* Ignore invalid or superseded records. */ }
});

export async function initializePreferences() {
  if (globalThis.scorebugInitialPreferences) acceptPreferences(globalThis.scorebugInitialPreferences);
  if (globalThis.scorebugDesktop) {
    try { acceptPreferences(await globalThis.scorebugDesktop.getPreferences()); } catch { /* local settings remain available */ }
    globalThis.scorebugDesktop.onPreferencesChanged?.(acceptPreferences);
  }
  const query = new URLSearchParams(globalThis.location?.search || '');
  const patch = {};
  if (validLeagueId(query.get('league'))) patch.leagueId = query.get('league');
  if (query.has('style')) Object.assign(patch, normalizePreferencePatch({styleId:query.get('style')}));
  if (patch.styleId && patch.styleId !== preferences.styleId) patch.styleAuto = false;
  if (query.has('rows') && /^\d{1,2}$/.test(query.get('rows'))) Object.assign(patch, normalizePreferencePatch({racingRows:Number(query.get('rows'))}));
  if (isSupportedGameId(query.get('game'))) patch.gameId = query.get('game');
  if (query.has('date')) patch.date = validDate(query.get('date')) ? query.get('date') : null;
  if (/^[A-Z]{2,4}$/.test(query.get('team') || '')) patch.team = query.get('team');
  if (patch.gameId) patch.leagueId ||= leagueOfId(patch.gameId);
  if (patch.leagueId && patch.leagueId !== preferences.leagueId && !Object.hasOwn(patch,'gameId')) patch.gameId = null;
  if (Object.keys(patch).length) acceptPreferences(patch);
  preferencesInitialized = true;
  syncPreferenceURL();
  return getPreferences();
}

export async function updatePreferences(patch) {
  acceptPreferences(patch);
  if (Object.keys(sharedPreferencePatch(patch)).length) channel?.postMessage(sharedPreferencePatch(getPreferences()));
  if (Object.hasOwn(normalizePreferencePatch(patch), 'favoriteStyleIds')) favoriteStylesChannel?.postMessage([...preferences.favoriteStyleIds]);
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

/** Halftime and quarter breaks belong to the same active game. */
export function isActiveGame(game) {
  return Boolean(game && !['pre', 'post'].includes(game.state) && (['live', 'halftime', 'intermission'].includes(game.phase) || game.kind === 'race' && game.phase === 'suspended'));
}

function compareGames(a, b, direction = 1) {
  const kickoff = (game) => {
    const parsed = Date.parse(game.startTime);
    return Number.isFinite(parsed) ? parsed : direction === 1 ? Infinity : -Infinity;
  };
  const left = kickoff(a), right = kickoff(b);
  if (left !== right) return (left - right) * direction;
  const teamKey = (team) => canonicalTeamId(team?.id) ? team.id.padStart(8, '0') : String(team?.abbreviation || '');
  const identity = (game) => `${teamKey(game.away)}:${teamKey(game.home)}`;
  const leftTeam = identity(a), rightTeam = identity(b);
  if (leftTeam !== rightTeam) return leftTeam < rightTeam ? -1 : 1;
  return String(a.id || '').localeCompare(String(b.id || ''));
}

export function activeGames(games) {
  return Array.isArray(games) ? games.filter(isActiveGame).sort(compareGames) : [];
}

export function selectGame(games, { gameId, favorites = [] } = {}, now = Date.now()) {
  if (!Array.isArray(games) || !games.length) return null;
  if (gameId) {
    if (!isSupportedGameId(gameId)) return null;
    const exact = games.find((game) => game?.id === gameId);
    if (exact) return exact;
    const aliased = games.filter((game) => game && aliasesOf(game).includes(gameId));
    return aliased.length === 1 ? aliased[0] : null;
  }
  const candidates = games.filter((game) => game && typeof game === 'object');
  // Ignore legacy favorite-team preferences. A stable fixture order keeps
  // Automatic on the same active game when providers reorder their lists.
  const active = activeGames(candidates);
  if (active.length) return active.find(game => matchesFavorite(game, favorites)) || active[0];
  const upcoming = candidates.filter((game) => game.state === 'pre' && game.phase === 'scheduled'
    && Date.parse(game.startTime) >= now - 3600000).sort(compareGames);
  if (upcoming.length) return upcoming[0];
  const results = candidates.filter((game) => game.phase === 'final');
  return (results.length ? results : candidates).sort((a, b) => compareGames(a, b, -1))[0] || null;
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
  if (['race', 'leaderboard'].includes(game.kind)) return [game.name || game.sessionName || 'Event', game.sessionType, game.status].filter(Boolean).join(' · ');
  return `${game.away.abbreviation} ${game.away.score ?? '–'} · ${game.home.abbreviation} ${game.home.score ?? '–'}`;
}

export class ScoreboardPoller {
  constructor({ date = null, leagueId = 'nfl', onUpdate, interval = LIVE_POLL_INTERVAL_MS, apiUrl = '/api/scoreboard', fetcher = (...args) => globalThis.fetch(...args), storage = browserStorage(), now = Date.now, baseURL } = {}) {
    this.document = globalThis.document;
    this.date = date; this.leagueId = validLeagueId(leagueId) ? leagueId : 'nfl'; this.onUpdate = onUpdate; this.interval = interval;
    this.apiUrl = new URL(apiUrl, baseURL || this.document?.baseURI || 'http://localhost/').href;
    this.fetcher = fetcher; this.storage = storage; this.now = now;
    this.data = readCachedScoreboard(date, { storage, now: now(), leagueId: this.leagueId });
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
    const restored = readCachedScoreboard(this.date, { storage: this.storage, now: this.now(), leagueId: this.leagueId });
    if (restored && (!this.data || snapshotIsOlder(this.data, restored, this.now()))) this.data = restored;
    if (this.data && feedIsStale(this.data, Boolean(this.error), this.now())) {
      this.data = cachedSnapshot(this.data, this.data.cacheOrigin || 'memory');
      this.onUpdate?.({ data: this.data, error: this.error, loading: true });
    }
    this.refresh();
  }
  setDate(date) { this.setContext({date}); }
  setLeague(leagueId) { this.setContext({leagueId, date:null}); }
  setContext({date = this.date, leagueId = this.leagueId} = {}) {
    leagueId = validLeagueId(leagueId) ? leagueId : 'nfl';
    if (this.date === date && this.leagueId === leagueId) return;
    this.date = date; this.leagueId = leagueId; this.generation++; this.controller?.abort(); this.controller = null; this.inFlight = false; clearTimeout(this.timer);
    this.data = readCachedScoreboard(date, { storage: this.storage, now: this.now(), leagueId: this.leagueId });
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
      if (this.leagueId !== 'nfl') url.searchParams.set('league', this.leagueId);
      const response = await this.fetcher(url, { cache: 'no-store', signal: controller.signal, headers: { Accept: 'application/json' } });
      retryAt = this.now() + responseRetryMs(response, null, this.now());
      const body = await response.json();
      retryAt = Math.max(retryAt, this.now() + responseRetryMs(response, body, this.now()));
      if (!response.ok) throw new Error(body?.error?.message || body?.message || (typeof body?.error === 'string' ? body.error : 'The score feed is temporarily unavailable.'));
      if (!validSnapshot(body, this.leagueId)) throw new Error('The score feed returned an unexpected response.');
      if (generation !== this.generation || this.stopped) return;

      // A newer snapshot saved by another tab also outranks an old server cache.
      const restored = readCachedScoreboard(this.date, { storage: this.storage, now: this.now(), leagueId: this.leagueId });
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
      writeCachedScoreboard(this.date, this.data, { storage: this.storage, now: this.now(), leagueId: this.leagueId });
      this.onUpdate?.({ data: this.data, error: null, loading: false });
    } catch (error) {
      if (generation !== this.generation || this.stopped) return;
      this.failures++; this.error = error;
      const restored = readCachedScoreboard(this.date, { storage: this.storage, now: this.now(), leagueId: this.leagueId });
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
