import { normalizePlay, normalizePlayer } from './nfl.mjs';
import { NFL_TEAMS, canonicalNFLTeam } from './thescore.mjs';
import { retainKnownStats } from '../public/feed-state.js';

const BASE = 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl';
const TEAMS_BY_ID = new Map(Object.keys(NFL_TEAMS).map((abbreviation) => {
  const team = canonicalNFLTeam(abbreviation);
  return [team.id, { id: team.id, abbreviation, name: team.name }];
}));
const STATS = [['totalYards', 'Total yards'], ['netPassingYards', 'Passing yards'], ['rushingYards', 'Rushing yards'], ['thirdDownEff', '3rd down'], ['turnovers', 'Turnovers'], ['possessionTime', 'Possession']];
const ADMIN_PLAYS = new Set(['2', '21', '65', '66', '70', '74', '75']);
const array = (value) => Array.isArray(value) ? value : [];
const integer = (value) => /^\d{1,12}$/.test(String(value ?? '')) ? Number(value) : null;
const timestamp = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const eventPath = (id) => `/v2/sports/football/leagues/nfl/events/${id}`;

// ESPN supplies HTTP references inside JSON. Read their identities only; no
// reference from a payload is ever fetched or allowed to choose a host/path.
function referencePath(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.hostname === 'sports.core.api.espn.com'
      && !url.port && !url.username && !url.password && !url.hash ? url.pathname : null;
  } catch { return null; }
}
function teamId(team) {
  const fromRef = /^\/v2\/sports\/football\/leagues\/nfl\/(?:seasons\/\d{4}\/)?teams\/(\d{1,8})$/.exec(referencePath(team?.$ref) || '')?.[1];
  if (!fromRef || (team.id != null && String(team.id) !== fromRef)) return null;
  return TEAMS_BY_ID.has(fromRef) ? fromRef : null;
}
function identity(event, id) {
  if (String(event?.id) !== id || referencePath(event?.$ref) !== eventPath(id)) throw new TypeError('Unexpected core event.');
  const competition = array(event.competitions).find((item) => String(item?.id) === id);
  if (referencePath(competition?.$ref) !== `${eventPath(id)}/competitions/${id}`) throw new TypeError('Unexpected core competition.');
  const competitors = array(competition.competitors);
  const side = (name) => {
    const matches = competitors.filter((entry) => entry?.homeAway === name);
    const entry = matches.length === 1 ? matches[0] : null;
    const key = teamId(entry?.team);
    if (!key || String(entry?.id) !== key) throw new TypeError('Unexpected core team.');
    return TEAMS_BY_ID.get(key);
  };
  const away = side('away'), home = side('home');
  if (away.id === home.id) throw new TypeError('Unexpected core matchup.');
  return { away, home };
}

/** Selected-game play evidence only; cumulative stats retain their own age. */
export function normalizeCoreDetails({ event, plays } = {}, { key, fetchedAt = new Date().toISOString(), sourceUrl, previous } = {}) {
  if (!/^\d{1,16}$/.test(key || '')) throw new TypeError('Expected one numeric game.');
  const { away, home } = identity(event, key), teams = [away, home];
  const path = `${eventPath(key)}/competitions/${key}/plays`;
  const items = array(plays?.items);
  if (referencePath(plays?.$ref) !== path || !items.length || items.length > 500 || integer(plays.count) !== items.length
    || integer(plays.pageIndex) !== 1 || integer(plays.pageCount) !== 1) throw new TypeError('Incomplete core play collection.');
  const sameGame = previous?.gameId === key && previous.away?.id === away.id && previous.home?.id === home.id;
  const roster = sameGame ? array(previous.players).slice(0, 128).map((player) => {
    const safe = normalizePlayer({ ...player, displayName: player.name }, teams, { teamId: player.teamId });
    return safe?.teamId ? { ...safe, statCategories: array(player.statCategories).filter((value) => /^[a-zA-Z]{1,30}$/.test(value)).slice(0, 12) } : null;
  }).filter(Boolean) : [];
  const unique = new Map();
  let playsUpdatedAt = null;
  for (const raw of items) {
    const id = String(raw?.id ?? '');
    if (!/^\d{1,24}$/.test(id) || referencePath(raw?.$ref) !== `${path}/${id}` || integer(raw.sequenceNumber) === null) throw new TypeError('Unexpected core play.');
    const modified = timestamp(raw.modified) || timestamp(raw.wallclock);
    if (modified && (!playsUpdatedAt || Date.parse(modified) > Date.parse(playsUpdatedAt))) playsUpdatedAt = modified;
    if (ADMIN_PLAYS.has(String(raw.type?.id))) continue;
    const refTeam = (value) => {
      const id = teamId(value);
      return teams.some((team) => team.id === id) ? { id } : null;
    };
    const position = (value) => value && typeof value === 'object' ? { ...value, team: refTeam(value.team) } : null;
    const mapped = { ...raw, team: refTeam(raw.team), start: position(raw.start), end: position(raw.end) };
    const play = normalizePlay(mapped, teams, { players: roster });
    if (play) unique.set(id, play);
  }
  const ordered = [...unique.values()].sort((a, b) => b.sequenceNumber - a.sequenceNumber || (BigInt(a.id) > BigInt(b.id) ? -1 : 1));
  if (!ordered.length) throw new TypeError('No useful core play data.');
  const previousPlay = sameGame ? previous.lastPlay : null;
  if (previousPlay?.sequenceNumber != null && ordered[0].sequenceNumber < previousPlay.sequenceNumber
    && !ADMIN_PLAYS.has(previousPlay.typeId)) throw new TypeError('Core plays are older than the known play.');
  const eventPlays = ordered.slice(0, 24), recentPlays = eventPlays.slice(0, 3);
  return retainKnownStats({
    gameId: key, fetchedAt, sourceUpdatedAt: null, playsUpdatedAt, source: 'ESPN', sourceUrl,
    dataScope: 'plays', statsStale: true, statsFetchedAt: null,
    state: 'unknown', phase: 'unknown', period: null, clock: null,
    away, home, teamStats: STATS.map(([key, label]) => ({ key, label, away: null, home: null })),
    leaders: [['passingYards', 'Passing'], ['rushingYards', 'Rushing'], ['receivingYards', 'Receiving']].map(([key, label]) => ({ key, label, away: null, home: null })),
    players: roster, lastPlay: eventPlays[0], recentPlays, eventPlays, drive: null, situation: null,
  }, sameGame ? previous : null);
}

export function createCoreDetailsSource({ ErrorType = TypeError } = {}) {
  const metadata = new Map();
  const invalid = (cause) => new ErrorType('The game details feed returned unexpected play data.', { code: 'INVALID_DETAILS', cause });
  return {
    id: 'espn-core',
    url: (key) => `${BASE}/events/${key}/competitions/${key}/plays?limit=500`,
    async load({ key, sourceUrl, requestJson, now }) {
      const cached = metadata.get(key);
      const eventTask = cached && cached.expiresAt > now() ? Promise.resolve(cached.event)
        : requestJson(`${BASE}/events/${key}`, { metadata: true });
      const [event, plays] = await Promise.all([eventTask, requestJson(sourceUrl)]);
      try { identity(event, key); } catch (cause) { throw invalid(cause); }
      if (!cached || cached.expiresAt <= now()) {
        if (!metadata.has(key) && metadata.size >= 16) metadata.delete(metadata.keys().next().value);
        metadata.set(key, { event, expiresAt: now() + 300000 });
      }
      return { payload: { event, plays }, sourceUrl };
    },
    normalize(payload, context) {
      try { return normalizeCoreDetails(payload, context); } catch (cause) { throw invalid(cause); }
    },
  };
}
