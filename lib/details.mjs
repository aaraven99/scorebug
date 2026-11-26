import { normalizeGame } from './nfl.mjs';

const SUMMARY_URL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary';
const CACHE_TTL_MS = 10_000;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

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
    downDistance: text(position.shortDownDistanceText, 40) || null,
    yardsToEndzone: integer(position.yardsToEndzone, 0, 100),
  };
}

function normalizedPlay(play, teams) {
  const description = text(play?.text, 900);
  if (!play || !description) return null;
  const offense = array(play.teamParticipants).find((entry) => entry?.type === 'offense');
  return {
    id: /^\d{1,24}$/.test(String(play.id ?? '')) ? String(play.id) : null,
    text: description,
    type: text(play.type?.text, 80) || null,
    period: integer(play.period?.number, 1, 99),
    clock: clock(play.clock?.displayValue),
    teamId: knownTeamId(offense?.id ?? play.start?.team?.id, teams),
    wallclock: timestamp(play.wallclock),
    yardsGained: integer(play.statYardage, -100, 100),
    scoringPlay: typeof play.scoringPlay === 'boolean' ? play.scoringPlay : null,
    start: normalizedPosition(play.start, teams),
    end: normalizedPosition(play.end, teams),
  };
}

function playsInOrder(payload, teams) {
  const drives = [...array(payload.drives?.previous), ...(payload.drives?.current ? [payload.drives.current] : [])];
  const unique = new Map();
  for (const [index, play] of drives.flatMap((drive) => array(drive?.plays)).entries()) {
    const normalized = normalizedPlay(play, teams);
    if (!normalized) continue;
    const sequence = integer(play.sequenceNumber);
    const order = sequence ?? integer(play.id) ?? index;
    const key = normalized.id || `${order}:${normalized.text}`;
    unique.set(key, { order, index, play: normalized });
  }
  return [...unique.values()].sort((a, b) => b.order - a.order || b.index - a.index).map((entry) => entry.play);
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
  const statsTeams = array(payload.boxscore?.teams);
  const awayStats = statsTeams.find((entry) => String(entry?.team?.id) === away.id);
  const homeStats = statsTeams.find((entry) => String(entry?.team?.id) === home.id);
  const teamStats = STAT_COLUMNS.map((column) => ({ key: column.key, label: column.label, away: statValue(awayStats, column), home: statValue(homeStats, column) }));
  const leaderColumns = [
    ['passingYards', 'Passing'], ['rushingYards', 'Rushing'], ['receivingYards', 'Receiving'],
  ];
  const leaders = leaderColumns.map(([key, label]) => ({ key, label, away: normalizeLeader(payload, away.id, key), home: normalizeLeader(payload, home.id, key) }));
  const recentPlays = playsInOrder(payload, teams).slice(0, 3);
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
    source: 'ESPN',
    sourceUrl: sourceUrl || `${SUMMARY_URL}?event=${id}`,
    away,
    home,
    teamStats,
    leaders,
    lastPlay: recentPlays[0] || null,
    recentPlays,
    drive,
    situation,
  };
}

async function readSummary(response) {
  const size = Number(response.headers.get('content-length'));
  if ((Number.isFinite(size) && size > MAX_RESPONSE_BYTES) || !/application\/json/i.test(response.headers.get('content-type') || '')) {
    await response.body?.cancel();
    throw new GameDetailsError('The game details feed returned an unexpected response.', { code: 'INVALID_DETAILS' });
  }
  if (!response.body) throw new GameDetailsError('The game details feed returned an empty response.', { code: 'INVALID_DETAILS' });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let source = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new GameDetailsError('The game details feed returned too much data.', { code: 'INVALID_DETAILS' });
      }
      source += decoder.decode(value, { stream: true });
    }
    source += decoder.decode();
  } finally { reader.releaseLock(); }
  try { return JSON.parse(source); }
  catch (cause) { throw new GameDetailsError('The game details feed returned invalid data.', { code: 'INVALID_DETAILS', cause }); }
}

export function createGameDetailsService({ fetchImpl = globalThis.fetch, now = Date.now, cacheTtlMs = CACHE_TTL_MS } = {}) {
  const cache = new Map();
  const pending = new Map();
  return async function getGameDetails({ gameId } = {}) {
    const id = validateGameId(gameId);
    const cached = cache.get(id);
    if (cached && cached.expiresAt > now()) return cached.value;
    cache.delete(id);
    if (pending.has(id)) return pending.get(id);
    const sourceUrl = `${SUMMARY_URL}?event=${id}`;
    const request = (async () => {
      try {
        const response = await fetchImpl(sourceUrl, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          cache: 'no-store',
          redirect: 'error',
        });
        if (!response.ok) {
          await response.body?.cancel();
          const statusCode = response.status === 404 ? 404 : [429, 503].includes(response.status) ? 503 : 502;
          throw new GameDetailsError(statusCode === 404 ? 'No details were found for this NFL game.' : 'Game details are temporarily unavailable.', { statusCode });
        }
        const payload = await readSummary(response);
        const value = normalizeGameDetails(payload, { gameId: id, fetchedAt: new Date(now()).toISOString(), sourceUrl });
        if (cache.size >= 16) cache.delete(cache.keys().next().value);
        cache.set(id, { value, expiresAt: now() + cacheTtlMs });
        return value;
      } catch (cause) {
        if (cause instanceof GameDetailsError) throw cause;
        const timeout = ['TimeoutError', 'AbortError'].includes(cause?.name);
        throw new GameDetailsError(timeout ? 'Game details took too long to respond.' : 'Unable to reach the game details feed.', {
          statusCode: timeout ? 503 : 502,
          code: timeout ? 'DETAILS_TIMEOUT' : 'DETAILS_UNAVAILABLE',
          cause,
        });
      }
    })();
    pending.set(id, request);
    try { return await request; }
    finally { pending.delete(id); }
  };
}

export const getGameDetails = createGameDetailsService();
