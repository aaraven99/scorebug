import { downDistance, normalizeGame, normalizePlay, normalizePlayer } from './nfl.mjs';
import { createFeedService } from './feed-service.mjs';

const SUMMARY_URL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary';
const CACHE_TTL_MS = 1_000;

export class GameDetailsError extends Error {
  constructor(message, { statusCode = 502, code = 'DETAILS_UNAVAILABLE', cause } = {}) {
    super(message, { cause });
    this.name = 'GameDetailsError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

const text = (value, maxLength = 160) => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength)
  : '';
const array = (value) => Array.isArray(value) ? value : [];
function integer(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (value === null || value === undefined || typeof value === 'boolean' || (typeof value === 'string' && !value.trim())) return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : null;
}
function timestamp(value) {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}
function clock(value) {
  const candidate = text(value, 8);
  return /^\d{1,2}:[0-5]\d$/.test(candidate) ? candidate : null;
}
function knownTeamId(value, teams) {
  const candidate = String(value ?? '');
  return teams.some((team) => team.id === candidate) ? candidate : null;
}

export function validateGameId(gameId) {
  if (typeof gameId !== 'string' || !/^\d{1,16}$/.test(gameId)) {
    throw new GameDetailsError('Provide one numeric NFL game ID.', { statusCode: 400, code: 'INVALID_GAME_ID' });
  }
  return gameId;
}

const STAT_COLUMNS = [
  { key: 'totalYards', label: 'Total yards', numeric: true },
  { key: 'netPassingYards', label: 'Passing yards', numeric: true },
  { key: 'rushingYards', label: 'Rushing yards', numeric: true },
  { key: 'thirdDownEff', label: '3rd down' },
  { key: 'turnovers', label: 'Turnovers', numeric: true },
  { key: 'possessionTime', label: 'Possession' },
];

function statValue(team, column) {
  const stat = array(team?.statistics).find((entry) => entry?.name === column.key);
  if (!stat) return null;
  const display = text(stat.displayValue, 50);
  if (display && !/^(?:[-–—]+|n\/?a)$/i.test(display)) return display;
  // ESPN's value for possession is seconds and for 3rd downs is a fraction.
  // Only simple totals can fall back to their numeric value without changing units.
  const number = column.numeric ? integer(stat.value, column.key === 'turnovers' ? 0 : -1000, 10000) : null;
  return number === null ? null : String(number);
}

function normalizedPosition(position, teams) {
  if (!position || typeof position !== 'object') return null;
  return {
    teamId: knownTeamId(position.team?.id ?? position.possession, teams),
    down: integer(position.down, 1, 4),
    distance: integer(position.distance, 0, 100),
    fieldPosition: text(position.possessionText, 30) || null,
    downDistance: downDistance(position),
    yardsToEndzone: integer(position.yardsToEndzone, 0, 100),
  };
}

function summaryPlayers(payload, teams) {
  const players = new Map();
  const add = (athlete, teamId, category = null) => {
    const player = normalizePlayer(athlete, teams, { teamId });
    if (!player?.id || !player.teamId) return;
    const previous = players.get(player.id);
    const categories = new Set(previous?.statCategories || []);
    if (category && /^[a-zA-Z]{1,30}$/.test(category)) categories.add(category);
    players.set(player.id, { ...player, headshot: player.headshot || previous?.headshot || null, position: player.position || previous?.position || null, statCategories: [...categories].slice(0, 12) });
  };
  for (const entry of array(payload.boxscore?.players)) {
    const teamId = knownTeamId(entry?.team?.id, teams);
    if (!teamId) continue;
    for (const group of array(entry.statistics)) for (const row of array(group?.athletes)) add(row?.athlete, teamId, group?.name);
  }
  const drives = [...array(payload.drives?.previous), ...(payload.drives?.current ? [payload.drives.current] : [])];
  for (const play of drives.flatMap((drive) => array(drive?.plays))) {
    for (const participant of array(play?.participants)) add(participant?.athlete);
  }
  return [...players.values()].slice(0, 128);
}

function playsInOrder(payload, teams, players) {
  const drives = [...array(payload.drives?.previous), ...(payload.drives?.current ? [payload.drives.current] : [])];
  const scoring = new Map(array(payload.scoringPlays).map((play) => [String(play?.id), play]));
  const unique = new Map();
  const rawPlays = [...array(payload.scoringPlays).map((play) => ({ ...play, scoringPlay: true })), ...drives.flatMap((drive) => array(drive?.plays))];
  for (const [index, play] of rawPlays.entries()) {
    const scoringRecord = scoring.get(String(play?.id));
    const normalized = normalizePlay(play, teams, { scoringTeamId: scoringRecord?.team?.id, scoringType: scoringRecord?.scoringType?.name, scoringRecord, players });
    if (!normalized) continue;
    const order = integer(play.sequenceNumber) ?? index;
    const key = normalized.id || `${order}:${normalized.text}`;
    unique.set(key, { order, index, play: normalized });
  }
  return [...unique.values()].sort((a, b) => {
    if (a.play.id && b.play.id) return BigInt(a.play.id) > BigInt(b.play.id) ? -1 : BigInt(a.play.id) < BigInt(b.play.id) ? 1 : 0;
    return b.order - a.order || b.index - a.index;
  }).map((entry) => entry.play);
}

function normalizeLeader(payload, teamId, key) {
  const group = array(payload.leaders).find((entry) => String(entry?.team?.id) === teamId);
  const category = array(group?.leaders).find((entry) => entry?.name === key);
  const leader = array(category?.leaders)[0];
  const name = text(leader?.athlete?.displayName || leader?.athlete?.fullName, 90);
  const displayValue = text(leader?.displayValue, 100);
  if (!name || !displayValue) return null;
  return { name, displayValue };
}

/**
 * Summary provides cumulative team/player stats and historical plays. Current
 * field position should come from the lighter scoreboard response. A play's
 * end position is never relabeled as the current game situation.
 */
export function normalizeGameDetails(payload, { gameId, fetchedAt = new Date().toISOString(), sourceUrl } = {}) {
  const requested = gameId === undefined ? undefined : validateGameId(gameId);
  const id = String(payload?.header?.id ?? '');
  const competition = payload?.header?.competitions?.[0];
  const game = normalizeGame({ id, date: competition?.date, competitions: competition ? [competition] : [] });
  if (!game || (requested && requested !== id)) {
    throw new GameDetailsError('The game details feed returned an unexpected game.', { code: 'INVALID_DETAILS' });
  }
  const teamRef = (team) => ({ id: team.id, abbreviation: team.abbreviation, name: team.name });
  const away = teamRef(game.away);
  const home = teamRef(game.home);
  const teams = [away, home];
  const players = summaryPlayers(payload, teams);
  const statsTeams = array(payload.boxscore?.teams);
  const awayStats = statsTeams.find((entry) => String(entry?.team?.id) === away.id);
  const homeStats = statsTeams.find((entry) => String(entry?.team?.id) === home.id);
  const teamStats = STAT_COLUMNS.map((column) => ({ key: column.key, label: column.label, away: statValue(awayStats, column), home: statValue(homeStats, column) }));
  const leaderColumns = [
    ['passingYards', 'Passing'], ['rushingYards', 'Rushing'], ['receivingYards', 'Receiving'],
  ];
  const leaders = leaderColumns.map(([key, label]) => ({ key, label, away: normalizeLeader(payload, away.id, key), home: normalizeLeader(payload, home.id, key) }));
  const eventPlays = playsInOrder(payload, teams, players).slice(0, 24);
  const recentPlays = eventPlays.slice(0, 3);
  const rawDrive = payload.drives?.current || array(payload.drives?.previous).at(-1);
  const drive = rawDrive && typeof rawDrive === 'object' ? {
    teamId: knownTeamId(rawDrive.team?.id, teams),
    description: text(rawDrive.description, 160) || null,
    plays: integer(rawDrive.offensivePlays, 0, 100),
    yards: integer(rawDrive.yards, -100, 100),
    timeElapsed: clock(rawDrive.timeElapsed?.displayValue),
    result: text(rawDrive.displayResult || rawDrive.result, 80) || null,
    isActive: game.phase === 'live' && !rawDrive.result && Boolean(payload.drives?.current),
  } : null;
  const rawSituation = competition.situation;
  const position = rawSituation && game.phase === 'live' ? normalizedPosition(rawSituation, teams) : null;
  const situation = position ? {
    possessionTeamId: knownTeamId(rawSituation.possession, teams),
    down: position.down,
    distance: position.distance,
    fieldPosition: position.fieldPosition,
    downDistance: position.downDistance,
    yardsToEndzone: position.yardsToEndzone,
  } : null;
  return {
    gameId: id,
    fetchedAt,
    sourceUpdatedAt: timestamp(payload.meta?.lastUpdatedAt),
    state: game.state,
    phase: game.phase,
    period: game.period,
    clock: game.clock,
    source: 'ESPN',
    sourceUrl: sourceUrl || `${SUMMARY_URL}?event=${id}`,
    away,
    home,
    teamStats,
    leaders,
    players,
    lastPlay: recentPlays[0] || null,
    recentPlays,
    eventPlays,
    drive,
    situation,
  };
}

export function createGameDetailsService({ fetchImpl = globalThis.fetch, now = Date.now, cacheTtlMs = CACHE_TTL_MS } = {}) {
  const read = createFeedService({
    sources: [
      { id: 'espn-site', url: (id) => `${SUMMARY_URL}?event=${id}` },
      { id: 'espn-web', url: (id) => `https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${id}` },
      { id: 'espn-cdn', url: (id) => `https://cdn.espn.com/core/nfl/game?xhr=1&gameId=${id}`, select: (payload) => payload?.gamepackageJSON },
    ],
    normalize: (payload, { key, fetchedAt, sourceUrl }) => normalizeGameDetails(payload, { gameId: key, fetchedAt, sourceUrl }),
    ErrorType: GameDetailsError,
    label: 'game details feed',
    invalidCode: 'INVALID_DETAILS', unavailableCode: 'DETAILS_UNAVAILABLE', timeoutCode: 'DETAILS_TIMEOUT',
    fetchImpl, now, cacheTtlMs,
  });
  return async function getGameDetails({ gameId } = {}) {
    return read(validateGameId(gameId));
  };
}

export const getGameDetails = createGameDetailsService();
