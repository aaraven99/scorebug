const SCOREBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const CACHE_TTL_MS = 5_000;
const FETCH_TIMEOUT_MS = 8_000;

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

function downDistance(situation) {
  const supplied = cleanText(situation.shortDownDistanceText, 40);
  // A feed transition after a score can contain down=-1 and distance=0.
  // Only a real down or an explicit conversion/kickoff label may be shown.
  if (/^[1-4](?:st|nd|rd|th)\s*&\s*(?:\d+|goal)$/i.test(supplied)) return supplied;
  if (/^(?:PAT|KICKOFF|2-PT (?:TRY|ATT))$/i.test(supplied)) return supplied;
  const down = numberOrNull(situation.down, { min: 1, max: 4 });
  const distance = numberOrNull(situation.distance, { max: 100 });
  if (down === null || distance === null) return null;
  const suffix = ['st', 'nd', 'rd', 'th'][down - 1];
  const isGoal = /\bgoal\b/i.test(cleanText(situation.downDistanceText));
  return `${down}${suffix} & ${isGoal ? 'Goal' : distance}`;
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

async function readLimitedJson(response) {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new ScoreboardError('The live score feed returned an oversized response.', { code: 'INVALID_UPSTREAM' });
  }
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    await response.body?.cancel();
    throw new ScoreboardError('The live score feed returned an unexpected response.', { code: 'INVALID_UPSTREAM' });
  }
  if (!response.body) throw new ScoreboardError('The live score feed returned an empty response.', { code: 'INVALID_UPSTREAM' });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new ScoreboardError('The live score feed returned an oversized response.', { code: 'INVALID_UPSTREAM' });
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(body);
  } catch (cause) {
    throw new ScoreboardError('The live score feed returned invalid game data.', { code: 'INVALID_UPSTREAM', cause });
  }
}

/** Isolated service factory makes cache, retries, and failures testable offline. */
export function createScoreboardService({ fetchImpl = globalThis.fetch, now = Date.now, cacheTtlMs = CACHE_TTL_MS } = {}) {
  const cache = new Map();
  const pending = new Map();
  return async function getScoreboard({ date } = {}) {
    const validDate = validateDate(date);
    const key = validDate || 'current';
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now()) return cached.value;
    // Expired data is deliberately removed, not silently served as current.
    cache.delete(key);
    if (pending.has(key)) return pending.get(key);
    const sourceUrl = validDate ? `${SCOREBOARD_URL}?dates=${validDate}` : SCOREBOARD_URL;
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
          throw new ScoreboardError('The live score feed is temporarily unavailable. Please try again shortly.', {
            statusCode: response.status === 429 || response.status === 503 ? 503 : 502,
            code: 'UPSTREAM_UNAVAILABLE',
          });
        }
        const payload = await readLimitedJson(response);
        const fetchedAt = new Date(now()).toISOString();
        const value = normalizeScoreboard(payload, { fetchedAt, sourceUrl });
        // Bound a warm function's memory even if visitors request many dates.
        if (cache.size >= 16) cache.delete(cache.keys().next().value);
        cache.set(key, { value, expiresAt: now() + cacheTtlMs });
        return value;
      } catch (cause) {
        if (cause instanceof ScoreboardError) throw cause;
        const timeout = cause?.name === 'TimeoutError' || cause?.name === 'AbortError';
        throw new ScoreboardError(timeout ? 'The live score feed took too long to respond. Please try again shortly.' : 'Unable to reach the live score feed. Please try again shortly.', {
          statusCode: timeout ? 503 : 502,
          code: timeout ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE',
          cause,
        });
      }
    })();
    pending.set(key, request);
    try {
      return await request;
    } finally {
      pending.delete(key);
    }
  };
}

export const getScoreboard = createScoreboardService();
