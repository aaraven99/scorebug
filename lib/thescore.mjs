/**
 * Independent, public theScore NFL scoreboard adapter; no credentials required.
 * Observed provider endpoints (2026-11-27):
 * https://api.thescore.com/nfl/events?game_date.in=<UTC-start>,<UTC-end>
 * https://api.thescore.com/nfl/events?id.in=<comma-separated-event-ids>
 * This is an undocumented provider feed, not a guaranteed public API contract.
 * Only game facts are retained; articles, odds and provider images are omitted.
 */
const EVENTS_URL = 'https://api.thescore.com/nfl/events';
const FIVE_MINUTES = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Canonical ESPN IDs and the existing app's colors, verified against its public
// NFL teams catalog on 2026-11-27. Provider team IDs must never become ESPN IDs.
// https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams?limit=40
const TEAMS = {
  ARI: ['22', 'Arizona Cardinals', '#a40227', '#ffffff'],
  ATL: ['1', 'Atlanta Falcons', '#a71930', '#000000'],
  BAL: ['33', 'Baltimore Ravens', '#29126f', '#000000'],
  BUF: ['2', 'Buffalo Bills', '#00338d', '#d50a0a'],
  CAR: ['29', 'Carolina Panthers', '#0085ca', '#000000'],
  CHI: ['3', 'Chicago Bears', '#0b1c3a', '#e64100'],
  CIN: ['4', 'Cincinnati Bengals', '#fb4f14', '#000000'],
  CLE: ['5', 'Cleveland Browns', '#472a08', '#ff3c00'],
  DAL: ['6', 'Dallas Cowboys', '#002a5c', '#b0b7bc'],
  DEN: ['7', 'Denver Broncos', '#0a2343', '#fc4c02'],
  DET: ['8', 'Detroit Lions', '#0076b6', '#bbbbbb'],
  GB: ['9', 'Green Bay Packers', '#204e32', '#ffb612'],
  HOU: ['34', 'Houston Texans', '#021018', '#eb0028'],
  IND: ['11', 'Indianapolis Colts', '#003b75', '#ffffff'],
  JAX: ['30', 'Jacksonville Jaguars', '#007487', '#d7a22a'],
  KC: ['12', 'Kansas City Chiefs', '#e31837', '#ffb612'],
  LAC: ['24', 'Los Angeles Chargers', '#0080c6', '#ffc20e'],
  LAR: ['14', 'Los Angeles Rams', '#003594', '#ffd100'],
  LV: ['13', 'Las Vegas Raiders', '#000000', '#a5acaf'],
  MIA: ['15', 'Miami Dolphins', '#008e97', '#fc4c02'],
  MIN: ['16', 'Minnesota Vikings', '#4f2683', '#ffc62f'],
  NE: ['17', 'New England Patriots', '#002a5c', '#c60c30'],
  NO: ['18', 'New Orleans Saints', '#d3bc8d', '#000000'],
  NYG: ['19', 'New York Giants', '#003c7f', '#c9243f'],
  NYJ: ['20', 'New York Jets', '#115740', '#ffffff'],
  PHI: ['21', 'Philadelphia Eagles', '#06424d', '#000000'],
  PIT: ['23', 'Pittsburgh Steelers', '#000000', '#ffb612'],
  SEA: ['26', 'Seattle Seahawks', '#002a5c', '#69be28'],
  SF: ['25', 'San Francisco 49ers', '#aa0000', '#b3995d'],
  TB: ['27', 'Tampa Bay Buccaneers', '#bd1c36', '#3e3a35'],
  TEN: ['10', 'Tennessee Titans', '#4495d2', '#001532'],
  WSH: ['28', 'Washington Commanders', '#5a1414', '#ffb612'],
};
const ALIASES = { LA: 'LAR', JAC: 'JAX', WAS: 'WSH' };
const clean = (value, length = 160) => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, length)
  : '';
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const numericId = (value) => /^[1-9]\d{0,15}$/.test(String(value ?? '')) ? String(value) : null;
const integer = (value, min = 0, max = 999) => {
  if (!['number', 'string'].includes(typeof value) || (typeof value === 'string' && !value.trim())) return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};
const timestamp = (value) => {
  const n = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(n) ? new Date(n).toISOString() : null;
};

const easternDate = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
});
const easternOffset = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', timeZoneName: 'shortOffset',
});

function dateKey(at) {
  const parts = Object.fromEntries(easternDate.formatToParts(new Date(at)).map(({ type, value }) => [type, value]));
  return `${parts.year}${parts.month}${parts.day}`;
}

function calendarDay(key) {
  if (typeof key !== 'string' || !/^\d{8}$/.test(key)) throw new TypeError('theScore requires a valid YYYYMMDD date.');
  const iso = `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`;
  const n = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(n) || new Date(n).toISOString().slice(0, 10) !== iso) throw new TypeError('theScore requires a valid calendar date.');
  return n;
}

function easternMidnight(calendarUtc) {
  // 04:00 UTC is before either US daylight-saving transition. Its offset is
  // therefore the offset at this Eastern calendar day's unambiguous midnight.
  const offset = easternOffset.formatToParts(new Date(calendarUtc + 4 * 60 * 60 * 1000)).find(({ type }) => type === 'timeZoneName')?.value;
  const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(offset || '');
  if (!match) throw new TypeError('Unable to determine the NFL game-day timezone.');
  const minutes = (Number(match[2]) * 60 + Number(match[3] || 0)) * (match[1] === '+' ? 1 : -1);
  return calendarUtc - minutes * 60 * 1000;
}

/** Explicit dates are Eastern calendar days; current covers Tuesday–Monday. */
export function theScoreDateRange(key = 'current', at = Date.now()) {
  let first = calendarDay(key === 'current' ? dateKey(at) : key);
  const days = key === 'current' ? 7 : 1;
  if (key === 'current') first -= (new Date(first).getUTCDay() + 5) % 7 * DAY_MS;
  return { start: easternMidnight(first), end: easternMidnight(first + days * DAY_MS) };
}

function queryRange(sourceUrl) {
  try {
    const url = new URL(sourceUrl);
    if (url.origin !== 'https://api.thescore.com' || url.pathname !== '/nfl/events') return null;
    const pair = url.searchParams.get('game_date.in')?.split(',');
    if (pair?.length !== 2) return null;
    const start = Date.parse(pair[0]), end = Date.parse(pair[1]) + 1;
    return Number.isFinite(start) && Number.isFinite(end) && end > start && end - start < 8 * DAY_MS ? { start, end } : null;
  } catch { return null; }
}

function phaseOf(event, frame) {
  const progress = object(frame?.progress) ? frame.progress : {};
  const raw = [event.event_status, event.status, progress.event_status, progress.status].map((v) => clean(v, 50).toLowerCase());
  const combined = raw.join(' ');
  if (/cancel/.test(combined)) return 'canceled';
  if (/postpon/.test(combined)) return 'postponed';
  if (/suspend/.test(combined)) return 'suspended';
  if (/delay/.test(combined)) return 'delayed';
  if (raw.includes('final')) return 'final';
  const label = clean(progress.clock_label || progress.string, 80).toLowerCase();
  if (/^(?:half|half[ -]?time)$/.test(label) || /half[ _-]?time/.test(combined)) return 'halftime';
  if (/^end\s+(?:of\s+)?(?:[1-4](?:st|nd|rd|th)(?:\s+quarter)?|\d*ot)$/i.test(label)) return 'intermission';
  if (raw.includes('in_progress')) return 'live';
  if (raw.includes('pre_game') || raw.includes('scheduled')) return 'scheduled';
  return 'unknown';
}

function team(input, side, frame, standings) {
  if (!object(input) || !numericId(input.id)) return null;
  const raw = clean(input.abbreviation || input.short_name, 5).toUpperCase();
  const abbreviation = ALIASES[raw] || raw;
  const canonical = TEAMS[abbreviation];
  if (!canonical) return null;
  return {
    id: canonical[0], abbreviation, name: canonical[1], logo: null,
    color: canonical[2], alternateColor: canonical[3],
    score: integer(frame?.score?.[side]?.score),
    record: clean(standings?.[side]?.short_record, 30) || null,
    timeouts: integer(frame?.[`${side}_timeouts_left`], 0, 3),
  };
}

function possession(frame, event, away, home) {
  const value = frame?.team_in_possession;
  if (!object(value)) return null;
  const direct = numericId(value.id);
  const path = /^\/(?:nfl|football)\/teams\/([1-9]\d{0,15})$/.exec(clean(value.api_uri, 80))?.[1] || null;
  if (direct && path && direct !== path) return null;
  const id = direct || path;
  if (!id) return null;
  if (id === String(event.away_team.id)) return away.id;
  if (id === String(event.home_team.id)) return home.id;
  return null;
}

function reportedDown(frame) {
  const down = integer(frame?.down, 1, 4);
  const raw = clean(frame?.formatted_distance, 20);
  const distance = /^goal$/i.test(raw) ? 'Goal' : integer(raw, 0, 100);
  if (down === null || distance === null) return null;
  return `${down}${['st', 'nd', 'rd', 'th'][down - 1]} & ${distance}`;
}

function priorEspnId(previous, away, home, startTime) {
  const matches = (Array.isArray(previous?.games) ? previous.games : []).filter((game) => (
    String(game.away?.id) === away.id && String(game.home?.id) === home.id
    && Number.isFinite(Date.parse(game.startTime))
    && Math.abs(Date.parse(game.startTime) - Date.parse(startTime)) <= FIVE_MINUTES
  ));
  if (matches.length !== 1) return null;
  return numericId(matches[0].detailsGameId) || numericId(matches[0].id);
}

const STATUS = {
  scheduled: ['Scheduled', 'STATUS_SCHEDULED'], live: ['In progress', 'STATUS_IN_PROGRESS'],
  halftime: ['Halftime', 'STATUS_HALFTIME'], intermission: ['End of period', 'STATUS_END_PERIOD'],
  final: ['Final', 'STATUS_FINAL'], delayed: ['Delayed', 'STATUS_DELAYED'],
  suspended: ['Suspended', 'STATUS_SUSPENDED'], postponed: ['Postponed', 'STATUS_POSTPONED'],
  canceled: ['Canceled', 'STATUS_CANCELED'], unknown: ['Status unavailable', 'STATUS_UNKNOWN'],
};

function normalizeEvent(event, previous) {
  if (!object(event) || !numericId(event.id)) return null;
  const startTime = timestamp(event.game_date);
  if (!startTime) return null;
  const final = [event.status, event.event_status].some((value) => clean(value).toLowerCase() === 'final');
  // These are independently updated snapshots. A live snapshot was observed
  // ahead of box_score. Never fill its missing fields from the older snapshot.
  const frameName = !final && object(event.live_box_score) ? 'live_box_score' : 'box_score';
  const frame = object(event[frameName]) ? event[frameName] : null;
  const away = team(event.away_team, 'away', frame, event.standings);
  const home = team(event.home_team, 'home', frame, event.standings);
  if (!away || !home || away.id === home.id || String(event.away_team.id) === String(event.home_team.id)) return null;
  const phase = phaseOf(event, frame), progress = object(frame?.progress) ? frame.progress : {};
  const period = integer(progress.segment ?? frame?.segment_number, 1, 99);
  const rawClock = clean(progress.clock, 8);
  const clock = period !== null && /^\d{1,2}:[0-5]\d$/.test(rawClock)
    && ['live', 'halftime', 'intermission', 'final', 'suspended'].includes(phase) ? rawClock : null;
  const espnId = priorEspnId(previous, away, home, startTime);
  const broadcast = (Array.isArray(event.tv_listings_by_country_code?.us) ? event.tv_listings_by_country_code.us : [])
    .map((entry) => clean(entry?.short_name, 40)).filter(Boolean);
  const status = ['canceled', 'postponed', 'suspended', 'delayed', 'unknown'].includes(phase)
    ? STATUS[phase][0] : clean(progress.clock_label || progress.string, 100) || STATUS[phase][0];
  return {
    id: espnId || `thescore-${event.id}`, detailsGameId: espnId,
    provider: 'thescore', providerGameId: String(event.id),
    name: `${away.name} at ${home.name}`, shortName: `${away.abbreviation} @ ${home.abbreviation}`,
    startTime, state: ['final', 'canceled'].includes(phase) ? 'post' : ['live', 'halftime', 'intermission', 'suspended'].includes(phase) ? 'in' : 'pre',
    phase, isLive: phase === 'live', status,
    statusName: STATUS[phase][1], period, clock, away, home,
    possessionTeamId: phase === 'live' ? possession(frame, event, away, home) : null,
    downDistance: phase === 'live' ? reportedDown(frame) : null,
    fieldPosition: phase === 'live' ? clean(frame?.field_position, 40) || null : null,
    playClock: null, lastPlay: null, lastPlayDetails: null,
    broadcast: clean([...new Set(broadcast)].join(' / '), 100) || null,
    venue: clean(event.stadium, 160) || null,
    // Event.updated_at is metadata, not a live clock freshness signal.
    sourceUpdatedAt: timestamp(frame?.updated_at), providerFrame: frameName,
  };
}

/** Normalize and date-filter independently; an unfiltered upstream cannot leak other days. */
export function normalizeTheScoreScoreboard(payload, {
  key = 'current', fetchedAt = new Date().toISOString(), sourceUrl, previous,
} = {}) {
  if (!Array.isArray(payload)) throw new TypeError('theScore returned an unexpected scoreboard.');
  const games = payload.map((event) => normalizeEvent(event, previous)).filter(Boolean);
  if (payload.length && !games.length) throw new TypeError('theScore returned incomplete game data.');
  const range = key === 'current' && queryRange(sourceUrl)
    || theScoreDateRange(key, Date.parse(fetchedAt));
  return {
    games: games.filter((game) => Date.parse(game.startTime) >= range.start && Date.parse(game.startTime) < range.end),
    fetchedAt, source: 'theScore', sourceUrl: sourceUrl || EVENTS_URL,
  };
}

/** Plug into createFeedService; its HTTP Age/Warning guard handles stale CDN responses. */
export function createTheScoreSource({ now = Date.now } = {}) {
  return {
    id: 'thescore', timeoutMs: 7000,
    url(key = 'current') {
      const range = theScoreDateRange(key, now());
      const url = new URL(EVENTS_URL);
      url.searchParams.set('game_date.in', `${new Date(range.start).toISOString()},${new Date(range.end - 1).toISOString()}`);
      return url.href;
    },
    normalize: normalizeTheScoreScoreboard,
  };
}
