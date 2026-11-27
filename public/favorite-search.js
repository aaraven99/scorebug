import { getLeague, LEAGUES } from './sports.js';
import { normalizeFavorites } from './preferences-model.js';
import { FAVORITE_TEAM_INDEX } from './favorite-team-index.js';
import { localTeamLogo } from './team-assets.js';

/** Matching ignores accents, punctuation, case and spaces, not team identity. */
export function favoriteSearchKey(value) {
  return typeof value === 'string' ? value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') : '';
}
export const favoriteTeamKey = team => `${team.leagueId}/${team.id}`;
const searchRecords = new WeakMap();
function searchRecord(team) {
  let record = searchRecords.get(team);
  if (!record) {
    const names = [team.name, team.shortName, team.abbreviation].map(favoriteSearchKey).filter(Boolean);
    record = { names, all: [...names, favoriteSearchKey(team.team?.name), favoriteSearchKey(getLeague(team.leagueId)?.name)].join(' ') };
    searchRecords.set(team, record);
  }
  return record;
}
function validTeam(team, leagueId = team?.leagueId) {
  return Boolean(team && getLeague(leagueId) && team.leagueId === leagueId && typeof team.name === 'string' && team.name.trim()
    && normalizeFavorites([{ leagueId, teamId: team.id }]).length);
}
export function favoriteFromTeam(team) {
  return validTeam(team) ? normalizeFavorites([{ leagueId: team.leagueId, teamId: team.id, name: team.name,
    abbreviation: team.abbreviation, logo: localTeamLogo(team), color: team.color }])[0] || null : null;
}
/** Later directories refresh bundled metadata without conflating shared abbreviations. */
export function mergeFavoriteTeams(...groups) {
  const teams = new Map();
  for (const group of groups) for (const team of Array.isArray(group) ? group : []) {
    if (validTeam(team)) teams.set(favoriteTeamKey(team), team);
  }
  return [...teams.values()];
}
export function searchFavoriteTeams(teams, query, { leagueId = 'all', preferredLeagueId = 'nfl', limit = 20 } = {}) {
  const key = favoriteSearchKey(query), tokens = String(query || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const matches = [];
  for (const team of teams) {
    if (leagueId !== 'all' && team.leagueId !== leagueId) continue;
    const { names, all } = searchRecord(team);
    const exact = Boolean(key && names.includes(key));
    const score = !key ? 5 : names[0] === key ? 0 : exact ? 1 : names.some(name => name.startsWith(key)) ? 2
      : names.some(name => name.includes(key)) ? 3 : tokens.length && tokens.every(token => all.includes(token)) ? 4 : null;
    if (score !== null) matches.push({ team, score, exact });
  }
  matches.sort((a,b) => a.score-b.score || Number(b.team.leagueId===preferredLeagueId)-Number(a.team.leagueId===preferredLeagueId)
    || a.team.name.localeCompare(b.team.name) || a.team.leagueId.localeCompare(b.team.leagueId));
  const exact = matches.filter(match => match.exact);
  return { teams: matches.slice(0, Math.max(1, Math.min(100, limit))).map(match => match.team), total: matches.length,
    // Enter must not silently choose the Bears over Bulls for a shared "CHI".
    enterTeam: key ? exact.length === 1 ? exact[0].team : matches.length === 1 ? matches[0].team : null : null,
  };
}

const DIRECTORY_CACHE_KEY = 'scorebug.favorite-directories.v1';
const MAX_DIRECTORY_TEAMS = 10000;
const MAX_CACHE_BYTES = 3800000;
const MAX_CACHE_AGE = 7 * 86400000;
const text = (value, limit = 180) => typeof value === 'string' ? value.slice(0, limit) : null;
function compactTeam(team) {
  const compact = { id: team.id, leagueId: team.leagueId, sport: getLeague(team.leagueId)?.sport, name: text(team.name),
    shortName: text(team.shortName), abbreviation: text(team.abbreviation, 40), logo: text(team.logo || team.headshot || team.flagLogo, 500),
    color: text(team.color, 20), alternateColor: text(team.alternateColor, 20), kind: text(team.kind, 20),
    ...(team.team?.name ? { team: { name: text(team.team.name) } } : {}) };
  return Object.fromEntries(Object.entries(compact).filter(([, value]) => value != null));
}
function directoryCoverage(leagueId, supplied, truncated = false) {
  const league = getLeague(leagueId), eventOnly = league.kind !== 'match' || league.sport === 'tennis';
  const scope = ['league', 'season', 'event', 'ranking', 'catalog', 'unknown'].includes(supplied?.scope) ? supplied.scope : eventOnly ? 'event' : 'league';
  return { scope, complete: !truncated && (typeof supplied?.complete === 'boolean' ? supplied.complete : !eventOnly), retryable: supplied?.retryable === true,
    message: text(supplied?.message, 350) || (eventOnly ? 'Competitors from the reported event; this is not a complete athlete directory.' : 'All teams supplied by this league directory.'),
    ...(truncated ? { complete: false, message: 'The source directory exceeded the supported size; some teams are missing.' } : {}) };
}
function defaultStorage() { try { return globalThis.localStorage || null; } catch { return null; } }

/** One queue for all sports. Typing searches memory; it never issues requests. */
export function createFavoriteDirectoryStore({ fetcher = globalThis.fetch, now = Date.now, timeoutMs = 22000, cacheTtlMs = 900000,
  concurrency = 3, storage = defaultStorage(), onChange = () => {} } = {}) {
  const values = new Map(), pending = new Map(), active = new Set(), queue = [];
  const maximum = Math.max(1, Math.min(6, Math.floor(Number(concurrency)) || 3));
  let paused = false, mergedTeams = null, persistTimer = null;
  const get = id => values.get(id) || { leagueId: id, teams: [], loading: false, queued: false, error: null, loadedAt: null, fetchedAt: null, stale: false, fromCache: false, coverage: null, retryAt: 0 };
  try {
    const raw = storage?.getItem(DIRECTORY_CACHE_KEY);
    const cached = raw && raw.length <= MAX_CACHE_BYTES ? JSON.parse(raw) : null;
    if (cached?.version === 1 && Array.isArray(cached.leagues)) for (const entry of cached.leagues.slice(0, LEAGUES.length)) {
      if (!getLeague(entry.leagueId) || !Number.isFinite(entry.loadedAt) || entry.loadedAt > now() + 60000 || now() - entry.loadedAt > MAX_CACHE_AGE
        || !Array.isArray(entry.teams) || entry.teams.length > MAX_DIRECTORY_TEAMS || entry.teams.some(team => !validTeam(team, entry.leagueId))) continue;
      values.set(entry.leagueId, { ...get(entry.leagueId), teams: mergeFavoriteTeams(entry.teams.map(compactTeam)), loadedAt: entry.loadedAt,
        fetchedAt: text(entry.fetchedAt, 40), fromCache: true, stale: Boolean(entry.stale), coverage: directoryCoverage(entry.leagueId, entry.coverage) });
    }
  } catch { /* A blocked, full or old browser cache never prevents searching. */ }
  function persist() {
    clearTimeout(persistTimer); persistTimer = null;
    try {
      const leagues = [...values.values()].filter(value => value.loadedAt !== null).map(value => ({ leagueId: value.leagueId,
        loadedAt: value.loadedAt, fetchedAt: value.fetchedAt, teams: value.teams.map(compactTeam), coverage: value.coverage, stale: value.stale }));
      const encoded = JSON.stringify({ version: 1, leagues });
      if (encoded.length <= MAX_CACHE_BYTES) storage?.setItem(DIRECTORY_CACHE_KEY, encoded);
    } catch { /* Private browsing and quota errors leave the in-memory cache usable. */ }
  }
  function changed(id, patch) {
    if (Object.hasOwn(patch, 'teams')) mergedTeams = null;
    values.set(id, { ...get(id), ...patch }); onChange(id, get(id));
  }
  function cancel(id) {
    const request = pending.get(id); if (!request) return;
    pending.delete(id); active.delete(request); request.controller?.abort(); clearTimeout(request.timer);
    const index = queue.indexOf(request); if (index !== -1) queue.splice(index, 1);
    changed(id, { loading: false, queued: false }); request.resolve(get(id));
  }
  function retryDelay(response, body) {
    const raw = response.headers?.get?.('Retry-After'), seconds = raw && /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) * 1000 : 0;
    const dateDelay = raw && !seconds ? Date.parse(raw) - now() : 0;
    return Math.max(0, seconds || 0, Number.isFinite(dateDelay) ? dateDelay : 0, Number.isFinite(Number(body?.retryAfterMs)) ? Number(body.retryAfterMs) : 0);
  }
  async function run(request) {
    const { id } = request, controller = new AbortController(); request.controller = controller; active.add(request);
    changed(id, { queued: false, loading: true, error: null });
    request.timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(`/api/teams?league=${encodeURIComponent(id)}`, { signal: controller.signal, headers: { Accept: 'application/json' } });
      const body = await response.json();
      const delay = retryDelay(response, body);
      if (!response.ok || body?.leagueId !== id || !Array.isArray(body.teams) || body.teams.some(team => !validTeam(team, id))) {
        const error = new Error('Could not load teams.'); error.retryAt = delay ? now() + delay : 0; throw error;
      }
      if (pending.get(id) !== request || controller.signal.aborted) return;
      const truncated = body.teams.length > MAX_DIRECTORY_TEAMS, coverage = directoryCoverage(id, body.coverage, truncated);
      if (body.stale) coverage.retryable = true;
      const freshTeams = mergeFavoriteTeams(body.teams.slice(0, MAX_DIRECTORY_TEAMS).map(compactTeam));
      const combined = coverage.complete ? freshTeams : mergeFavoriteTeams(get(id).teams, freshTeams);
      const retained = combined.length > freshTeams.length;
      if (retained) coverage.message += ' Previously cached competitors remain searchable.';
      changed(id, { teams: combined.slice(0, MAX_DIRECTORY_TEAMS), loading: false, queued: false,
        error: null, loadedAt: now(), fetchedAt: text(body.fetchedAt, 40), stale: Boolean(body.stale || retained), fromCache: false,
        coverage, retryAt: delay ? now() + delay : 0 });
      clearTimeout(persistTimer); persistTimer = setTimeout(persist, 150);
    } catch (error) {
      if (pending.get(id) === request) changed(id, { loading: false, queued: false,
        error: new Error(controller.signal.aborted ? 'Loading teams took too long.' : 'Could not load teams.'), retryAt: error.retryAt || 0 });
    } finally {
      clearTimeout(request.timer); active.delete(request);
      if (pending.get(id) === request) { pending.delete(id); request.resolve(get(id)); }
      pump();
    }
  }
  function pump() {
    if (paused) return;
    while (active.size < maximum && queue.length) {
      const request = queue.shift(); if (pending.get(request.id) === request) void run(request);
    }
  }
  function load(id, { force = false, priority = false } = {}) {
    if (!getLeague(id)) return Promise.reject(new Error('Choose a supported league.'));
    if (pending.has(id) && !force) {
      const request = pending.get(id), index = queue.indexOf(request);
      if (priority && index > 0) { queue.splice(index, 1); queue.unshift(request); }
      return request.promise;
    }
    const prior = get(id);
    if (prior.retryAt > now() || !force && !prior.stale && !prior.coverage?.retryable && prior.loadedAt !== null && now() - prior.loadedAt < cacheTtlMs) return Promise.resolve(prior);
    if (pending.has(id)) cancel(id);
    paused = false;
    const request = { id, resolve: null, promise: null, controller: null, timer: null };
    request.promise = new Promise(resolve => { request.resolve = resolve; });
    pending.set(id, request); priority ? queue.unshift(request) : queue.push(request);
    changed(id, { queued: true, loading: false, error: null }); pump(); return request.promise;
  }
  function loadAll({ priorityId, retryOnly = false } = {}) {
    const ids = LEAGUES.map(league => league.id).sort((a, b) => Number(b === priorityId) - Number(a === priorityId));
    return Promise.all(ids.filter(id => !retryOnly || get(id).error || get(id).coverage?.retryable || get(id).loadedAt === null).map(id => load(id, { force: Boolean(get(id).error || get(id).coverage?.retryable), priority: id === priorityId })));
  }
  function progress(ids = LEAGUES.map(league => league.id)) {
    const leagues = ids.filter(id => getLeague(id)).map(id => get(id));
    return { leagues, total: leagues.length, loaded: leagues.filter(value => value.loadedAt !== null).length,
      loading: leagues.filter(value => value.loading).length, queued: leagues.filter(value => value.queued).length,
      failed: leagues.filter(value => value.error).length, missing: leagues.filter(value => value.loadedAt === null).length,
      partial: leagues.filter(value => value.coverage && !value.coverage.complete).length,
      retryable: leagues.filter(value => value.coverage?.retryable).length,
      stale: leagues.filter(value => value.loadedAt !== null && (value.stale || value.error || now() - value.loadedAt >= cacheTtlMs)).length };
  }
  return { get, load, loadAll, progress,
    teams() { return mergedTeams ||= mergeFavoriteTeams(FAVORITE_TEAM_INDEX, ...[...values.values()].map(value => value.teams)); },
    retain(ids) { const keep = new Set(ids); for (const id of pending.keys()) if (!keep.has(id)) cancel(id); pump(); },
    stop() { paused = true; for (const id of pending.keys()) cancel(id); persist(); },
  };
}
