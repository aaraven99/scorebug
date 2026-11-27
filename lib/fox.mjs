/**
 * Independent FOX Sports NFL scoreboard, verified against its public website
 * feed on 2026-11-27. The data-tier key is public web-bundle configuration:
 * https://py.sportsdataverse.org/docs/fox/reference/fox_api/other
 * This is an undocumented provider service, not a guaranteed public API.
 */
import { canonicalNFLTeam, matchEspnGameId, theScoreDateRange } from './thescore.mjs';

const ORIGIN = 'https://api.foxsports.com';
const BASE_PATH = '/bifrost/v1/nfl/scoreboard/';
const PUBLIC_WEB_KEY = 'jE7yBJVRNAwdDesMgTzTXUUSx1It41Fq';
const METADATA_TTL_MS = 60_000;
const SEGMENT_ID = /^\d{4}-[1-9]\d?-[1-9]\d?$/;
const TEAM_URI = /^football\/nfl\/teams\/[1-9]\d{0,14}$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clean = (value, length = 160) => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, length) : '';
const integer = (value, min = 0, max = 999) => {
  if (!['number', 'string'].includes(typeof value) || (typeof value === 'string' && !value.trim())) return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : null;
};
const timestamp = value => {
  const number = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(number) ? new Date(number).toISOString() : null;
};

function endpoint(path) {
  const url = new URL(`${BASE_PATH}${path}`, ORIGIN);
  url.searchParams.set('apikey', PUBLIC_WEB_KEY);
  url.searchParams.set('api-version', '1.1');
  return url.href;
}

function wrongCalendar() {
  return Object.assign(new TypeError('FOX returned the wrong current NFL schedule.'), { code: 'FOX_WRONG_CALENDAR' });
}

function currentSegment(metadata) {
  if (!object(metadata) || metadata.title !== 'NFL' || !SEGMENT_ID.test(metadata.currentSelectionId || '') || !Array.isArray(metadata.selectionGroupList)) {
    throw new TypeError('FOX returned an unexpected NFL calendar.');
  }
  const matches = metadata.selectionGroupList.flatMap(group => Array.isArray(group?.selectionList) ? group.selectionList : [])
    .filter(selection => selection?.id === metadata.currentSelectionId);
  if (matches.length !== 1) throw new TypeError('FOX did not identify one current NFL schedule.');
  // Construct the URL ourselves. Never follow a URI supplied by the feed.
  return matches[0].id;
}

const STATUS = {
  scheduled: ['Scheduled', 'STATUS_SCHEDULED'], live: ['In progress', 'STATUS_IN_PROGRESS'],
  halftime: ['Halftime', 'STATUS_HALFTIME'], intermission: ['End of period', 'STATUS_END_PERIOD'],
  final: ['Final', 'STATUS_FINAL'], delayed: ['Delayed', 'STATUS_DELAYED'],
  suspended: ['Suspended', 'STATUS_SUSPENDED'], postponed: ['Postponed', 'STATUS_POSTPONED'],
  canceled: ['Canceled', 'STATUS_CANCELED'], unknown: ['Status unavailable', 'STATUS_UNKNOWN'],
};

function statusOf(event) {
  const line = clean(event.statusLine, 80).toUpperCase();
  const code = integer(event.eventStatus, 0, 99);
  let phase = 'unknown';
  if (/\bCANCEL(?:ED|LED)?\b/.test(line)) phase = 'canceled';
  else if (/\bPOSTPONED\b/.test(line)) phase = 'postponed';
  else if (/\bSUSPENDED\b/.test(line)) phase = 'suspended';
  else if (/\bDELAYED\b/.test(line)) phase = 'delayed';
  else if (code === 3 || /^FINAL(?:\s*\/\s*\d*OT)?$/.test(line)) phase = 'final';
  else if (/^HALF(?:[ -]?TIME)?$/.test(line)) phase = 'halftime';
  else if (/^END(?: OF)? (?:[1-4](?:ST|ND|RD|TH)|\d*OT)(?: QUARTER)?$/.test(line)) phase = 'intermission';
  else if (code === 1) phase = 'live';
  else if (code === 2) phase = 'scheduled';

  const progress = /^(?:END(?: OF)? )?(?:([1-4])(?:ST|ND|RD|TH)|(\d{1,2})?OT)(?:\s+(\d{1,2}:[0-5]\d))?(?: QUARTER)?$/.exec(line);
  const period = progress ? (progress[1] ? Number(progress[1]) : 4 + Number(progress[2] || 1)) : null;
  const reportedClock = progress?.[3] || null;
  const seconds = reportedClock ? Number(reportedClock.split(':')[0]) * 60 + Number(reportedClock.split(':')[1]) : NaN;
  const clock = ['live', 'halftime', 'intermission', 'suspended'].includes(phase) && Number.isFinite(seconds) && seconds <= 15 * 60 ? reportedClock : null;
  return { phase, period, clock, status: clean(event.statusLine, 100) || STATUS[phase][0] };
}

function team(input) {
  if (!object(input) || !TEAM_URI.test(input.uri || '')) return null;
  const canonical = canonicalNFLTeam(input.name);
  if (!canonical) return null;
  return { ...canonical, logo: null, score: integer(input.score), record: clean(input.record, 30) || null, timeouts: null };
}

function normalizeEvent(event, previous) {
  if (!object(event) || event.league !== 'NFL' || event.contentType !== 'event' || event.isTba === true) return null;
  const providerGameId = /^nfl([1-9]\d{0,14})$/.exec(event.id || '')?.[1];
  const startTime = timestamp(event.eventTime);
  const away = team(event.upperTeam), home = team(event.lowerTeam);
  const roles = event.entityLink?.layout?.tokens;
  if (!providerGameId || !startTime || !away || !home || away.id === home.id
    || roles?.awayUri !== event.upperTeam.uri || roles?.homeUri !== event.lowerTeam.uri
    || event.upperTeam.uri === event.lowerTeam.uri) return null;

  const { phase, period, clock, status } = statusOf(event);
  // A missing score in an active or completed game makes this response
  // unusable as a fallback. Do not replace known points with unknowns, or
  // silently drop that matchup while returning other games in the segment.
  if (['live', 'halftime', 'intermission', 'suspended', 'final'].includes(phase)
    && (away.score === null || home.score === null)) throw new TypeError('FOX returned a game without a complete score.');
  const espnId = matchEspnGameId(previous, away, home, startTime);
  const providerId = `fox-${providerGameId}`;
  const awayPossession = event.upperTeam.hasPossession === true, homePossession = event.lowerTeam.hasPossession === true;
  return {
    id: espnId || providerId, detailsGameId: espnId,
    ...(espnId ? { idAliases: [providerId] } : {}),
    provider: 'fox', providerGameId,
    name: `${away.name} at ${home.name}`, shortName: `${away.abbreviation} @ ${home.abbreviation}`,
    startTime, state: ['final', 'canceled'].includes(phase) ? 'post' : ['live', 'halftime', 'intermission', 'suspended'].includes(phase) ? 'in' : 'pre',
    phase, isLive: phase === 'live', status, statusName: STATUS[phase][1], period, clock, away, home,
    possessionTeamId: phase === 'live' && awayPossession !== homePossession ? (awayPossession ? away.id : home.id) : null,
    downDistance: null, fieldPosition: null, playClock: null,
    lastPlay: null, lastPlayDetails: null,
    broadcast: clean(event.tvStation, 100) || null, venue: null,
    // Kickoff and calendar timestamps are not score-frame freshness signals.
    sourceUpdatedAt: null, providerFrame: 'scoreboard',
  };
}

export function normalizeFoxScoreboard(payload, {
  key = 'current', fetchedAt = new Date().toISOString(), sourceUrl, previous,
} = {}) {
  if (key !== 'current') throw new TypeError('FOX is only used for the current NFL schedule.');
  if (!object(payload) || !SEGMENT_ID.test(payload.id || '') || !Array.isArray(payload.sectionList) || payload.sectionList.length > 16) {
    throw new TypeError('FOX returned an unexpected NFL scoreboard.');
  }
  const expectedUrl = endpoint(`segment/${payload.id}`);
  if (sourceUrl) {
    const requested = new URL(sourceUrl);
    if (requested.origin !== ORIGIN || requested.pathname !== `${BASE_PATH}segment/${payload.id}`) throw wrongCalendar();
  }
  const events = [];
  for (const section of payload.sectionList) {
    if (!object(section) || section.segmentId !== payload.id || section.selectionId !== payload.id || !Array.isArray(section.events)) {
      throw new TypeError('FOX returned an incomplete NFL schedule.');
    }
    events.push(...section.events);
    if (events.length > 64) throw new TypeError('FOX returned too many NFL games.');
  }
  const games = events.map(event => normalizeEvent(event, previous)).filter(Boolean);
  if (events.length && !games.length) throw new TypeError('FOX returned incomplete game data.');
  const range = theScoreDateRange('current', Date.parse(fetchedAt));
  const currentGames = games.filter(game => Date.parse(game.startTime) >= range.start && Date.parse(game.startTime) < range.end);
  // A populated old segment is not evidence that the current week is empty.
  if (events.length && !currentGames.length) throw wrongCalendar();
  return {
    games: currentGames,
    fetchedAt, source: 'FOX Sports', sourceUrl: sourceUrl || expectedUrl,
  };
}

/** The shared service bounds both requests and applies game-frame Age rules. */
export function createFoxSource({ now = Date.now } = {}) {
  let calendar = null;
  return {
    id: 'fox', timeoutMs: 6000,
    enabled: key => key === 'current',
    url: () => endpoint('main'),
    async load({ key, requestJson, signal }) {
      if (key !== 'current') throw new TypeError('FOX is only used for the current NFL schedule.');
      signal?.throwIfAborted();
      const week = theScoreDateRange('current', now()).start;
      if (!calendar || calendar.expiresAt <= now() || calendar.week !== week) {
        const metadata = await requestJson(endpoint('main'), { metadata: true });
        signal?.throwIfAborted();
        calendar = { segmentId: currentSegment(metadata), expiresAt: now() + METADATA_TTL_MS, week };
      }
      signal?.throwIfAborted();
      const sourceUrl = endpoint(`segment/${calendar.segmentId}`);
      return { payload: await requestJson(sourceUrl), sourceUrl };
    },
    normalize(payload, options) {
      try { return normalizeFoxScoreboard(payload, options); }
      catch (error) {
        // Retry calendar discovery on the next allowed attempt when FOX's
        // current pointer has lagged behind the Eastern week boundary.
        if (error.code === 'FOX_WRONG_CALENDAR') calendar = null;
        throw error;
      }
    },
  };
}
