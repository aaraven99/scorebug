import { getLeague } from './sports.js';
import { normalizeFavorites } from './preferences-model.js';
import { FAVORITE_TEAM_INDEX } from './favorite-team-index.js';
import { localTeamLogo } from './team-assets.js';

/** Matching ignores accents, punctuation, case and spaces, not team identity. */
export function favoriteSearchKey(value) {
  return typeof value === 'string' ? value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') : '';
}
export const favoriteTeamKey = team => `${team.leagueId}/${team.id}`;
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
    const names = [team.name, team.shortName, team.abbreviation].map(favoriteSearchKey).filter(Boolean);
    const all = [...names, favoriteSearchKey(team.team?.name), favoriteSearchKey(getLeague(team.leagueId)?.name)].join(' ');
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

/** Only the watching league and a deliberately selected directory are fetched. */
export function createFavoriteDirectoryStore({ fetcher = globalThis.fetch, now = Date.now, timeoutMs = 10000, cacheTtlMs = 900000, onChange = () => {} } = {}) {
  const values = new Map(), pending = new Map();
  const get = id => values.get(id) || { leagueId: id, teams: [], loading: false, error: null, loadedAt: null };
  function changed(id, patch) { values.set(id, { ...get(id), ...patch }); onChange(id, get(id)); }
  function cancel(id) {
    const request = pending.get(id); if (!request) return;
    pending.delete(id); request.controller.abort(); clearTimeout(request.timer);
    changed(id, { loading: false });
  }
  function load(id, { force = false } = {}) {
    if (!getLeague(id)) return Promise.reject(new Error('Choose a supported league.'));
    if (pending.has(id) && !force) return pending.get(id).promise;
    const prior = get(id);
    if (!force && prior.loadedAt !== null && now() - prior.loadedAt < cacheTtlMs) return Promise.resolve(prior);
    if (pending.has(id)) cancel(id);
    const controller = new AbortController(), request = { controller, promise: null, timer: null };
    pending.set(id, request); changed(id, { loading: true, error: null });
    request.timer = setTimeout(() => controller.abort(), timeoutMs);
    request.promise = (async () => {
      try {
        const response = await fetcher(`/api/teams?league=${encodeURIComponent(id)}`, { signal: controller.signal, headers: { Accept: 'application/json' } });
        const body = await response.json();
        if (!response.ok || body?.leagueId !== id || !Array.isArray(body.teams) || body.teams.some(team => !validTeam(team, id))) throw new Error('Team list unavailable.');
        if (pending.get(id) !== request || controller.signal.aborted) return get(id);
        changed(id, { teams: mergeFavoriteTeams(body.teams.slice(0, 2000)), loading: false, error: null, loadedAt: now() });
      } catch (error) {
        if (pending.get(id) === request) changed(id, { loading: false, error: new Error(controller.signal.aborted ? 'Loading teams took too long.' : 'Could not load teams.') });
      } finally {
        clearTimeout(request.timer);
        if (pending.get(id) === request) pending.delete(id);
      }
      return get(id);
    })();
    return request.promise;
  }
  return { get, load,
    teams() { return mergeFavoriteTeams(FAVORITE_TEAM_INDEX, ...[...values.values()].map(value => value.teams)); },
    retain(ids) { const keep = new Set(ids); for (const id of pending.keys()) if (!keep.has(id)) cancel(id); },
    stop() { for (const id of pending.keys()) cancel(id); },
  };
}
