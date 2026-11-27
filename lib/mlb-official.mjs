import { ScoreboardError } from './nfl.mjs';
import { MLB_TEAMS } from './official-teams.mjs';

const clean = (value, max = 160) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
const count = (value, max = 1000) => {
  if (!['number', 'string'].includes(typeof value) || value === '' || !String(value).trim()) return null;
  const n = Number(value); return Number.isInteger(n) && n >= 0 && n <= max ? n : null;
};
const stamp = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const invalid = () => new ScoreboardError('The MLB score feed returned unexpected data.', { code: 'INVALID_UPSTREAM' });
const iso = (date) => `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
export function sportsDay(now = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now));
  const value = (type) => parts.find((p) => p.type === type)?.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}
const sameMatch = (a, b) => a.leagueId === b.leagueId && a.away?.id && a.home?.id && a.away.id === b.away?.id && a.home.id === b.home?.id
  && Number.isFinite(Date.parse(a.startTime)) && Number.isFinite(Date.parse(b.startTime)) && Math.abs(Date.parse(a.startTime) - Date.parse(b.startTime)) <= 300000;
const aliases = (...ids) => [...new Set(ids.flat().filter((id) => typeof id === 'string' && /^[a-z0-9]+:[a-z0-9_.-]+$/i.test(id)))].slice(0, 12);

/** Keep a pinned provider ID discoverable when its uniquely matched ESPN game returns. */
export function reconcileProviderAliases(value, previous) {
  if (!Array.isArray(previous?.games)) return value;
  return { ...value, games: value.games.map((game) => {
    if (value.games.filter((other) => sameMatch(game, other)).length !== 1) return game;
    const matches = previous.games.filter((prior) => sameMatch(game, prior));
    if (matches.length !== 1) return game;
    const prior = matches[0];
    return { ...game, idAliases: aliases(game.idAliases, prior.id, prior.idAliases).filter((id) => id !== game.id) };
  }) };
}
function officialTeam(entry, side, line, active) {
  const raw = entry?.team, canonical = MLB_TEAMS[String(raw?.id)];
  if (!canonical) return null;
  // A source unexpectedly reusing a team ID must not attach another club's logo.
  const name = clean(raw.name).toLowerCase();
  if (name && name !== canonical.name.toLowerCase()) return null;
  const record = entry.leagueRecord;
  return { ...canonical, score: count(entry.score, 999), timeouts: null, maxTimeouts: null,
    record: count(record?.wins) !== null && count(record?.losses) !== null ? `${record.wins}-${record.losses}` : null,
    winner: typeof entry.isWinner === 'boolean' ? entry.isWinner : null,
    linescores: (Array.isArray(line.innings) ? line.innings : []).slice(0, 40).map((inning) => ({ period: count(inning.num, 40), value: count(inning[side]?.runs, 99), displayValue: count(inning[side]?.runs, 99) === null ? null : String(inning[side].runs) })),
  };
}
function normalizeGame(raw) {
  if (!/^\d{1,12}$/.test(String(raw?.gamePk || '')) || !raw.status || !stamp(raw.gameDate)) return null;
  const status = raw.status, line = raw.linescore || {}, description = clean(status.detailedState || status.abstractGameState, 100);
  let phase = /cancel/i.test(description) ? 'canceled' : /postpon/i.test(description) ? 'postponed' : /suspend/i.test(description) ? 'suspended'
    : /delay/i.test(description) ? 'delayed' : status.abstractGameState === 'Final' ? 'final' : status.abstractGameState === 'Live' ? 'live' : status.abstractGameState === 'Preview' ? 'scheduled' : 'unknown';
  if (phase === 'live' && /middle|end/i.test(line.inningState || '')) phase = 'intermission';
  const active = phase === 'live', state = ['live', 'intermission', 'suspended'].includes(phase) ? 'in' : ['final', 'canceled'].includes(phase) ? 'post' : ['scheduled', 'postponed', 'delayed'].includes(phase) ? 'pre' : 'unknown';
  const away = officialTeam(raw.teams?.away, 'away', line, active), home = officialTeam(raw.teams?.home, 'home', line, active);
  if (!away || !home || away.id === home.id) return null;
  const half = /^(?:top|bottom|middle|end)$/i.test(line.inningHalf || line.inningState || '') ? String(line.inningHalf || line.inningState).toLowerCase() : null;
  const possessionTeamId = active ? half === 'top' ? away.id : half === 'bottom' ? home.id : null : null;
  const offense = line.offense;
  const bases = !active || !offense || typeof offense !== 'object' ? [null, null, null] : ['first', 'second', 'third'].map((base) => Boolean(offense[base]?.id));
  const officialId = `mlb:mlb-${raw.gamePk}`;
  const game = { id: officialId, providerId: String(raw.gamePk), providerEventId: String(raw.gamePk), detailsGameId: null,
    leagueId: 'mlb', sport: 'baseball', kind: 'match', name: `${away.name} at ${home.name}`, shortName: `${away.abbreviation} @ ${home.abbreviation}`,
    startTime: stamp(raw.gameDate), endTime: null, state, phase, isLive: active, status: description || 'Status unavailable', statusName: clean(status.statusCode, 15),
    period: count(line.currentInning, 40), clock: null, away, home, possessionTeamId,
    downDistance: null, fieldPosition: null, playClock: null, lastPlay: null, lastPlayDetails: null,
    broadcast: null, venue: clean(raw.venue?.name, 160) || null, sourceUpdatedAt: null,
    situation: { inning: count(line.currentInning, 40), half, balls: active ? count(line.balls, 4) : null, strikes: active ? count(line.strikes, 3) : null, outs: active ? count(line.outs, 3) : null, bases, possessionTeamId,
      batter: active ? clean(offense?.batter?.fullName, 100) || null : null, pitcher: active ? clean(line.defense?.pitcher?.fullName, 100) || null : null },
    providerIds: { mlb: String(raw.gamePk) },
  };
  return game;
}
function preserveKnownIdentity(game, current, previous) {
  // Both schedules must identify a single game. A doubleheader can publish two
  // identical provisional start times, even when only one game was listed before.
  if (current.filter((other) => sameMatch(game, other)).length !== 1) return game;
  const matches = (previous?.games || []).filter((prior) => sameMatch(game, prior));
  if (matches.length !== 1) return game;
  const match = matches[0];
  return { ...game, id: match.id, idAliases: aliases(match.idAliases, game.id).filter((id) => id !== match.id),
    detailsGameId: Object.hasOwn(match, 'detailsGameId') ? match.detailsGameId : /^mlb:\d+$/.test(match.id) ? match.id : null,
    providerIds: { ...match.providerIds, ...game.providerIds },
  };
}
export function normalizeMLBScoreboard(payload, { key = 'current', fetchedAt = new Date().toISOString(), sourceUrl, previous, now = Date.now() } = {}) {
  if (!payload || !Array.isArray(payload.dates) || count(payload.totalGames, 2000) === null) throw invalid();
  const target = key === 'current' ? sportsDay(now) : iso(key);
  if (key !== 'current' && !/^\d{8}$/.test(key)) throw invalid();
  const earliest = key === 'current' ? new Date(Date.parse(`${target}T12:00:00Z`) - 86400000).toISOString().slice(0, 10) : target;
  if (payload.dates.some((day) => !/^\d{4}-\d{2}-\d{2}$/.test(day?.date || '') || !Array.isArray(day.games) || day.date < earliest || day.date > target)) throw invalid();
  if (payload.dates.reduce((total, day) => total + day.games.length, 0) !== Number(payload.totalGames)) throw invalid();
  const sources = payload.dates.flatMap((day) => {
    if (!Array.isArray(day.games) || typeof day.date !== 'string') throw invalid();
    return day.games.filter((game) => day.date === target || key === 'current' && game.status?.abstractGameState === 'Live');
  });
  const current = sources.map((raw) => normalizeGame(raw));
  if (current.some((g) => !g) || new Set(current.map((game) => game.id)).size !== current.length) throw invalid();
  const games = current.map((game) => preserveKnownIdentity(game, current, previous));
  if (new Set(games.map((game) => game.id)).size !== games.length) throw invalid();
  return { games, fetchedAt, leagueId: 'mlb', sport: 'baseball', source: 'MLB', sourceUrl,
    coverage: { level: 'scoreboard', message: 'Official MLB scores and linescore. Full player stats and play-by-play may be unavailable while the main feed is down.' } };
}
export function createMLBSource({ now = Date.now } = {}) {
  return { id: 'mlb-official', url(key) {
    const date = key === 'current' ? sportsDay(now()) : iso(key);
    const params = new URLSearchParams({ sportId: '1', hydrate: 'linescore,team' });
    if (key === 'current') {
      const yesterday = new Date(Date.parse(`${date}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
      params.set('startDate', yesterday); params.set('endDate', date);
    } else params.set('date', date);
    return `https://statsapi.mlb.com/api/v1/schedule?${params}`;
  }, normalize(payload, metadata) { return normalizeMLBScoreboard(payload, { ...metadata, now: now() }); } };
}
