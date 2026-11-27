import { createFeedService } from './feed-service.mjs';
import { createScoreboardService, normalizeGame as normalizeFootballGame, ScoreboardError, validateDate } from './nfl.mjs';
import { createGameDetailsService, normalizeGameDetails as normalizeFootballDetails, GameDetailsError } from './details.mjs';
import { getLeague, DEFAULT_LEAGUE, formatPeriod } from '../public/sports.js';
import { createMLBSource, reconcileProviderAliases } from './mlb-official.mjs';

const array = (value) => Array.isArray(value) ? value : [];
export const clean = (value, max = 160) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
export const number = (value, min = 0, max = 100000) => {
  if (!['number', 'string'].includes(typeof value) || value === '' || (typeof value === 'string' && !value.trim())) return null;
  const n = Number(value); return Number.isFinite(n) && n >= min && n <= max ? n : null;
};
const integer = (value, min = 0, max = 100000) => { const n = number(value, min, max); return Number.isInteger(n) ? n : null; };
const stamp = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const hex = (value, fallback = '#334155') => /^#?[\da-f]{6}$/i.test(String(value || '')) ? `#${String(value).replace('#', '').toLowerCase()}` : fallback;
const identifier = (value) => /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,47}$/.test(String(value ?? '')) ? String(value) : null;
const display = (value) => { const raw = typeof value === 'number' ? String(value) : clean(value, 80); return raw && !/^[-–—]+$|^n\/?a$/i.test(raw) ? raw : null; };
const readable = (value) => clean(value, 100).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ').replace(/^./, (s) => s.toUpperCase());
export function safeImage(value) {
  const raw = typeof value === 'string' ? value : value?.href;
  try { const url = new URL(raw); return url.protocol === 'https:' && url.hostname === 'a.espncdn.com' && !url.port && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
export function validateLeague(value) {
  const id = value === undefined || value === null ? DEFAULT_LEAGUE : value;
  const league = typeof id === 'string' && getLeague(id);
  if (!league) throw new ScoreboardError('Choose a supported league.', { statusCode: 400, code: 'INVALID_LEAGUE' });
  return league;
}
export function sportDate(value) { return validateDate(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.replace(/-/g, '') : value); }
export function parseSportGameId(value, league) {
  if (typeof value !== 'string' || !value.startsWith(`${league.id}:`)) throw new GameDetailsError('The game ID does not match the selected league.', { statusCode: 400, code: 'INVALID_GAME_ID' });
  const id = value.slice(league.id.length + 1);
  if (!/^\d{1,18}$/.test(id)) throw new GameDetailsError('Provide a valid game ID.', { statusCode: 400, code: 'INVALID_GAME_ID' });
  return id;
}
function phaseFor(type = {}) {
  const name = `${type.name || ''} ${type.description || ''}`.toUpperCase();
  if (/CANCEL|ABANDON/.test(name)) return 'canceled';
  if (/POSTPON/.test(name)) return 'postponed';
  if (/SUSPEND/.test(name)) return 'suspended';
  if (/DELAY/.test(name)) return 'delayed';
  if (/HALFTIME|HALF_TIME/.test(name)) return 'halftime';
  if (/END_PERIOD|END_OF_PERIOD|END_QUARTER|END_OF_QUARTER|INTERMISSION/.test(name)) return 'intermission';
  if (type.completed === true || /FINAL|FULL_TIME|STATUS_RETIRED|STATUS_WALKOVER/.test(name)) return 'final';
  return type.state === 'in' ? 'live' : type.state === 'pre' ? 'scheduled' : 'unknown';
}
function common(event, competition, league) {
  const status = competition.status || event.status || {}, type = status.type || {}, phase = phaseFor(type);
  const state = ['scheduled', 'postponed', 'delayed'].includes(phase) ? 'pre' : ['final', 'canceled'].includes(phase) ? 'post' : ['live', 'halftime', 'intermission', 'suspended'].includes(phase) ? 'in' : 'unknown';
  const rawId = identifier(competition.id || event.id);
  if (!rawId) return null;
  const rawClock = clean(status.displayClock, 20);
  const validClock = /^(?:\d{1,3}:[0-5]\d(?:\.\d)?|\d{1,2}\.\d|\d{1,3}['′]?(?:\+\d{1,2}['′]?)?)$/.test(rawClock);
  const hasClock = ['football', 'basketball', 'hockey', 'soccer', 'rugby'].includes(league.sport);
  return {
    id: `${league.id}:${rawId}`, providerId: rawId, providerEventId: identifier(event.id), detailsGameId: `${league.id}:${rawId}`,
    leagueId: league.id, sport: league.sport, kind: league.kind,
    name: clean(event.name) || league.name, shortName: clean(event.shortName, 80) || league.name,
    startTime: stamp(competition.date || event.date), endTime: stamp(competition.endDate || event.endDate),
    state, phase, isLive: phase === 'live', status: clean(type.shortDetail || type.description || type.detail) || (phase === 'unknown' ? 'Status unavailable' : readable(phase)),
    statusName: clean(type.name, 70), period: integer(status.period, 0, 999),
    clock: hasClock && validClock && state === 'in' ? rawClock : null,
    broadcast: clean(competition.broadcast || array(competition.broadcasts).flatMap((b) => array(b.names)).join(' / '), 100) || null,
    venue: clean(competition.venue?.fullName || event.circuit?.fullName) || null,
    possessionTeamId: null, downDistance: null, fieldPosition: null, playClock: null, lastPlay: null, lastPlayDetails: null,
    sourceUpdatedAt: stamp(event.lastUpdated || competition.lastUpdated),
  };
}
export function normalizeSportTeam(competitor, league, { side, timeoutCount, phase = 'unknown' } = {}) {
  const source = competitor?.team || competitor?.athlete || competitor?.roster;
  const rawId = identifier(competitor?.team?.id || competitor?.athlete?.id || competitor?.id);
  if (!source || !rawId) return null;
  const name = clean(source.displayName || source.fullName || `${source.location || ''} ${source.name || ''}`) || clean(source.shortDisplayName) || null;
  if (!name) return null;
  const lines = array(competitor.linescores).slice(0, 30).map((s, index) => ({ period: integer(s.period, 1, 30) ?? index + 1, value: number(s.value ?? s.displayValue, 0, 999), displayValue: display(s.displayValue ?? s.value), winner: typeof s.winner === 'boolean' ? s.winner : null, tiebreak: integer(s.tiebreak, 0, 999) }));
  const isPlayer = league.sport === 'tennis';
  let score = integer(typeof competitor.score === 'object' ? competitor.score?.value ?? competitor.score?.displayValue : competitor.score, 0, 999);
  if (isPlayer && score === null && lines.some((s) => s.winner !== null)) score = lines.filter((s) => s.winner === true).length;
  const records = array(competitor.records || competitor.record);
  const record = records.find((entry) => entry.type === 'total' || entry.name === 'overall');
  const rawAbbreviation = source.abbreviation || (isPlayer ? source.shortName || source.shortDisplayName : '');
  const maxTimeouts = league.sport === 'football' ? 3 : league.id === 'nba' ? 7 : null;
  const reportsTimeouts = ['football', 'basketball', 'volleyball'].includes(league.sport);
  return {
    id: `${league.id}:${rawId}`, providerId: rawId, leagueId: league.id, sport: league.sport,
    name, abbreviation: clean(rawAbbreviation, isPlayer ? 35 : 9) || name.split(' ').map((s) => s[0]).join('').slice(0, 5).toUpperCase(),
    shortName: clean(source.shortName || source.shortDisplayName, 60) || null,
    logo: safeImage(source.logo || array(source.logos).find((l) => l.rel?.includes('default'))?.href || source.logos?.[0]?.href || source.flag || source.athletes?.[0]?.flag),
    color: hex(source.color, side === 'home' ? '#314c70' : '#4d5968'), alternateColor: hex(source.alternateColor, '#ffffff'),
    score, record: clean(record?.summary || record?.displayValue, 30) || null,
    timeouts: reportsTimeouts ? integer(timeoutCount ?? competitor.timeouts, 0, maxTimeouts || 12) : null,
    maxTimeouts: maxTimeouts || null, linescores: lines,
    winner: typeof competitor.winner === 'boolean' ? competitor.winner : null,
    points: display(competitor.pointScore ?? competitor.currentPoint),
    rank: integer(competitor.curatedRank?.current, 1, 99),
    isAthlete: isPlayer, headshot: safeImage(source.headshot),
    isActive: typeof source.isActive === 'boolean' ? source.isActive : null,
  };
}
function flattenStats(entries) {
  const result = [];
  for (const stat of array(entries)) {
    if (Array.isArray(stat?.stats)) {
      for (const nested of stat.stats) result.push({ ...nested, category: clean(stat.name, 40) });
    } else if (stat && typeof stat === 'object') result.push(stat);
  }
  return result;
}
function statistic(entry, names) {
  const stats = flattenStats(entry?.statistics || entry?.stats);
  return stats.find((s) => names.includes(s.name || s.abbreviation));
}
const statNumber = (entry, names, min = 0, max = 100000) => { const s = statistic(entry, names); return number(s?.value ?? s?.displayValue, min, max); };
function situationFor(competition, game) {
  const raw = competition.situation || {}, teams = [game.away, game.home], active = ['live', 'halftime', 'intermission'].includes(game.phase);
  const teamId = (value) => teams.find((t) => t.providerId === String(value ?? '') || t.id === value)?.id || null;
  const possession = active ? teamId(raw.possession || raw.possessionTeam?.id) : null;
  game.possessionTeamId = possession;
  if (game.sport === 'basketball') {
    const competitors = array(competition.competitors);
    const bonus = (team, side) => {
      const c = competitors.find((c) => String(c.team?.id || c.id) === team.providerId);
      const value = raw[`${side}Bonus`] ?? c?.bonus;
      return typeof value === 'boolean' ? value : null;
    };
    return { possessionTeamId: possession, shotClock: active ? number(raw.shotClock, 0, 35) : null, awayBonus: bonus(game.away, 'away'), homeBonus: bonus(game.home, 'home'), bonus: null };
  }
  if (game.sport === 'baseball') {
    const statusName = competition.status?.type?.name || '';
    const half = raw.isTopInning === true || /STATUS_TOP/.test(statusName) ? 'top' : raw.isTopInning === false || /STATUS_BOTTOM/.test(statusName) ? 'bottom' : /STATUS_MIDDLE/.test(statusName) ? 'middle' : /STATUS_END_INNING/.test(statusName) ? 'end' : null;
    const base = (value) => typeof value === 'boolean' ? value : value && typeof value === 'object' && (value.athlete || value.id) ? true : null;
    if (game.phase === 'live' && half) game.possessionTeamId = half === 'top' ? game.away.id : half === 'bottom' ? game.home.id : null;
    return { inning: game.period, half, balls: active ? integer(raw.balls, 0, 4) : null, strikes: active ? integer(raw.strikes, 0, 3) : null, outs: active ? integer(raw.outs, 0, 3) : null,
      bases: active ? [base(raw.onFirst), base(raw.onSecond), base(raw.onThird)] : [null, null, null],
      batter: clean(raw.batter?.athlete?.displayName || raw.batter?.displayName, 90) || null,
      pitcher: clean(raw.pitcher?.athlete?.displayName || raw.pitcher?.displayName, 90) || null, possessionTeamId: game.possessionTeamId };
  }
  if (game.sport === 'soccer' || game.sport === 'rugby') {
    const card = (side, key) => statNumber(array(competition.competitors).find((c) => String(c.team?.id || c.id) === game[side].providerId), [key], 0, 99);
    return { addedTime: active ? integer(raw.addedTime, 0, 40) : null, tackle: game.sport === 'rugby' && active ? integer(raw.tackleCount || raw.tackle, 0, 6) : null,
      awayYellowCards: card('away', 'yellowCards'), homeYellowCards: card('home', 'yellowCards'), awayRedCards: card('away', 'redCards'), homeRedCards: card('home', 'redCards'),
      shootout: competition.status?.period === 5 ? { away: integer(competition.competitors?.find((c) => c.homeAway === 'away')?.shootoutScore), home: integer(competition.competitors?.find((c) => c.homeAway === 'home')?.shootoutScore) } : null };
  }
  if (game.sport === 'hockey') return { powerPlayTeamId: active ? teamId(raw.powerPlayTeam?.id || raw.powerPlayTeamId) : null, strength: clean(raw.strength?.text || raw.strength, 25) || null, possessionTeamId: possession };
  if (game.sport === 'tennis' || game.sport === 'volleyball') {
    const current = (team) => team.linescores.find((l) => l.period === game.period)?.value ?? null;
    const serving = array(competition.competitors).filter((c) => c.serving === true || c.possession === true);
    return { set: game.period, awaySets: game.away.score, homeSets: game.home.score,
      awayPoints: game.sport === 'tennis' ? game.away.points : active ? current(game.away) : null,
      homePoints: game.sport === 'tennis' ? game.home.points : active ? current(game.home) : null,
      servingTeamId: active ? teamId(raw.servingTeamId || raw.server || (serving.length === 1 ? serving[0].team?.id || serving[0].id : null)) : null,
      pointScore: null };
  }
  return null;
}
function raceSession(type = {}) {
  const value = clean(type.abbreviation || type.text || type.name, 45), upper = value.toUpperCase();
  if (/^FP[123]$/.test(upper)) return { sessionType: 'practice', sessionName: `Practice ${upper.slice(-1)}` };
  if (/SPRINT.*(?:QUAL|SHOOT)|^SQ$|^SS$/.test(upper)) return { sessionType: 'sprint-qualifying', sessionName: 'Sprint qualifying' };
  if (/SPRINT|^SR$/.test(upper)) return { sessionType: 'sprint', sessionName: 'Sprint' };
  if (/QUAL/.test(upper)) return { sessionType: 'qualifying', sessionName: 'Qualifying' };
  if (/PRACTICE/.test(upper)) return { sessionType: 'practice', sessionName: value || 'Practice' };
  return { sessionType: 'race', sessionName: value && upper !== 'RACE' ? value : 'Race' };
}
export function normalizeClassificationEntry(competitor, league, phase) {
  const athlete = competitor?.athlete || {}, rawId = identifier(athlete.id || competitor?.id);
  const name = clean(athlete.fullName || athlete.displayName, 100);
  if (!rawId || !name) return null;
  const rawTeam = competitor.team || athlete.team, rawTeamId = identifier(rawTeam?.id);
  const stat = (names) => { const source = statistic(competitor, names); return display(source?.displayValue ?? source?.value); };
  const score = display(typeof competitor.score === 'object' ? competitor.score?.displayValue ?? competitor.score?.value : competitor.score);
  return {
    id: `${league.id}:${rawId}`, providerId: rawId, leagueId: league.id, sport: league.sport, name,
    abbreviation: clean(athlete.abbreviation || athlete.shortName, 35) || name,
    position: phase === 'scheduled' ? null : integer(competitor.position ?? competitor.order, 1, 300),
    positionText: display(competitor.status?.position?.displayName || competitor.position?.displayValue) || null,
    number: clean(athlete.jersey || competitor.number, 5) || null,
    team: rawTeam && clean(rawTeam.displayName || rawTeam.name) ? { id: rawTeamId ? `${league.id}:${rawTeamId}` : null, name: clean(rawTeam.displayName || rawTeam.name, 100), color: hex(rawTeam.color), logo: safeImage(rawTeam.logo || rawTeam.logos?.[0]?.href) } : null,
    color: hex(rawTeam?.color || competitor.color), headshot: safeImage(athlete.headshot), flagLogo: safeImage(athlete.flag),
    gap: stat(['behindLeader', 'timeBehind', 'gap', 'gapToLeader']), time: stat(['time', 'totalTime', 'bestLapTime', 'fastestLapTime']),
    laps: statNumber(competitor, ['lapsCompleted', 'laps'], 0, 1000), status: clean(competitor.status?.type?.description || competitor.status?.displayValue, 50) || null,
    tyre: null, points: statNumber(competitor, ['points', 'championshipPoints'], 0, 10000), score,
    thru: display(competitor.status?.thru || competitor.status?.displayValue) || stat(['thru', 'holesPlayed']),
    rounds: array(competitor.linescores).filter((r) => integer(r.period, 1, 10) !== null).map((r) => ({ period: r.period, score: display(r.displayValue ?? r.value), strokes: number(r.value, 0, 200), holes: array(r.linescores).map((h) => ({ hole: integer(h.period, 1, 18), strokes: number(h.value, 0, 30), relativeToPar: display(h.scoreType?.displayValue) })) })),
    statistics: flattenStats(competitor.statistics).slice(0, 60).map((s) => ({ key: clean(s.name, 80), label: clean(s.displayName || s.label, 90) || readable(s.name), value: display(s.displayValue ?? s.value) })).filter((s) => s.key),
  };
}
export function normalizeSportGame(event, leagueInput, competitionInput) {
  const league = typeof leagueInput === 'string' ? validateLeague(leagueInput) : leagueInput;
  const competition = competitionInput || event?.competitions?.[0];
  if (!event || !competition || !league) return null;
  if (league.sport === 'football') {
    const football = normalizeFootballGame({ ...event, id: competition.id || event.id, competitions: [competition] });
    if (!football) return null;
    const prefix = (id) => id == null ? null : `${league.id}:${id}`;
    const result = { ...football, ...common(event, competition, league), leagueId: league.id, sport: league.sport, kind: 'match' };
    for (const side of ['away', 'home']) {
      const competitor = competition.competitors.find((entry) => entry.homeAway === side);
      result[side] = normalizeSportTeam(competitor, league, { side, timeoutCount: football[side].timeouts, phase: result.phase });
    }
    if (!result.away || !result.home) return null;
    result.downDistance = football.downDistance; result.fieldPosition = football.fieldPosition;
    result.possessionTeamId = prefix(football.possessionTeamId); result.lastPlay = football.lastPlay;
    result.lastPlayDetails = remapTeamIds(football.lastPlayDetails, prefix);
    result.situation = competition.situation && result.phase === 'live' ? { ...footballSituation(competition.situation), possessionTeamId: result.possessionTeamId, downDistance: football.downDistance } : null;
    return result;
  }
  const base = common(event, competition, league);
  if (!base) return null;
  if (league.kind === 'race' || league.kind === 'leaderboard') {
    const session = league.kind === 'race' ? raceSession(competition.type) : { sessionName: 'Tournament', sessionType: 'tournament' };
    const entries = array(competition.competitors).map((c) => normalizeClassificationEntry(c, league, base.phase)).filter(Boolean).sort((a, b) => (a.position ?? 999) - (b.position ?? 999));
    return { ...base, ...session, name: league.kind === 'race' ? `${base.name} · ${session.sessionName}` : base.name,
      away: null, home: null, entries, circuit: clean(event.circuit?.fullName || competition.venue?.fullName) || null,
      lap: ['race', 'sprint'].includes(session.sessionType) && base.phase === 'live' ? integer(competition.laps?.current ?? competition.status?.period, 1, 1000) : null,
      totalLaps: integer(competition.laps?.total || competition.totalLaps, 1, 1000), flag: null, raceControl: [],
      coverage: { level: 'classification', message: league.id === 'f1' ? 'Weekend sessions and reported classification. Detailed live timing and race-control messages require an OpenF1 live account.' : 'Reported standings and results; live detail depends on the event feed.' } };
  }
  const competitors = array(competition.competitors);
  const awayRaw = competitors.find((c) => c.homeAway === 'away');
  const homeRaw = competitors.find((c) => c.homeAway === 'home');
  if (!awayRaw || !homeRaw) return null;
  const away = normalizeSportTeam(awayRaw, league, { side: 'away', timeoutCount: competition.situation?.awayTimeouts, phase: base.phase });
  const home = normalizeSportTeam(homeRaw, league, { side: 'home', timeoutCount: competition.situation?.homeTimeouts, phase: base.phase });
  if (!away || !home || away.id === home.id) return null;
  const game = { ...base, away, home, tournament: league.sport === 'tennis' ? clean(event.name) : null, round: clean(competition.round?.displayName, 70) || null };
  if (league.sport === 'tennis') { game.name = `${away.name} vs ${home.name}`; game.shortName = `${away.abbreviation} / ${home.abbreviation}`; }
  game.situation = situationFor(competition, game);
  game.lastPlay = clean(competition.situation?.lastPlay?.text, 900) || null;
  game.lastPlayDetails = normalizeSportPlay(competition.situation?.lastPlay, game, []);
  return game;
}
function footballSituation(raw) { return { down: integer(raw.down, 1, 4), distance: number(raw.distance, 0, 100), yardsToEndzone: number(raw.yardsToEndzone, 0, 100), fieldPosition: clean(raw.possessionText, 40) || null, downDistance: clean(raw.shortDownDistanceText || raw.downDistanceText, 60) || null }; }
export function normalizeSportScoreboard(payload, { leagueId, fetchedAt = new Date().toISOString(), sourceUrl } = {}) {
  const league = validateLeague(leagueId);
  if (!payload || !Array.isArray(payload.events)) throw new ScoreboardError('The score feed returned unexpected data.', { code: 'INVALID_UPSTREAM' });
  const games = [];
  for (const event of payload.events.slice(0, 400)) {
    const competitions = league.sport === 'tennis' ? array(event.groupings).flatMap((g) => array(g.competitions)) : array(event.competitions);
    for (const competition of competitions.slice(0, 300)) { const game = normalizeSportGame(event, league, competition); if (game) games.push(game); }
  }
  // An announced tennis tournament without its draw is a valid empty match list.
  const tournamentWithoutDraw = league.sport === 'tennis' && payload.events.every((e) => e.id && Array.isArray(e.groupings) && !e.groupings.some((g) => array(g.competitions).length));
  if (payload.events.length && !games.length && !tournamentWithoutDraw) throw new ScoreboardError('The score feed returned incomplete games.', { code: 'INVALID_UPSTREAM' });
  const unique = [...new Map(games.map((g) => [g.id, g])).values()];
  return { games: unique, fetchedAt, leagueId: league.id, sport: league.sport, source: 'ESPN', sourceUrl: sourceUrl || `https://site.api.espn.com/apis/site/v2/sports/${league.espnPath}/scoreboard`, coverage: { level: league.kind === 'match' ? 'scoreboard' : 'classification', message: league.id === 'f1' ? 'Practice, qualifying, sprint and race sessions appear when scheduled. Detailed live timing requires an OpenF1 live account.' : league.sport === 'tennis' ? 'Matches, sets and service indicators when reported by the tournament feed.' : 'Scores and available game data from ESPN. Missing values stay unavailable.' } };
}
function remapTeamIds(value, prefix) {
  if (Array.isArray(value)) return value.map((v) => remapTeamIds(v, prefix));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, /^(?:teamId|possessionTeamId|scoringTeamId|offenseTeamId|defenseTeamId)$/.test(key) ? prefix(v) : remapTeamIds(v, prefix)]));
}
function normalizeAthlete(athlete, game, rawTeamId) {
  const rawId = identifier(athlete?.id), name = clean(athlete?.displayName || athlete?.fullName || athlete?.shortName, 100);
  if (!name) return null;
  const team = [game.away, game.home].find((t) => t && (t.providerId === String(athlete.team?.id || rawTeamId || '') || t.id === rawTeamId));
  return { id: rawId, name, teamId: team?.id || null, headshot: safeImage(athlete.headshot), position: clean(athlete.position?.abbreviation, 15) || null };
}
function rosterFor(payload, game) {
  const players = new Map();
  for (const entry of [...array(payload.boxscore?.players), ...array(payload.rosters)]) {
    const rawTeamId = entry.team?.id;
    const rawPlayers = [...array(entry.roster).map((r) => r.athlete || r), ...array(entry.statistics).flatMap((s) => array(s.athletes).map((a) => a.athlete))];
    for (const athlete of rawPlayers) { const player = normalizeAthlete(athlete, game, rawTeamId); if (player?.id) players.set(player.id, player); }
  }
  return [...players.values()];
}
function restoreRosterHeadshots(value, players) {
  if (Array.isArray(value)) return value.map((entry) => restoreRosterHeadshots(entry, players));
  if (!value || typeof value !== 'object') return value;
  const result = Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, restoreRosterHeadshots(entry, players)]));
  const player = players.get(value.id);
  // Match the known athlete and team, never a similarly numbered team or play.
  if (player?.headshot && value.name === player.name && value.teamId === player.teamId) result.headshot = player.headshot;
  return result;
}
export function normalizeSportPlay(raw, game, players = []) {
  if (!raw || !clean(raw.text || raw.description, 900)) return null;
  const known = (value) => [game.away, game.home].find((t) => t && (t.providerId === String(value ?? '') || t.id === value))?.id || null;
  const type = clean(raw.type?.text || raw.type?.description || raw.type, 90), typeKey = clean(raw.type?.type || raw.type?.abbreviation, 60);
  const teamId = known(raw.team?.id || raw.teamId);
  const scoring = raw.scoringPlay === true || raw.scoringType?.name != null;
  const participants = array(raw.participants).map((p) => {
    const id = identifier(p.athlete?.id), supplied = normalizeAthlete(p.athlete, game, raw.team?.id), roster = players.find((a) => a.id === id);
    return { role: clean(p.type, 50).toLowerCase(), player: supplied ? { ...supplied, teamId: roster?.teamId || supplied.teamId || null, headshot: supplied.headshot || roster?.headshot || null } : roster || null };
  }).filter((p) => p.player);
  const scorerRoles = ['scorer', 'shooter', 'batter', 'goal-scorer', 'goalscorer', 'try-scorer'];
  const selected = participants.filter((p) => scorerRoles.includes(p.role));
  const goalNames = game.sport === 'soccer' && scoring ? participants.filter((p) => String(raw.text || '').toLowerCase().includes(`${p.player.name.toLowerCase()} (`)) : [];
  const player = selected.length === 1 ? selected[0].player : goalNames.length === 1 ? goalNames[0].player : participants.length === 1 ? participants[0].player : game.sport === 'basketball' && raw.shootingPlay === true ? participants[0]?.player || null : null;
  const reportedScore = number(raw.scoreValue, 0, 100);
  // A confirmed goal is one goal even when this provider omits scoreValue.
  // Its cumulative team score remains unknown unless explicitly supplied.
  const scoreValue = reportedScore ?? (scoring && ['soccer', 'hockey'].includes(game.sport) && /goal/i.test(type) && raw.shootout !== true ? 1 : null);
  let eventType = null;
  if (game.sport === 'basketball' && scoring) eventType = scoreValue === 3 ? 'three-pointer' : scoreValue === 1 ? 'free-throw' : /dunk/i.test(type) ? 'dunk' : 'basket';
  if (game.sport === 'baseball' && /home.?run/i.test(`${type} ${typeKey}`)) eventType = scoreValue === 4 ? 'grand-slam' : 'home-run';
  if (['soccer', 'hockey'].includes(game.sport) && scoring) eventType = game.sport === 'soccer' && (raw.penaltyKick === true || /penalty/i.test(type)) ? 'penalty-goal' : 'goal';
  if (game.sport === 'soccer' && /red.?card|second.?yellow/i.test(`${type} ${typeKey}`)) eventType = 'red-card';
  if (game.sport === 'rugby' && scoring) eventType = /try/i.test(`${type} ${typeKey}`) ? 'try' : /conversion/i.test(type) ? 'conversion' : 'penalty-goal';
  const coordinate = raw.coordinate || raw.position;
  return {
    id: identifier(raw.id), sequenceNumber: integer(raw.sequenceNumber, 0, Number.MAX_SAFE_INTEGER), timestamp: stamp(raw.wallclock || raw.modified || raw.date), wallclock: stamp(raw.wallclock || raw.date),
    text: clean(raw.text || raw.description, 900), type, typeId: clean(String(raw.type?.id ?? ''), 30) || null, typeKey: typeKey || null,
    sport: game.sport, eventType, scoringType: eventType, period: integer(raw.period?.number ?? raw.period, 0, 1000), clock: clean(raw.clock?.displayValue, 20) || null,
    elapsedSeconds: ['soccer', 'rugby'].includes(game.sport) ? number(raw.clock?.value ?? raw.time?.value, 0, 20000) : null,
    shootout: raw.shootout === true,
    teamId, scoringTeamId: scoring ? teamId : null, offenseTeamId: teamId, defenseTeamId: null,
    scoringPlay: scoring, scoreValue, pointsAttempted: number(raw.pointsAttempted, 0, 10),
    scores: { away: number(raw.awayScore, 0, 999), home: number(raw.homeScore, 0, 999) },
    isNoPlay: raw.noPlay === true || raw.isNoPlay === true || /\bNO PLAY\b/i.test(raw.text || ''),
    isTurnover: typeof raw.isTurnover === 'boolean' ? raw.isTurnover : null,
    player, conversionPlayer: null, coordinate: coordinate && number(coordinate.x, -150, 150) !== null && number(coordinate.y, -150, 150) !== null ? { x: Number(coordinate.x), y: Number(coordinate.y) } : null,
    yardsGained: null, start: null, end: null,
  };
}
function teamStatsFor(payload, game) {
  const rows = new Map();
  for (const side of ['away', 'home']) {
    const source = array(payload.boxscore?.teams).find((entry) => String(entry.team?.id) === game[side].providerId);
    for (const stat of flattenStats(source?.statistics)) {
      const name = clean(stat.name, 80); if (!name || rows.size >= 200 && !rows.has(name)) continue;
      // Baseball repeats names under pitching/batting. Keep those columns distinct.
      const key = stat.category ? `${stat.category}.${name}` : name;
      const row = rows.get(key) || { key, label: clean(stat.label || stat.displayName, 90) || readable(name), away: null, home: null, category: stat.category || null };
      row[side] = display(stat.displayValue ?? stat.value); rows.set(key, row);
    }
  }
  return [...rows.values()];
}
function playerGroups(payload, game) {
  const groups = new Map();
  const playerSources = [...array(payload.boxscore?.players)];
  // Soccer supplies its player box score as roster[].stats rather than the
  // basketball/baseball boxscore.players layout.
  for (const roster of array(payload.rosters)) {
    if (!array(roster.roster).some((row) => array(row.stats).length) || playerSources.some((p) => String(p.team?.id) === String(roster.team?.id))) continue;
    const columns = new Map();
    for (const row of array(roster.roster)) for (const stat of array(row.stats)) if (clean(stat.name) && columns.size < 40) columns.set(stat.name, stat);
    const keys = [...columns.keys()];
    playerSources.push({ team: roster.team, statistics: [{ name: 'players', displayName: 'Player stats', keys,
      labels: keys.map((key) => clean(columns.get(key).abbreviation || columns.get(key).shortDisplayName, 40) || readable(key)),
      descriptions: keys.map((key) => clean(columns.get(key).displayName || columns.get(key).description, 140)),
      athletes: array(roster.roster).map((row) => ({ athlete: { ...row.athlete, position: row.position || row.athlete?.position }, starter: row.starter, stats: keys.map((key) => { const stat = array(row.stats).find((s) => s.name === key); return display(stat?.displayValue ?? stat?.value); }) }))
    }] });
  }
  for (const team of playerSources) {
    const side = game.away.providerId === String(team.team?.id) ? 'away' : game.home.providerId === String(team.team?.id) ? 'home' : null;
    if (!side) continue;
    for (const [index, group] of array(team.statistics).entries()) {
      const key = clean(group.name, 60) || (index === 0 ? 'players' : `players-${index}`);
      let target = groups.get(key);
      if (!target) { target = { key, label: clean(group.displayName, 80) || (key === 'players' ? 'Player stats' : readable(key)), columns: [], sources: {} }; groups.set(key, target); }
      const keys = array(group.keys), labels = array(group.labels), names = array(group.names), descriptions = array(group.descriptions);
      const columns = Array.from({ length: Math.min(40, Math.max(keys.length, labels.length, names.length)) }, (_, i) => ({ key: clean(keys[i] || names[i] || labels[i], 90) || `stat-${i}`, label: clean(labels[i] || names[i] || keys[i], 45) || `Stat ${i + 1}`, description: clean(descriptions[i], 140) || null, sourceIndex: i }));
      for (const column of columns) if (!target.columns.some((c) => c.key === column.key)) target.columns.push(column);
      target.sources[side] = { group, columns };
    }
  }
  return [...groups.values()].slice(0, 30).map((group) => {
    const output = { key: group.key, label: group.label, columns: group.columns.map(({ sourceIndex, ...c }) => c) };
    for (const side of ['away', 'home']) {
      const source = group.sources[side];
      const values = (list) => group.columns.map((c) => display(array(list)[source?.columns.find((column) => column.key === c.key)?.sourceIndex]));
      output[side] = { athletes: array(source?.group.athletes).slice(0, 140).map((row) => { const player = normalizeAthlete(row.athlete, game, game[side].providerId); return player ? { player, values: values(row.stats), starter: typeof row.starter === 'boolean' ? row.starter : null, didNotPlay: row.didNotPlay === true } : null; }).filter(Boolean), totals: values(source?.group.totals) };
    }
    return output;
  });
}
function periodScores(game) {
  const rows = new Map();
  for (const side of ['away', 'home']) for (const line of game[side].linescores || []) {
    const row = rows.get(line.period) || { period: line.period, label: formatPeriod({ ...game, phase: 'live', period: line.period, situation: null }), away: null, home: null };
    row[side] = line.value; rows.set(line.period, row);
  }
  return [...rows.values()].sort((a, b) => a.period - b.period);
}
function gameInfo(payload, competition, game) {
  const info = payload.gameInfo || {}, venue = info.venue || competition?.venue;
  return { startTime: game.startTime, status: game.status,
    venue: venue ? { name: clean(venue.fullName || venue.name) || null, city: clean(venue.address?.city, 80) || null, state: clean(venue.address?.state, 80) || null, country: clean(venue.address?.country, 80) || null, indoor: typeof venue.indoor === 'boolean' ? venue.indoor : null } : null,
    weather: null, attendance: integer(info.attendance, 0, 300000), broadcasts: game.broadcast ? [game.broadcast] : [], week: integer(payload.header?.week),
    season: payload.header?.season ? { year: integer(payload.header.season.year, 1900, 2200), type: integer(payload.header.season.type, 0, 20), label: clean(payload.header.season.name, 80) || null } : null,
    officials: array(info.officials).slice(0, 20).map((o) => ({ name: clean(o.displayName || o.fullName, 90), position: clean(o.position?.displayName || o.position?.name, 60) || null })).filter((o) => o.name) };
}
export function detailsFromScoreboard(game, { fetchedAt = new Date().toISOString(), sourceUrl, stale = false } = {}) {
  return {
    gameId: game.id, leagueId: game.leagueId, sport: game.sport, kind: game.kind, fetchedAt, statsFetchedAt: fetchedAt, statsStale: false, stale, dataScope: 'scoreboard',
    state: game.state, phase: game.phase, period: game.period, clock: game.clock,
    source: 'ESPN', sourceUrl, away: game.away, home: game.home, teamStats: [], allTeamStats: [], leaders: [], players: [], playerStats: [],
    quarterScores: game.kind === 'match' ? periodScores(game) : [], eventPlays: game.lastPlayDetails ? [game.lastPlayDetails] : [], recentPlays: game.lastPlayDetails ? [game.lastPlayDetails] : [], playByPlay: game.lastPlayDetails ? [game.lastPlayDetails] : [], scoringPlays: [],
    lastPlay: game.lastPlayDetails, drives: [], drive: null, situation: game.situation || null,
    gameInfo: gameInfo({}, null, game), entries: game.entries || [], race: game.kind === 'race' ? game : null,
    coverage: { level: 'scoreboard', message: game.kind === 'race' ? game.coverage?.message || 'Reported classification. Detailed timing is unavailable.' : game.kind === 'leaderboard' ? 'Reported leaderboard and round scores.' : 'Score and period results are available. This feed does not supply a full box score.' },
  };
}
export function normalizeSportDetails(payload, { leagueId, gameId, fetchedAt = new Date().toISOString(), sourceUrl } = {}) {
  const league = validateLeague(leagueId), rawId = parseSportGameId(gameId, league);
  if (league.sport === 'football') {
    const details = normalizeFootballDetails(payload, { gameId: rawId, fetchedAt, sourceUrl: sourceUrl || `https://site.api.espn.com/apis/site/v2/sports/${league.espnPath}/summary?event=${rawId}` });
    let prefixed = remapTeamIds(details, (id) => id == null ? null : `${league.id}:${id}`);
    prefixed.gameId = gameId; prefixed.leagueId = league.id; prefixed.sport = league.sport; prefixed.kind = 'match';
    const game = normalizeSportGame(payload.header, league);
    for (const side of ['away', 'home']) prefixed[side] = game?.[side] || { ...details[side], id: `${league.id}:${details[side].id}`, providerId: details[side].id, leagueId: league.id, sport: league.sport };
    if (game) {
      prefixed.clock = game.clock;
      // The legacy NFL parser deliberately accepts only NFL headshot paths.
      // College photos are restored from this game's verified ESPN roster.
      prefixed = restoreRosterHeadshots(prefixed, new Map(rosterFor(payload, game).map((player) => [player.id, player])));
    }
    return prefixed;
  }
  const header = payload?.header, competition = array(header?.competitions).find((c) => String(c.id) === rawId) || header?.competitions?.[0];
  if (!header || !competition || String(header.id) !== rawId && String(competition.id) !== rawId) throw new GameDetailsError('The details feed returned a different game.', { code: 'INVALID_DETAILS' });
  const game = normalizeSportGame({ ...header, id: header.id, name: header.name, shortName: header.shortName }, league, competition);
  if (!game || game.id !== gameId || game.kind !== 'match') throw new GameDetailsError('Game details are unavailable.', { code: 'INVALID_DETAILS' });
  const players = rosterFor(payload, game), allTeamStats = teamStatsFor(payload, game), groups = playerGroups(payload, game);
  const keyEvents = array(payload.keyEvents), eventTexts = new Set(keyEvents.map((p) => clean(p.text, 900)).filter(Boolean));
  const commentary = array(payload.commentary).filter((p) => clean(p.text, 900) && !eventTexts.has(clean(p.text, 900))).map((p) => ({ ...p, id: `commentary-${identifier(p.sequence) || identifier(p.id) || 'unknown'}`, sequenceNumber: p.sequence, clock: p.time || p.clock, type: { text: 'Commentary' }, scoringPlay: false }));
  const sourcePlays = [...array(payload.plays), ...array(payload.scoringPlays), ...keyEvents, ...commentary, ...array(competition.details)];
  const unique = new Map();
  for (const raw of sourcePlays) { const play = normalizeSportPlay(raw, game, players); if (play) unique.set(play.id || `${play.timestamp}:${play.period}:${play.text}`, play); }
  const plays = [...unique.values()].sort((a, b) => {
    if (a.elapsedSeconds !== null && b.elapsedSeconds !== null && a.elapsedSeconds !== b.elapsedSeconds) return b.elapsedSeconds - a.elapsedSeconds;
    if (a.timestamp && b.timestamp && a.timestamp !== b.timestamp) return Date.parse(b.timestamp) - Date.parse(a.timestamp);
    if (a.sequenceNumber !== null && b.sequenceNumber !== null && a.sequenceNumber !== b.sequenceNumber) return b.sequenceNumber - a.sequenceNumber;
    if (/^\d+$/.test(a.id || '') && /^\d+$/.test(b.id || '')) return BigInt(a.id) < BigInt(b.id) ? 1 : -1;
    return 0;
  });
  const priorities = { basketball: ['fieldGoalPct', 'threePointFieldGoalPct', 'totalRebounds', 'assists', 'turnovers', 'blocks'], baseball: ['batting.runs', 'batting.hits', 'fielding.errors', 'batting.homeRuns', 'batting.walks', 'batting.strikeouts'], hockey: ['shotsTotal', 'powerPlayGoals', 'hits', 'blockedShots', 'giveaways', 'faceoffsWon'], soccer: ['possessionPct', 'totalShots', 'shotsOnTarget', 'foulsCommitted', 'yellowCards', 'redCards'] }[game.sport] || [];
  const selected = priorities.map((key) => allTeamStats.find((s) => s.key === key)).filter(Boolean);
  const teamStats = [...selected, ...allTeamStats.filter((r) => !selected.includes(r))].slice(0, 8);
  return { ...detailsFromScoreboard(game, { fetchedAt, sourceUrl }), dataScope: 'full', sourceUpdatedAt: stamp(payload.meta?.lastUpdatedAt),
    allTeamStats, teamStats, players, playerStats: groups, quarterScores: periodScores(game), gameInfo: gameInfo(payload, competition, game),
    eventPlays: plays.slice(0, 32), recentPlays: plays.slice(0, 3), lastPlay: plays[0] || game.lastPlayDetails,
    playByPlay: plays.slice(0, 500), scoringPlays: plays.filter((p) => p.scoringPlay && !p.isNoPlay).slice(0, 250),
    coverage: { level: 'full', message: 'Reported game statistics and plays. Unreported values remain unavailable.' },
  };
}
export function normalizeSportTeams(payload, leagueInput) {
  const league = typeof leagueInput === 'string' ? validateLeague(leagueInput) : leagueInput;
  const raw = array(payload.sports).flatMap((s) => array(s.leagues).flatMap((l) => array(l.teams)));
  const teams = raw.map((entry) => normalizeSportTeam({ team: entry.team || entry, id: entry.team?.id || entry.id }, league)).filter(Boolean);
  if (!raw.length && !Array.isArray(payload.sports)) throw new ScoreboardError('The team list is temporarily unavailable.', { code: 'INVALID_TEAMS' });
  return [...new Map(teams.map((t) => [t.id, t])).values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Public named catalogs and published rankings, distinct from event entrants. */
export function normalizeCompetitorDirectory(payload, { league, fetchedAt, sourceUrl } = {}) {
  const ranking = league.sport === 'tennis';
  const raw = ranking ? array(payload?.rankings).flatMap(group => array(group.ranks).map(row => row.athlete)).filter(Boolean) : array(payload?.items);
  if (ranking ? !Array.isArray(payload?.rankings) : !Array.isArray(payload?.items)) throw new ScoreboardError('The competitor directory returned unexpected data.', { code: 'INVALID_TEAMS' });
  const teams = [...new Map(raw.slice(0, 10000).map(athlete => {
    const team = normalizeSportTeam({ athlete: { ...athlete, shortName: athlete.shortName || athlete.shortname } }, league);
    return team ? { ...team, isAthlete: true, kind: league.kind === 'race' ? 'driver' : 'athlete',
      logo: safeImage(athlete.headshot) || team.logo,
      ...(athlete.team?.displayName ? { team: { name: clean(athlete.team.displayName) } } : {}) } : null;
  }).filter(Boolean).map(team => [team.id, team])).values()].sort((a, b) => a.name.localeCompare(b.name));
  const count = integer(payload?.count, 0, 1000000), pages = integer(payload?._directoryPageCount ?? payload?.pageCount, 1, 1000);
  const loadedPages = integer(payload?._directoryPagesLoaded ?? payload?.pageIndex, 1, 1000);
  const complete = !ranking && count !== null && teams.length === count && loadedPages === pages;
  if (raw.length && !teams.length) throw new ScoreboardError('The competitor directory contained no identifiable names.', { code: 'INVALID_TEAMS' });
  return { teams, leagueId: league.id, fetchedAt, sourceUrl, source: 'ESPN', coverage: {
    scope: ranking ? 'ranking' : 'catalog', complete, count: teams.length, sourceCount: count ?? raw.length,
    pagesLoaded: ranking ? null : loadedPages, pageCount: ranking ? null : pages,
    updatedAt: ranking ? array(payload.rankings).map(group => stamp(group.update)).filter(Boolean).sort().at(-1) || null : null,
    message: ranking ? `Published ${league.name} rankings; players outside the published list may be missing.`
      : league.kind === 'race' ? `Named ${league.name} driver records, including reserves and previously listed drivers.`
      : `Current and historical golfers supplied by the ${league.name} directory.${complete ? '' : ' Some directory pages or records are unavailable.'}`,
  } };
}

export function createSportsService({ fetchImpl = globalThis.fetch, now = Date.now, cacheTtlMs = 1000, f1Enricher = null } = {}) {
  const readers = new Map(), detailReaders = new Map(), teamReaders = new Map(), competitorReaders = new Map(), seenGames = new Map();
  const nflBoard = createScoreboardService({ fetchImpl, now, cacheTtlMs });
  const nflDetails = createGameDetailsService({ fetchImpl, now, cacheTtlMs });
  function scoreboardReader(league) {
    if (readers.has(league.id)) return readers.get(league.id);
    // ESPN uses different Division I group IDs for football and basketball.
    // Keep 300: the football endpoint silently falls back to 25 at limit=1000.
    const url = (host, key) => `https://${host}/apis/site/v2/sports/${league.espnPath}/scoreboard?limit=300${league.scoreboardGroup ? `&groups=${league.scoreboardGroup}` : ''}${key === 'current' ? '' : `&dates=${key}`}`;
    const read = createFeedService({
      sources: [{ id: 'espn-site', url: (key) => url('site.api.espn.com', key) }, { id: 'espn-web', url: (key) => url('site.web.api.espn.com', key) }, ...(league.id === 'mlb' ? [createMLBSource({ now })] : [])],
      normalize: (payload, meta) => reconcileProviderAliases(normalizeSportScoreboard(payload, { ...meta, leagueId: league.id }), meta.previous),
      ErrorType: ScoreboardError, label: `${league.name} score feed`, invalidCode: 'INVALID_UPSTREAM', unavailableCode: 'UPSTREAM_UNAVAILABLE', timeoutCode: 'UPSTREAM_TIMEOUT',
      fetchImpl, now, cacheTtlMs,
      acceptValue(next, previous, checkedAt) { return !previous || checkedAt - Date.parse(previous.fetchedAt) > 900000 || previous.games.filter((g) => g.state === 'in').every((g) => next.games.some((n) => n.id === g.id || n.idAliases?.includes(g.id))); },
    });
    readers.set(league.id, read); return read;
  }
  async function scoreboard({ leagueId, league: leagueAlias, date } = {}) {
    const league = validateLeague(leagueId ?? leagueAlias), validDate = sportDate(date);
    if (league.id === 'nfl') {
      const data = await nflBoard({ date: validDate });
      return { ...data, leagueId: 'nfl', sport: 'football', games: data.games.map((g) => ({ ...g, leagueId: 'nfl', sport: 'football', kind: 'match', away: { ...g.away, leagueId: 'nfl', sport: 'football' }, home: { ...g.home, leagueId: 'nfl', sport: 'football' } })) };
    }
    const data = await scoreboardReader(league)(validDate || 'current');
    for (const game of data.games) seenGames.set(game.id, { game, date: validDate, fetchedAt: data.fetchedAt, source: data.source, sourceUrl: data.sourceUrl, feedStatus: data.feedStatus, sourceId: data.sourceId, stale: data.stale });
    if (seenGames.size > 3000) for (const key of [...seenGames.keys()].slice(0, seenGames.size - 3000)) seenGames.delete(key);
    return data;
  }
  function detailsReader(league) {
    if (detailReaders.has(league.id)) return detailReaders.get(league.id);
    const url = (host, id) => `https://${host}/apis/site/v2/sports/${league.espnPath}/summary?event=${encodeURIComponent(id)}`;
    const read = createFeedService({ sources: [{ id: 'espn-site', timeoutMs: 3000, url: (id) => url('site.api.espn.com', id) }, { id: 'espn-web', timeoutMs: 3000, url: (id) => url('site.web.api.espn.com', id) }],
      normalize: (payload, meta) => normalizeSportDetails(payload, { ...meta, leagueId: league.id, gameId: `${league.id}:${meta.key}` }),
      ErrorType: GameDetailsError, label: `${league.name} details feed`, invalidCode: 'INVALID_DETAILS', unavailableCode: 'DETAILS_UNAVAILABLE', timeoutCode: 'DETAILS_TIMEOUT', fetchImpl, now, cacheTtlMs });
    detailReaders.set(league.id, read); return read;
  }
  async function details({ leagueId, league: leagueAlias, gameId, date } = {}) {
    const league = validateLeague(leagueId ?? leagueAlias);
    if (league.id === 'nfl') { const data = await nflDetails({ gameId }); return { ...data, leagueId: 'nfl', sport: 'football', kind: 'match' }; }
    const rawId = parseSportGameId(gameId, league), validDate = sportDate(date);
    const derived = league.kind !== 'match' || league.sport === 'tennis';
    if (!derived) {
      try { return await detailsReader(league)(rawId); }
      catch (error) {
        // A scoreboard remains useful when a league has no box-score endpoint.
        // Never label a partial score frame as full statistics.
        if (error.statusCode === 400) throw error;
      }
    }
    const known = seenGames.get(gameId), requestDate = validDate || known?.date;
    const data = known && now() - Date.parse(known.fetchedAt) < 5000 && (!validDate || validDate === known.date)
      ? { games: [known.game], fetchedAt: known.fetchedAt, source: known.source, sourceUrl: known.sourceUrl, feedStatus: known.feedStatus, sourceId: known.sourceId, stale: known.stale }
      : await scoreboard({ leagueId: league.id, date: requestDate });
    const game = data.games.find((g) => g.id === gameId);
    if (!game) throw new GameDetailsError('This game is not in the selected date. Choose its date to view it.', { statusCode: 404, code: 'GAME_NOT_FOUND' });
    let result = { ...detailsFromScoreboard(game, data), feedStatus: data.feedStatus, sourceId: data.sourceId, stale: data.stale };
    if (!derived) result = { ...result, dataScope: 'plays', statsFetchedAt: null, statsStale: true };
    if (league.id === 'f1' && f1Enricher) result = await f1Enricher(result, game);
    return result;
  }
  function competitorReader(league) {
    if (competitorReaders.has(league.id)) return competitorReaders.get(league.id);
    const sources = league.sport === 'tennis' ? ['site.api.espn.com', 'site.web.api.espn.com'].map((host, index) => ({
      id: index ? 'espn-rankings-web' : 'espn-rankings', url: () => `https://${host}/apis/site/v2/sports/${league.espnPath}/rankings?limit=300`,
    })) : [{
      id: 'espn-athlete-catalog', timeoutMs: 18000, maxRequests: 6,
      url: () => `https://sports.core.api.espn.com/v3/sports/${league.espnPath}/athletes?limit=1000&page=1`,
      async load({ sourceUrl, requestJson }) {
        const first = await requestJson(sourceUrl, { metadata: true });
        const pageCount = integer(first?.pageCount, 1, 1000), count = integer(first?.count, 0, 1000000);
        if (!Array.isArray(first?.items) || first.pageIndex !== 1 || pageCount === null || count === null) throw new ScoreboardError('The competitor directory returned unexpected pages.', { code: 'INVALID_TEAMS' });
        // At most six pages and four simultaneous reads, under one 18s deadline.
        const pages = [first], lastPage = Math.min(pageCount, 6);
        for (let start = 2; start <= lastPage; start += 4) {
          const batch = Array.from({ length: Math.min(4, lastPage - start + 1) }, (_, index) => start + index);
          const loaded = await Promise.all(batch.map(async page => {
            const url = new URL(sourceUrl); url.searchParams.set('page', String(page));
            const payload = await requestJson(url.href, { metadata: true });
            if (!Array.isArray(payload?.items) || payload.pageIndex !== page || payload.pageCount !== pageCount || payload.count !== count) throw new ScoreboardError('The competitor directory changed while loading.', { code: 'INVALID_TEAMS' });
            return payload;
          }));
          pages.push(...loaded);
        }
        return { payload: { ...first, items: pages.flatMap(page => page.items), _directoryPageCount: pageCount, _directoryPagesLoaded: pages.length } };
      },
    }];
    const read = createFeedService({ sources, normalize: (payload, meta) => normalizeCompetitorDirectory(payload, { ...meta, league }),
      ErrorType: ScoreboardError, label: `${league.name} competitor directory`, invalidCode: 'INVALID_TEAMS', unavailableCode: 'TEAMS_UNAVAILABLE', timeoutCode: 'TEAMS_TIMEOUT',
      fetchImpl, now, cacheTtlMs: 900000, maxStaleMs: 86400000, totalTimeoutMs: 18000 });
    competitorReaders.set(league.id, read); return read;
  }
  async function teams({ leagueId, league: leagueAlias } = {}) {
    const league = validateLeague(leagueId ?? leagueAlias);
    if (league.kind !== 'match' || league.sport === 'tennis') {
      const [directoryResult, boardResult] = await Promise.allSettled([competitorReader(league)('directory'), scoreboard({ leagueId: league.id })]);
      const directory = directoryResult.status === 'fulfilled' ? directoryResult.value : null;
      const board = boardResult.status === 'fulfilled' ? boardResult.value : null;
      const competitors = board?.games.flatMap((g) => g.entries || [g.away, g.home]).filter(Boolean) || [];
      const entrants = competitors.map((entry) => ({ ...entry, leagueId: league.id, sport: league.sport,
        logo: entry.logo || entry.headshot || entry.flagLogo || null, abbreviation: entry.abbreviation || entry.name, kind: league.kind === 'race' ? 'driver' : 'athlete' }));
      const list = new Map((directory?.teams || []).map(entry => [entry.id, entry]));
      for (const entry of entrants) list.set(entry.id, { ...list.get(entry.id), ...entry, logo: entry.logo || list.get(entry.id)?.logo || null });
      if (directory) return { ...directory, teams: [...list.values()].sort((a, b) => a.name.localeCompare(b.name)),
        eventSourceUrl: board?.sourceUrl || null, eventFetchedAt: board?.fetchedAt || null,
        coverage: { ...directory.coverage, count: list.size, eventEntrants: new Set(entrants.map(entry => entry.id)).size,
          message: `${directory.coverage.message}${entrants.length ? ' Reported event entrants are included too.' : ''}` } };
      if (!board) throw directoryResult.reason || boardResult.reason;
      return { teams: [...list.values()], leagueId: league.id, fetchedAt: board.fetchedAt, stale: board.stale, source: board.source, sourceUrl: board.sourceUrl,
        coverage: { scope: 'event', complete: false, count: list.size,
          retryable: true, message: `The broader ${league.name} directory is temporarily unavailable. Only reported event entrants are available; this is not a complete athlete directory.` } };
    }
    if (!teamReaders.has(league.id)) teamReaders.set(league.id, createFeedService({ sources: ['site.api.espn.com', 'site.web.api.espn.com'].map((host, index) => ({
      id: index === 0 ? 'espn-site' : 'espn-web', url: () => `https://${host}/apis/site/v2/sports/${league.espnPath}/teams?limit=1000`,
      async load({ sourceUrl, requestJson }) {
        const payload = await requestJson(sourceUrl, { metadata: true });
        // The directory omits this verified 2026 team before calendar 2026
        // ended. Keep the actual Connecticut team selectable for that season.
        const listed = payload?.sports?.[0]?.leagues?.[0]?.teams;
        if (league.id === 'wnba' && new Date(now()).getUTCFullYear() === 2026 && Array.isArray(listed) && !listed.some((entry) => String(entry.team?.id) === '18')) {
          const extra = await requestJson(`https://${host}/apis/site/v2/sports/basketball/wnba/teams/18`, { metadata: true });
          if (String(extra?.team?.id) === '18' && extra.team.abbreviation === 'CON' && extra.team.displayName === 'Connecticut Sun') listed.push({ team: extra.team });
        }
        return { payload };
      },
    })), normalize: (payload, { fetchedAt, sourceUrl }) => {
      const teams = normalizeSportTeams(payload, league).map((team) => league.id === 'nfl' ? { ...team, id: team.providerId } : team);
      const supplied = array(payload.sports).flatMap(sport => array(sport.leagues).flatMap(item => array(item.teams)));
      const placeholders = supplied.filter(entry => ['-1', '-2'].includes(String(entry.team?.id || entry.id)) && /^TBD(?: TBD)?$/i.test(entry.team?.displayName || entry.displayName || '')).length;
      const fullPage = supplied.length >= 1000;
      return { teams, leagueId: league.id, fetchedAt, sourceUrl, source: 'ESPN', coverage: { scope: 'league', complete: !fullPage, count: teams.length,
        sourceCount: supplied.length, excludedPlaceholders: placeholders,
        message: fullPage ? 'The provider returned a full page; further teams may be missing.' : league.id === 'cfb'
          ? 'All named schools supplied by the college football directory, including schools outside the Division I scoreboard.'
          : `All named teams supplied by the ${league.name} directory.` } };
    }, ErrorType: ScoreboardError, label: 'team list', invalidCode: 'INVALID_TEAMS', unavailableCode: 'TEAMS_UNAVAILABLE', timeoutCode: 'TEAMS_TIMEOUT', fetchImpl, now, cacheTtlMs: 900000, maxStaleMs: 86400000 }));
    return teamReaders.get(league.id)('teams');
  }
  return { scoreboard, details, teams };
}
