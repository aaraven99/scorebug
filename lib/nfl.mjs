import { createFeedService } from './feed-service.mjs';
import { createTheScoreSource } from './thescore.mjs';
import { createFoxSource } from './fox.mjs';

const SCOREBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';
const CACHE_TTL_MS = 1_000;

/** A safe, public-facing feed error; never contains an upstream response body. */
export class ScoreboardError extends Error {
  constructor(message, { statusCode = 502, code = 'UPSTREAM_UNAVAILABLE', cause } = {}) {
    super(message, { cause });
    this.name = 'ScoreboardError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

const cleanText = (value, maxLength = 160) => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength)
  : '';

function numberOrNull(value, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === null || value === undefined || typeof value === 'boolean' || value === '') return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function color(value, fallback) {
  const raw = cleanText(value).replace(/^#/, '');
  return /^[\da-f]{6}$/i.test(raw) ? `#${raw.toLowerCase()}` : fallback;
}

function logoUrl(team) {
  const candidate = team.logo || team.logos?.find((entry) => entry.rel?.includes('default'))?.href || team.logos?.[0]?.href;
  if (typeof candidate !== 'string') return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' || !/(^|\.)espncdn\.com$/i.test(url.hostname) || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

function getPhase(type) {
  const description = `${type.name || ''} ${type.description || ''}`.toUpperCase();
  // These overrides must precede the broad pre/in/post flags: ESPN can report
  // a suspended game as "in", and a canceled game as "post".
  if (/CANCEL/.test(description)) return 'canceled';
  if (/POSTPON/.test(description)) return 'postponed';
  if (/SUSPEND/.test(description)) return 'suspended';
  if (/DELAY/.test(description)) return 'delayed';
  if (/HALFTIME|HALF_TIME/.test(description)) return 'halftime';
  if (/END_PERIOD|END_OF_PERIOD|END_QUARTER|END_OF_QUARTER|END OF.*QUARTER|INTERMISSION/.test(description)) return 'intermission';
  if (type.completed === true || /FINAL|FULL_TIME/.test(description)) return 'final';
  if (type.state === 'pre' || /SCHEDULED|PRE_GAME/.test(description)) return 'scheduled';
  if (type.state === 'in' || /IN_PROGRESS/.test(description)) return 'live';
  return 'unknown';
}

function normalizeTeam(competitor, timeoutCount) {
  const team = competitor.team;
  const records = Array.isArray(competitor.records) ? competitor.records : Array.isArray(competitor.record) ? competitor.record : [];
  const record = records.find((entry) => entry.type === 'total' || entry.name === 'overall');
  const scoreValue = typeof competitor.score === 'object' && competitor.score !== null
    ? competitor.score.value ?? competitor.score.displayValue
    : competitor.score;
  return {
    id: String(team.id ?? competitor.id),
    abbreviation: cleanText(team.abbreviation, 5) || 'NFL',
    name: cleanText(team.displayName || `${team.location || ''} ${team.name || ''}`) || 'NFL team',
    logo: logoUrl(team),
    color: color(team.color, '#39414c'),
    alternateColor: color(team.alternateColor, '#ffffff'),
    score: numberOrNull(scoreValue, { max: 999 }),
    record: cleanText(record?.summary || record?.displayValue, 30) || null,
    timeouts: numberOrNull(timeoutCount, { max: 3 }),
  };
}

export function downDistance(situation = {}) {
  const supplied = cleanText(situation.shortDownDistanceText, 80);
  const long = cleanText(situation.downDistanceText, 100);
  // A feed transition after a score can contain down=-1 and distance=0.
  // Only a real down or an explicit conversion/kickoff label may be shown.
  if (/^(?:PAT|KICKOFF|2-PT (?:TRY|ATT))$/i.test(supplied)) return supplied;
  if (situation.down !== undefined && situation.down !== null && numberOrNull(situation.down, { min: -1, max: 0 }) !== null) return null;
  for (const value of [supplied, long]) {
    const match = /^([1-4])(st|nd|rd|th)\s*(?:&|and)\s*(\d{1,3}|goal)(?:\s+at\s+(?:[A-Z]{2,5}\s*)?\d{1,2})?$/i.exec(value);
    if (!match || match[2].toLowerCase() !== ['st', 'nd', 'rd', 'th'][Number(match[1]) - 1]) continue;
    const distance = /^goal$/i.test(match[3]) ? 'Goal' : numberOrNull(match[3], { max: 100 });
    if (distance !== null) return `${match[1]}${match[2].toLowerCase()} & ${distance}`;
  }
  const down = numberOrNull(situation.down, { min: 1, max: 4 });
  const distance = numberOrNull(situation.distance, { max: 100 });
  if (down === null || distance === null) return null;
  const suffix = ['st', 'nd', 'rd', 'th'][down - 1];
  const isGoal = /\bgoal\b/i.test(cleanText(situation.downDistanceText));
  return `${down}${suffix} & ${isGoal ? 'Goal' : distance}`;
}

function athleteId(athlete) {
  if (/^\d{1,16}$/.test(String(athlete?.id ?? ''))) return String(athlete.id);
  // Core play participants can identify an athlete by a public ESPN reference.
  // Read its ID only; never request URLs supplied by upstream data.
  try {
    const ref = new URL(athlete?.$ref);
    if (!['http:', 'https:'].includes(ref.protocol) || ref.hostname !== 'sports.core.api.espn.com' || ref.username || ref.password) return null;
    return /\/athletes\/(\d{1,16})\/?$/.exec(ref.pathname)?.[1] || null;
  } catch { return null; }
}

function headshotUrl(value) {
  const candidate = typeof value === 'string' ? value : value?.href;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' || !/(^|\.)espncdn\.com$/i.test(url.hostname) || url.username || url.password || url.port) return null;
    return /^\/i\/headshots\/nfl\/players\//.test(url.pathname) ? url.href : null;
  } catch { return null; }
}

/** Only names, teams and photographs actually present in ESPN data are exposed. */
export function normalizePlayer(athlete, teams, { teamId = null } = {}) {
  if (!athlete || typeof athlete !== 'object') return null;
  const name = cleanText(athlete.displayName || athlete.fullName || athlete.shortName, 90);
  if (!name) return null;
  const knownTeam = teams.find((team) => team.id === String(athlete.team?.id ?? teamId ?? ''))
    || teams.find((team) => team.abbreviation && team.abbreviation === athlete.team?.abbreviation);
  const position = cleanText(typeof athlete.position === 'string' ? athlete.position : athlete.position?.abbreviation, 5).toUpperCase();
  return {
    id: athleteId(athlete), name, headshot: headshotUrl(athlete.headshot), teamId: knownTeam?.id || null,
    position: /^[A-Z]{1,5}$/.test(position) ? position : null,
  };
}

function playPlayers(play, teams, { players = [], scoringRecord, scoringTeamId, offenseTeamId, defenseTeamId } = {}) {
  const roster = Array.isArray(players) ? players : [];
  const resolve = (athlete) => {
    const id = athleteId(athlete), base = id ? roster.find((player) => player.id === id) : null;
    const current = normalizePlayer(athlete, teams, { teamId: base?.teamId });
    if (!current) return base || null;
    return { ...current, id: current.id || base?.id || null, headshot: current.headshot || base?.headshot || null, position: current.position || base?.position || null };
  };
  const participants = (Array.isArray(play.participants) ? play.participants : []).map((entry) => ({ role: cleanText(entry?.type, 40).toLowerCase(), player: resolve(entry?.athlete) })).filter((entry) => entry.player);
  const involved = (Array.isArray(play.athletesInvolved) ? play.athletesInvolved : []).map(resolve).filter(Boolean);
  const candidates = new Map();
  for (const player of [...roster, ...involved, ...participants.map((entry) => entry.player)]) {
    const key = player.id || `${player.teamId}:${player.name}`;
    candidates.set(key, { ...candidates.get(key), ...player });
  }
  const unique = (list, teamId) => {
    const matching = new Map(list.filter((player) => player && (!teamId || !player.teamId || player.teamId === teamId)).map((player) => [player.id || player.name, player]));
    if (matching.size !== 1) return null;
    const value = matching.values().next().value;
    return { id: value.id, name: value.name, headshot: value.headshot, teamId: value.teamId || teamId || null, position: value.position || null };
  };
  const role = (names, teamId) => unique(participants.filter((entry) => names.includes(entry.role)).map((entry) => entry.player), teamId);
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const aliases = (player) => {
    const words = player.name.split(' ');
    // Resolve abbreviated play names only against this game's supplied roster;
    // two players with the same initial/surname stay ambiguous.
    const short = words.length > 1 ? `${escape(words[0][0])}\\.\\s*${escape(words.slice(1).join(' '))}` : null;
    return [escape(player.name), short].filter(Boolean).join('|');
  };
  const named = (source, before, after, teamId) => {
    if (!source) return null;
    return unique([...candidates.values()].filter((player) => new RegExp(`${before}(?:${aliases(player)})${after}`, 'i').test(source)), teamId);
  };
  const type = cleanText(play.type?.text, 80), typeId = String(play.type?.id ?? '');
  const description = cleanText(play.text, 900), caption = cleanText(scoringRecord?.text, 400);
  const endTeam = teams.find((team) => team.id === String(play.end?.team?.id ?? ''))?.id || null;
  const beneficiary = scoringTeamId || (/Interception|Fumble Recovery \(Opponent\)/i.test(type) ? endTeam || defenseTeamId : offenseTeamId);
  const touchdown = /Touchdown/i.test(type) || (play.scoringType?.name || scoringRecord?.scoringType?.name) === 'touchdown';
  const pass = ['24', '67'].includes(typeId) || /^(?:Pass Reception|Passing Touchdown)$/i.test(type);
  const rush = ['5', '68'].includes(typeId) || /^(?:Rush|Rushing Touchdown)$/i.test(type);
  const interception = typeId === '26' || /Interception/i.test(type);
  const recovery = typeId === '29' || /Fumble Recovery \(Opponent\)/i.test(type);
  const kick = ['59', '61'].includes(typeId) || /^(?:Field Goal Good|Extra Point Good)$/i.test(type);
  const twoPoint = /Two[ -]Point/i.test(type) && !touchdown;
  let player = touchdown || play.scoringPlay === true ? role(['scorer'], beneficiary) : null;
  // ESPN's scoring caption explicitly starts with the named scorer, whereas
  // a passing play's full prose starts with the quarterback. Do not use the QB.
  if (!player && touchdown) player = named(caption, '^', '\\s+\\d+\\s+Yd\\b', beneficiary);
  if (!player && interception) player = role(['interceptor', 'returner'], beneficiary) || named(description, '\\bINTERCEPTED by\\s+', '(?=[\\s(.,])', beneficiary);
  if (!player && recovery) player = role(['recoverer'], beneficiary) || named(description, '\\bRECOVERED by\\s+(?:[A-Z]{2,5}-)?', '(?=[\\s(.,])', beneficiary);
  if (!player && kick) player = role(['kicker', 'patscorer'], beneficiary)
    || named(description, '(?:^|\\s)', '\\s+(?:\\d+\\s+yard field goal|extra point)\\b', beneficiary)
    || named(caption, '^', '\\s+\\d+\\s+Yd\\s+Field Goal\\b', beneficiary);
  if (!player && twoPoint) player = role(['patscorer'], beneficiary);
  // Laterals and fumble touchdowns require an explicit scorer; the original
  // receiver or runner may no longer be the player who reached the end zone.
  if (!player && !/\b(?:LATERAL|FUMBLE)/i.test(description)) {
    if (pass) player = role(['receiver'], beneficiary) || named(description, '\\bpass\\b[^.]*?\\bto\\s+', '(?=[\\s,])', beneficiary);
    if (rush) player = role(['rusher'], beneficiary) || named(description, '(?:^|[.)]\\s*|\\s)', '\\s+(?:left|right|up the middle|scrambles|rush(?:es)?)\\b', beneficiary);
    if (twoPoint && /Pass/i.test(type)) player = role(['receiver'], beneficiary) || named(description, '\\bpass\\b[^.]*?\\bto\\s+', '(?=[\\s,])', beneficiary);
    if (twoPoint && /Rush/i.test(type)) player = role(['rusher'], beneficiary);
  }
  const attempt = play.pointAfterAttempt;
  let conversionPlayer = attempt ? role(['patscorer'], scoringTeamId || offenseTeamId) : null;
  if (!conversionPlayer && attempt?.value === 1) conversionPlayer = role(['kicker'], scoringTeamId || offenseTeamId)
    || named(description, '(?:^|\\s)', '\\s+extra point\\b', scoringTeamId || offenseTeamId)
    || named(caption, '\\(', '\\s+Kick\\)', scoringTeamId || offenseTeamId);
  if (!conversionPlayer && attempt?.value === 2) {
    const conversion = /TWO[ -]POINT CONVERSION(?: ATTEMPT)?[.:]?\s*([\s\S]*)/i.exec(description)?.[1] || '';
    conversionPlayer = named(conversion, '\\bpass\\b[^.]*?\\bto\\s+', '(?=[\\s,])', scoringTeamId || offenseTeamId)
      || named(conversion, '^', '\\s+(?:rush(?:es)?|left|right|up the middle|scrambles)\\b', scoringTeamId || offenseTeamId);
  }
  return { player, conversionPlayer };
}

/** Preserve ESPN's structured play facts; never infer an event from its prose. */
export function normalizePlay(play, teams, { scoringTeamId, scoringType, scoringRecord, players } = {}) {
  const description = cleanText(play?.text, 900);
  if (!play || !description) return null;
  const teamId = (value) => teams.some((team) => team.id === String(value ?? '')) ? String(value) : null;
  const id = (value) => /^\d{1,24}$/.test(String(value ?? '')) ? String(value) : null;
  const timestamp = (value) => {
    const time = typeof value === 'string' ? Date.parse(value) : NaN;
    return Number.isFinite(time) ? new Date(time).toISOString() : null;
  };
  const clock = cleanText(play.clock?.displayValue, 8);
  const participants = Array.isArray(play.teamParticipants) ? play.teamParticipants : [];
  const offenseTeamId = teamId(participants.find((entry) => entry?.type === 'offense')?.id ?? play.start?.team?.id);
  const defenseTeamId = teamId(participants.find((entry) => entry?.type === 'defense')?.id);
  const position = (input) => input && typeof input === 'object' ? {
    teamId: teamId(input.team?.id ?? input.possession),
    down: numberOrNull(input.down, { min: 1, max: 4 }),
    distance: numberOrNull(input.distance, { max: 100 }),
    fieldPosition: cleanText(input.possessionText, 30) || null,
    downDistance: cleanText(input.shortDownDistanceText, 40) || null,
    yardsToEndzone: numberOrNull(input.yardsToEndzone, { max: 100 }),
  } : null;
  const normalizedScoringType = cleanText(play.scoringType?.name || scoringType, 60) || null;
  const scoreValue = numberOrNull(play.scoreValue, { max: 9 });
  const explicitScoringTeam = teamId(scoringTeamId) || ((play.scoringPlay === true || scoreValue > 0 || normalizedScoringType) ? teamId(play.team?.id) : null);
  const attempt = play.pointAfterAttempt;
  const attributed = playPlayers(play, teams, { players, scoringRecord, scoringTeamId: explicitScoringTeam, offenseTeamId, defenseTeamId });
  return {
    id: id(play.id),
    sequenceNumber: numberOrNull(play.sequenceNumber),
    text: description,
    type: cleanText(play.type?.text, 80) || null,
    typeId: id(play.type?.id),
    period: numberOrNull(play.period?.number, { min: 1, max: 99 }),
    clock: /^\d{1,2}:[0-5]\d$/.test(clock) ? clock : null,
    teamId: offenseTeamId || teamId(play.team?.id),
    offenseTeamId,
    defenseTeamId,
    scoringTeamId: explicitScoringTeam,
    player: attributed.player,
    conversionPlayer: attributed.conversionPlayer,
    wallclock: timestamp(play.wallclock),
    modifiedAt: timestamp(play.modified),
    yardsGained: numberOrNull(play.statYardage, { min: -100, max: 109 }),
    scoringPlay: typeof play.scoringPlay === 'boolean' ? play.scoringPlay : null,
    scoringType: normalizedScoringType,
    scoreValue,
    scores: { away: numberOrNull(play.awayScore, { max: 999 }), home: numberOrNull(play.homeScore, { max: 999 }) },
    pointAfterAttempt: attempt && typeof attempt === 'object' ? {
      typeId: id(attempt.id),
      type: cleanText(attempt.text, 80) || null,
      points: numberOrNull(attempt.value, { max: 2 }),
    } : null,
    isTurnover: typeof play.isTurnover === 'boolean' ? play.isTurnover : null,
    isNoPlay: play.isNoPlay === true || /\bNO PLAY\b/i.test(description),
    start: position(play.start),
    end: position(play.end),
  };
}

/** Normalize one ESPN scoreboard event. Invalid event records are ignored. */
export function normalizeGame(event) {
  if (!event || typeof event !== 'object' || !/^\d{1,16}$/.test(String(event.id ?? ''))) return null;
  const competition = event.competitions?.[0];
  if (!competition || !Array.isArray(competition.competitors)) return null;
  const awayInput = competition.competitors.find((entry) => entry?.homeAway === 'away');
  const homeInput = competition.competitors.find((entry) => entry?.homeAway === 'home');
  if (!awayInput?.team || !homeInput?.team) return null;
  const awayId = awayInput.team.id ?? awayInput.id;
  const homeId = homeInput.team.id ?? homeInput.id;
  if (!/^\d{1,16}$/.test(String(awayId ?? '')) || !/^\d{1,16}$/.test(String(homeId ?? '')) || String(awayId) === String(homeId)) return null;

  const rawStatus = competition.status || event.status || {};
  const type = rawStatus.type || {};
  const phase = getPhase(type);
  const state = ['pre', 'in', 'post'].includes(type.state) ? type.state : phase === 'final' ? 'post' : phase === 'live' ? 'in' : 'pre';
  const situation = competition.situation && typeof competition.situation === 'object' ? competition.situation : {};
  const away = normalizeTeam(awayInput, situation.awayTimeouts);
  const home = normalizeTeam(homeInput, situation.homeTimeouts);
  const period = numberOrNull(rawStatus.period, { max: 99 });
  const rawClock = cleanText(rawStatus.displayClock, 8);
  const hasClock = /^(?:\d{1,2}):[0-5]\d$/.test(rawClock) && period !== null && period > 0;
  const rawPossession = String(situation.possession ?? '');
  const possessionTeamId = phase === 'live' && [away.id, home.id].includes(rawPossession) ? rawPossession : null;
  const startTime = Date.parse(event.date || competition.date || '');
  const broadcast = cleanText(competition.broadcast, 100) || cleanText(
    (Array.isArray(competition.broadcasts) ? competition.broadcasts : []).flatMap((entry) => Array.isArray(entry.names) ? entry.names : []).join(' / '),
    100,
  );
  const defaultStatus = { scheduled: 'Scheduled', live: 'In progress', halftime: 'Halftime', intermission: 'End of period', final: 'Final', delayed: 'Delayed', postponed: 'Postponed', suspended: 'Suspended', canceled: 'Canceled', unknown: 'Status unavailable' };
  return {
    id: String(event.id),
    name: cleanText(event.name) || `${away.name} at ${home.name}`,
    shortName: cleanText(event.shortName, 40) || `${away.abbreviation} @ ${home.abbreviation}`,
    startTime: Number.isFinite(startTime) ? new Date(startTime).toISOString() : null,
    state,
    phase,
    isLive: phase === 'live',
    status: cleanText(type.shortDetail || type.description || type.detail) || defaultStatus[phase],
    statusName: cleanText(type.name, 80) || 'STATUS_UNKNOWN',
    period,
    clock: hasClock && !['scheduled', 'postponed', 'canceled', 'delayed', 'unknown'].includes(phase) ? rawClock : null,
    away,
    home,
    possessionTeamId,
    downDistance: phase === 'live' ? downDistance(situation) : null,
    fieldPosition: phase === 'live' ? cleanText(situation.possessionText, 40) || null : null,
    // ESPN's public scoreboard does not provide a reliable play clock. It must
    // never be inferred from the game clock or a fabricated local countdown.
    playClock: null,
    lastPlay: cleanText(situation.lastPlay?.text, 700) || null,
    lastPlayDetails: normalizePlay(situation.lastPlay, [away, home]),
    broadcast: broadcast || null,
    venue: cleanText(competition.venue?.fullName) || null,
  };
}

export function normalizeScoreboard(payload, { fetchedAt = new Date().toISOString(), sourceUrl = SCOREBOARD_URL } = {}) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.events)) {
    throw new ScoreboardError('The live score feed returned an unexpected response.', { code: 'INVALID_UPSTREAM' });
  }
  const games = payload.events.map(normalizeGame).filter(Boolean);
  if (payload.events.length > 0 && games.length === 0) {
    throw new ScoreboardError('The live score feed returned incomplete game data.', { code: 'INVALID_UPSTREAM' });
  }
  return { games, fetchedAt, source: 'ESPN', sourceUrl };
}

export function validateDate(date) {
  if (date === undefined || date === null) return undefined;
  if (typeof date !== 'string' || !/^\d{8}$/.test(date)) {
    throw new ScoreboardError('Date must be a real calendar date in YYYYMMDD format.', { statusCode: 400, code: 'INVALID_DATE' });
  }
  const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) {
    throw new ScoreboardError('Date must be a real calendar date in YYYYMMDD format.', { statusCode: 400, code: 'INVALID_DATE' });
  }
  return date;
}

/** Fixed, independently validated routes; all retain their provider identity. */
export function createScoreboardService({ fetchImpl = globalThis.fetch, now = Date.now, cacheTtlMs = CACHE_TTL_MS } = {}) {
  const dated = (base, key) => key === 'current' ? base : `${base}?dates=${key}`;
  const read = createFeedService({
    sources: [
      { id: 'espn-site', url: (key) => dated(SCOREBOARD_URL, key) },
      { id: 'espn-web', url: (key) => dated('https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard', key) },
      createTheScoreSource({ now }),
      createFoxSource({ now }),
      // This route ignores arbitrary date queries, so it is current-week only.
      { id: 'espn-cdn', enabled: (key) => key === 'current', url: () => 'https://cdn.espn.com/core/nfl/scoreboard?xhr=1', select: (payload) => payload?.content?.sbData },
    ],
    normalize: (payload, { fetchedAt, sourceUrl }) => normalizeScoreboard(payload, { fetchedAt, sourceUrl }),
    ErrorType: ScoreboardError, label: 'live score feed', invalidCode: 'INVALID_UPSTREAM',
    unavailableCode: 'UPSTREAM_UNAVAILABLE', timeoutCode: 'UPSTREAM_TIMEOUT',
    fetchImpl, now, cacheTtlMs,
    acceptValue(value, previous, checkedAt) {
      // A partial/empty response must not silently drop a game that was live
      // seconds ago. Try the next route before showing an unavailable matchup.
      if (!previous || checkedAt - Date.parse(previous.fetchedAt) > 15 * 60 * 1000) return true;
      const sameGame = (a, b) => a.id === b.id || (a.away.id === b.away.id && a.home.id === b.home.id
        && Number.isFinite(Date.parse(a.startTime)) && Math.abs(Date.parse(a.startTime) - Date.parse(b.startTime)) <= 5 * 60 * 1000);
      return previous.games.filter((game) => game.state === 'in').every((game) => value.games.some((next) => sameGame(game, next)));
    },
  });
  return ({ date } = {}) => {
    // Invalid user input never reaches any upstream source.
    try { return read(validateDate(date) || 'current'); }
    catch (error) { return Promise.reject(error); }
  };
}

export const getScoreboard = createScoreboardService();
