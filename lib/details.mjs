import { downDistance, normalizeGame, normalizePlay, normalizePlayer } from './nfl.mjs';
import { createFeedService } from './feed-service.mjs';
import { createCoreDetailsSource } from './espn-core.mjs';

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

const COUNT_STATS = new Set([
  'firstDowns', 'firstDownsPassing', 'firstDownsRushing', 'firstDownsPenalty', 'totalOffensivePlays',
  'totalYards', 'totalDrives', 'netPassingYards', 'interceptions', 'rushingYards', 'rushingAttempts',
  'turnovers', 'fumblesLost', 'defensiveTouchdowns', 'sacks', 'penalties', 'penaltyYards',
]);
const DECIMAL_STATS = new Set(['yardsPerPlay', 'yardsPerPass', 'yardsPerRushAttempt']);
const categoryLabels = {
  passing: 'Passing', rushing: 'Rushing', receiving: 'Receiving', fumbles: 'Fumbles',
  defensive: 'Defense', defense: 'Defense', interceptions: 'Interceptions',
  kickReturns: 'Kick returns', puntReturns: 'Punt returns', kicking: 'Kicking', punting: 'Punting',
};
function number(value, min = -10000, max = 10000) {
  if (value === null || value === undefined || typeof value === 'boolean' || (typeof value === 'string' && !value.trim())) return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const candidate = Number(value);
  return Number.isFinite(candidate) && candidate >= min && candidate <= max ? candidate : null;
}
function displayStat(value) {
  const display = typeof value === 'number' && Number.isFinite(value) ? String(value) : text(value, 50);
  return display && !/^(?:[-–—]+|n\/?a)$/i.test(display) ? display : null;
}
function readableKey(value) {
  return text(value, 90).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (letter) => letter.toUpperCase());
}

/** Keep every supplied stat, while never interpreting a raw ratio as a count. */
function allTeamStats(away, home) {
  const entries = new Map();
  for (const [side, team] of [['away', away], ['home', home]]) {
    for (const stat of array(team?.statistics)) {
      const key = text(stat?.name, 80);
      if (!key || (!entries.has(key) && entries.size >= 80)) continue;
      const row = entries.get(key) || { key, label: text(stat.label || stat.displayName, 90) || readableKey(key), away: null, home: null };
      const value = displayStat(stat.displayValue);
      const numeric = COUNT_STATS.has(key) ? integer(stat.value, -1000, 10000) : DECIMAL_STATS.has(key) ? number(stat.value) : null;
      row[side] = value ?? row[side] ?? (numeric === null ? null : String(numeric));
      entries.set(key, row);
    }
  }
  return [...entries.values()];
}

function quarterScores(competition, teams) {
  const rows = new Map();
  for (const [side, team] of [['away', teams[0]], ['home', teams[1]]]) {
    const competitor = array(competition.competitors).find((entry) => String(entry?.team?.id ?? entry?.id) === team.id);
    for (const [index, score] of array(competitor?.linescores).slice(0, 20).entries()) {
      const period = integer(score?.period, 1, 20) ?? index + 1;
      const value = integer(score?.displayValue ?? score?.value, 0, 999);
      const row = rows.get(period) || { period, label: period <= 4 ? `Q${period}` : period === 5 ? 'OT' : `${period - 4}OT`, away: null, home: null };
      row[side] = value;
      rows.set(period, row);
    }
  }
  return [...rows.values()].sort((a, b) => a.period - b.period);
}

function playerStatGroups(payload, teams) {
  const groups = new Map();
  for (const entry of array(payload.boxscore?.players)) {
    const id = knownTeamId(entry?.team?.id, teams);
    const side = id === teams[0].id ? 'away' : id === teams[1].id ? 'home' : null;
    if (!side) continue;
    for (const source of array(entry.statistics)) {
      const key = text(source?.name, 50);
      if (!key || (!groups.has(key) && groups.size >= 24)) continue;
      const group = groups.get(key) || { key, label: categoryLabels[key] || readableKey(key), sources: {}, columns: new Map() };
      const keys = array(source.keys), labels = array(source.labels), descriptions = array(source.descriptions);
      const columns = [];
      for (let index = 0; index < Math.min(32, Math.max(keys.length, labels.length)); index++) {
        const columnKey = text(keys[index], 90) || text(labels[index], 40);
        if (!columnKey) continue;
        const column = { key: columnKey, label: text(labels[index], 40) || readableKey(columnKey), description: text(descriptions[index], 100) || null };
        if (!group.columns.has(columnKey)) group.columns.set(columnKey, column);
        columns.push({ key: columnKey, index });
      }
      group.sources[side] = { source, columns };
      groups.set(key, group);
    }
  }
  return [...groups.values()].map((group) => {
    const columns = [...group.columns.values()].slice(0, 32);
    const side = (name, team) => {
      const source = group.sources[name];
      if (!source) return { athletes: [], totals: columns.map(() => null) };
      const values = (raw) => {
        const indexed = new Map(source.columns.map((column) => [column.key, array(raw)[column.index]]));
        return columns.map((column) => displayStat(indexed.get(column.key)));
      };
      const athletes = array(source.source.athletes).slice(0, 128).map((row) => {
        const player = normalizePlayer(row?.athlete, teams, { teamId: team.id });
        return player && player.teamId === team.id ? { player, values: values(row.stats), starter: typeof row.starter === 'boolean' ? row.starter : null } : null;
      }).filter(Boolean);
      return { athletes, totals: values(source.source.totals) };
    };
    return { key: group.key, label: group.label, columns, away: side('away', teams[0]), home: side('home', teams[1]) };
  });
}

function drivePosition(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    period: integer(raw.period?.number ?? raw.period, 1, 20),
    clock: clock(raw.clock?.displayValue),
    fieldPosition: text(raw.text || raw.possessionText, 40) || null,
    // ESPN's drive yardLine uses its own field orientation. Preserve it as
    // historical source data; do not reinterpret it as yards to the end zone.
    yardLine: integer(raw.yardLine, 0, 100),
  };
}
function allDrives(payload, teams, game) {
  const current = payload.drives?.current;
  const raw = [...array(payload.drives?.previous), ...(current ? [current] : [])];
  const unique = new Map();
  for (const [index, drive] of raw.entries()) {
    if (!drive || typeof drive !== 'object') continue;
    const id = /^\d{1,24}$/.test(String(drive.id ?? '')) ? String(drive.id) : null;
    const key = id || `drive-${index}`;
    unique.set(key, {
      id, teamId: knownTeamId(drive.team?.id, teams),
      description: text(drive.description, 160) || null,
      plays: integer(drive.offensivePlays, 0, 100), yards: integer(drive.yards, -100, 100),
      timeElapsed: clock(drive.timeElapsed?.displayValue), result: text(drive.displayResult || drive.result, 80) || null,
      isActive: game.phase === 'live' && !drive.result && Boolean(current) && (drive === current || Boolean(id && id === String(current.id))),
      start: drivePosition(drive.start), end: drivePosition(drive.end),
      playIds: array(drive.plays).map((play) => String(play?.id ?? '')).filter((id) => /^\d{1,24}$/.test(id)).slice(0, 250),
    });
  }
  return [...unique.values()].reverse().slice(0, 80);
}

function gameInformation(payload, competition, game) {
  const info = payload.gameInfo || {};
  const rawVenue = info.venue || competition.venue;
  const rawWeather = info.weather || competition.weather;
  const rawSeason = payload.header?.season;
  const broadcasts = new Set();
  if (game.broadcast) broadcasts.add(game.broadcast);
  for (const entry of [...array(competition.broadcasts), ...array(payload.broadcasts)]) {
    for (const name of [...array(entry?.names), entry?.media?.shortName, entry?.media?.name, entry?.station]) {
      const value = text(name, 90);
      if (value) broadcasts.add(value);
    }
  }
  const temperatureUnit = text(rawWeather?.temperatureUnit || rawWeather?.unit, 12);
  const weather = rawWeather && typeof rawWeather === 'object' ? {
    summary: text(rawWeather.displayValue || rawWeather.description || rawWeather.condition, 120) || null,
    temperature: number(rawWeather.temperature, -120, 150),
    unit: /^(?:°?[FC]|fahrenheit|celsius)$/i.test(temperatureUnit) ? temperatureUnit : null,
  } : null;
  const venue = rawVenue && typeof rawVenue === 'object' ? {
    name: text(rawVenue.fullName || rawVenue.name, 140) || null,
    city: text(rawVenue.address?.city, 80) || null,
    state: text(rawVenue.address?.state, 80) || null,
    country: text(rawVenue.address?.country, 80) || null,
    indoor: typeof rawVenue.indoor === 'boolean' ? rawVenue.indoor : null,
  } : null;
  return {
    startTime: game.startTime, status: game.status, venue, weather,
    attendance: integer(info.attendance, 0, 300000), broadcasts: [...broadcasts].slice(0, 16),
    week: integer(payload.header?.week?.number ?? payload.header?.week, 1, 30),
    season: rawSeason && typeof rawSeason === 'object' ? {
      year: integer(rawSeason.year, 1900, 2200), type: integer(rawSeason.type, 1, 4), label: text(rawSeason.name || rawSeason.displayName, 80) || null,
    } : null,
    officials: array(info.officials).slice(0, 20).map((official) => ({
      name: text(official?.displayName || official?.fullName, 90) || null,
      position: text(official?.position?.displayName || official?.position?.name, 60) || null,
    })).filter((official) => official.name),
  };
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
    // A sparse drive record must not erase an explicit scoring-list fact. An
    // explicit false/no-play correction still takes precedence.
    const evidence = scoringRecord && play.scoringPlay == null ? { ...play, scoringPlay: true } : play;
    const normalized = normalizePlay(evidence, teams, { scoringTeamId: scoringRecord?.team?.id, scoringType: scoringRecord?.scoringType?.name, scoringRecord, players });
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
  const orderedPlays = playsInOrder(payload, teams, players);
  const eventPlays = orderedPlays.slice(0, 24);
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
    dataScope: 'full',
    statsStale: false,
    statsFetchedAt: fetchedAt,
    state: game.state,
    phase: game.phase,
    period: game.period,
    clock: game.clock,
    source: 'ESPN',
    sourceUrl: sourceUrl || `${SUMMARY_URL}?event=${id}`,
    away,
    home,
    teamStats,
    allTeamStats: allTeamStats(awayStats, homeStats),
    quarterScores: quarterScores(competition, teams),
    playerStats: playerStatGroups(payload, teams),
    gameInfo: gameInformation(payload, competition, game),
    leaders,
    players,
    lastPlay: recentPlays[0] || null,
    recentPlays,
    eventPlays,
    playByPlay: orderedPlays.slice(0, 250),
    scoringPlays: orderedPlays.filter((play) => play.scoringPlay && !play.isNoPlay).slice(0, 250),
    drives: allDrives(payload, teams, game),
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
      createCoreDetailsSource({ ErrorType: GameDetailsError }),
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
