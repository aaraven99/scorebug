import test from 'node:test';
import assert from 'node:assert/strict';
import { createFoxSource, normalizeFoxScoreboard } from '../lib/fox.mjs';
import { createFeedService } from '../lib/feed-service.mjs';

const NOW = Date.parse('2026-11-27T01:32:00Z');
const SEGMENT = '2026-12-1';
// Minimal game facts from the actual FOX segment response captured 2026-11-27.
// Ads, headlines, images and odds are deliberately excluded from the fixture.
const captured = [
  ['11096', '2026-11-26T18:00:00Z', 3, 'FINAL', ['CHI', '20', 39, '9-2'], ['DET', '21', 35, '8-3']],
  ['11097', '2026-11-26T21:30:00Z', 3, 'FINAL', ['PHI', '17', 39, '4-7'], ['DAL', '15', 38, '5-7']],
  ['11284', '2026-11-27T01:20:00Z', 1, '1ST 10:56', ['KC', '11', 0, '8-2'], ['BUF', '1', 0, '9-1'], 'NBC'],
  ['11285', '2026-11-27T20:00:00Z', 2, undefined, ['DEN', '10', undefined, '8-2'], ['PIT', '9', undefined, '6-4'], 'AMZN'],
  ['11294', '2026-11-29T21:25:00Z', 2, undefined, ['WAS', '19', undefined, '4-5-1'], ['ARI', '18', undefined, '3-8'], 'FOX'],
].map(([id, eventTime, eventStatus, statusLine, away, home, tvStation]) => {
  const team = ([name, id, score, record]) => ({ name, uri: `football/nfl/teams/${id}`, score, record, hasPossession: false });
  return {
    id: `nfl${id}`, league: 'NFL', contentType: 'event', eventTime, eventStatus, statusLine, tvStation,
    upperTeam: team(away), lowerTeam: team(home),
    entityLink: { layout: { tokens: { awayUri: `football/nfl/teams/${away[1]}`, homeUri: `football/nfl/teams/${home[1]}` } } },
  };
});
const live = () => structuredClone(captured[2]);
const segment = (events = captured, id = SEGMENT) => ({ id, sectionList: [{ segmentId: id, selectionId: id, events }] });
const metadata = (id = SEGMENT) => ({ title: 'NFL', currentSelectionId: id, selectionGroupList: [{ title: 'REGULAR SEASON', selectionList: [{ id, uri: 'https://untrusted.invalid/do-not-follow' }] }] });
const normalize = (payload = segment(), options = {}) => normalizeFoxScoreboard(payload, { fetchedAt: new Date(NOW).toISOString(), ...options });

test('captured FOX game facts become canonical teams, exact scores and the reported clock', () => {
  const result = normalize();
  assert.equal(result.source, 'FOX Sports');
  assert.deepEqual(result.games.map(game => [game.shortName, game.away.id, game.home.id, game.away.score, game.home.score, game.phase]), [
    ['CHI @ DET', '3', '8', 39, 35, 'final'],
    ['PHI @ DAL', '21', '6', 39, 38, 'final'],
    ['KC @ BUF', '12', '2', 0, 0, 'live'],
    ['DEN @ PIT', '7', '23', null, null, 'scheduled'],
    ['WSH @ ARI', '28', '22', null, null, 'scheduled'],
  ]);
  const game = result.games[2];
  assert.equal(game.id, 'fox-11284');
  assert.equal(game.providerGameId, '11284');
  assert.equal(game.detailsGameId, null);
  assert.equal(game.clock, '10:56');
  assert.equal(game.period, 1);
  assert.equal(game.broadcast, 'NBC');
  assert.equal(game.away.color, '#e31837');
  assert.equal(game.home.color, '#00338d');
  assert.equal(game.away.timeouts, null);
  assert.equal(game.home.timeouts, null);
  for (const field of ['possessionTeamId', 'downDistance', 'fieldPosition', 'playClock', 'venue', 'lastPlay', 'lastPlayDetails', 'sourceUpdatedAt']) assert.equal(game[field], null);
  assert.equal(result.games[0].clock, null);
  assert.equal(result.games[3].clock, null);
});

test('only one explicitly reported possession marker is used, and unsupported fields stay unknown', () => {
  const event = live();
  event.upperTeam.hasPossession = true;
  let game = normalize(segment([event])).games[0];
  assert.equal(game.possessionTeamId, '12');
  const old = { ...game, downDistance: '2nd & 5', fieldPosition: 'BUF 30', away: { ...game.away, timeouts: 3 } };
  game = normalize(segment([event]), { previous: { games: [old] } }).games[0];
  assert.equal(game.downDistance, null);
  assert.equal(game.fieldPosition, null);
  assert.equal(game.away.timeouts, null);
  event.lowerTeam.hasPossession = true;
  assert.equal(normalize(segment([event])).games[0].possessionTeamId, null);
  event.upperTeam.hasPossession = false;
  assert.equal(normalize(segment([event])).games[0].possessionTeamId, '2');
  event.statusLine = 'HALFTIME';
  assert.equal(normalize(segment([event])).games[0].possessionTeamId, null);
});

test('missing active or final scores reject the whole fallback, including otherwise complete matchups', () => {
  for (const [code, line] of [[1, '1ST 10:56'], [1, 'HALFTIME'], [1, 'END 3RD'], [1, 'SUSPENDED'], [3, 'FINAL']]) {
    for (const missing of [['upperTeam'], ['lowerTeam'], ['upperTeam', 'lowerTeam']]) {
      const event = live();
      event.eventStatus = code;
      event.statusLine = line;
      for (const side of missing) delete event[side].score;
      assert.throws(() => normalize(segment([captured[0], event, captured[3]])), /without a complete score/, `${line}: ${missing}`);
    }
  }
  const upcoming = normalize(segment([captured[3]])).games[0];
  assert.equal(upcoming.away.score, null);
  assert.equal(upcoming.home.score, null);
});

test('provider IDs never become ESPN IDs without a unique matching fixture', () => {
  const original = normalize(segment([live()])).games[0];
  const known = { ...original, id: '401873081', detailsGameId: '401873081' };
  const convert = games => normalize(segment([live()]), { previous: { games } }).games[0];
  const matched = convert([known]);
  assert.equal(matched.id, '401873081');
  assert.equal(matched.detailsGameId, '401873081');
  assert.deepEqual(matched.idAliases, ['fox-11284']);
  for (const previous of [
    [{ ...known, startTime: '2026-11-27T01:25:00.001Z' }],
    [{ ...known, away: known.home, home: known.away }],
    [known, { ...known, id: '401999999' }],
    [{ ...known, id: 'thescore-140743', detailsGameId: null }],
  ]) {
    assert.equal(convert(previous).id, 'fox-11284');
    assert.equal(convert(previous).detailsGameId, null);
  }
});

test('breaks, overtime and interrupted status labels never invent an active clock or possession', () => {
  for (const [line, phase, period, clock] of [
    ['HALFTIME', 'halftime', null, null], ['END 3RD', 'intermission', 3, null],
    ['OT 9:31', 'live', 5, '9:31'], ['2OT 10:12', 'live', 6, '10:12'],
    ['1ST 99:11', 'live', 1, null], ['FINAL/OT', 'final', null, null],
    ['DELAYED', 'delayed', null, null], ['POSTPONED', 'postponed', null, null],
    ['SUSPENDED', 'suspended', null, null], ['CANCELED', 'canceled', null, null],
  ]) {
    const event = live();
    event.statusLine = line;
    event.upperTeam.hasPossession = true;
    const game = normalize(segment([event])).games[0];
    assert.equal(game.phase, phase, line);
    assert.equal(game.period, period, line);
    assert.equal(game.clock, clock, line);
    if (phase !== 'live') assert.equal(game.possessionTeamId, null, line);
  }
  const event = live();
  event.eventStatus = 99;
  delete event.statusLine;
  assert.equal(normalize(segment([event])).games[0].phase, 'unknown');
});

test('current-week filtering excludes unrelated dates and historical requests are disabled', async () => {
  const old = { ...live(), id: 'nfl10000', eventTime: '2026-11-19T01:20:00Z' };
  const next = { ...live(), id: 'nfl20000', eventTime: '2026-12-04T01:20:00Z' };
  assert.deepEqual(normalize(segment([old, live(), next])).games.map(game => game.id), ['fox-11284']);
  const source = createFoxSource({ now: () => NOW });
  assert.equal(source.enabled('current'), true);
  assert.equal(source.enabled('20261126'), false);
  assert.throws(() => normalize(segment(), { key: '20261126' }), /current NFL schedule/);
  let called = false;
  await assert.rejects(source.load({ key: '20261126', requestJson: () => { called = true; } }), /current NFL schedule/);
  assert.equal(called, false);
});

test('malformed game identity or team roles cannot silently swap the home and away teams', () => {
  for (const change of [
    event => { event.id = 'nfl../../1'; },
    event => { event.league = 'NBA'; },
    event => { event.upperTeam.name = 'FAKE'; },
    event => { event.entityLink.layout.tokens.homeUri = event.upperTeam.uri; },
    event => { event.upperTeam.uri = 'https://other.invalid/team'; },
  ]) {
    const event = live(); change(event);
    assert.throws(() => normalize(segment([event])), /incomplete game data/);
  }
  assert.throws(() => normalize(segment(), { sourceUrl: 'https://api.foxsports.com/bifrost/v1/nfl/scoreboard/segment/2026-11-1' }), /wrong current NFL schedule/);
  assert.throws(() => normalize({ ...segment(), sectionList: [{ segmentId: 'other', events: [] }] }), /incomplete NFL schedule/);
});

test('loader discovers the current segment, caches only calendar metadata for 60 seconds, and never follows supplied URLs', async () => {
  let now = NOW;
  const source = createFoxSource({ now: () => now });
  const calls = [];
  const requestJson = async (url, options = {}) => {
    calls.push({ url: new URL(url), options });
    return new URL(url).pathname.endsWith('/main') ? metadata() : segment();
  };
  const load = () => source.load({ key: 'current', requestJson, signal: new AbortController().signal });
  const first = await load();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].options, { metadata: true });
  assert.deepEqual(calls[1].options, {});
  assert.match(first.sourceUrl, /\/segment\/2026-12-1\?/);
  now += 59_999;
  await load();
  assert.equal(calls.length, 3, 'Every read still fetches a new score segment.');
  now += 1;
  await load();
  assert.equal(calls.length, 5);
  for (const call of calls) {
    assert.equal(call.url.origin, 'https://api.foxsports.com');
    assert.equal(call.url.searchParams.get('api-version'), '1.1');
    assert.ok(call.url.searchParams.get('apikey'));
  }
  assert.equal(source.timeoutMs, 6000);
});

test('a new NFL calendar week invalidates still-young metadata and uses the newly reported ID', async () => {
  let now = Date.parse('2026-12-01T04:59:59Z'), id = SEGMENT;
  const source = createFoxSource({ now: () => now });
  const paths = [];
  const load = () => source.load({ key: 'current', requestJson: async url => {
    const pathname = new URL(url).pathname;
    paths.push(pathname);
    return pathname.endsWith('/main') ? metadata(id) : segment([], id);
  } });
  await load();
  now += 1000; id = '2026-13-1';
  await load();
  assert.deepEqual(paths.map(value => value.split('/').at(-1)), ['main', SEGMENT, 'main', '2026-13-1']);
});

test('a lagging calendar pointer at week rollover cannot become an empty scoreboard and is rediscovered', async () => {
  let now = Date.parse('2026-12-01T04:59:59Z'), id = SEGMENT;
  const source = createFoxSource({ now: () => now });
  const paths = [];
  const nextWeek = { ...live(), eventTime: '2026-12-04T01:20:00Z' };
  const read = async () => {
    const result = await source.load({ key: 'current', requestJson: async url => {
      paths.push(new URL(url).pathname);
      return url.includes('/main?') ? metadata(id) : segment(id === SEGMENT ? captured : [nextWeek], id);
    } });
    return source.normalize(result.payload, { sourceUrl: result.sourceUrl, fetchedAt: new Date(now).toISOString() });
  };
  assert.equal((await read()).games.length, captured.length);
  now += 1000; // Metadata still incorrectly reports the previous week's ID.
  await assert.rejects(read(), { code: 'FOX_WRONG_CALENDAR' });
  id = '2026-13-1';
  assert.equal((await read()).games.length, 1);
  assert.deepEqual(paths.map(value => value.split('/').at(-1)), ['main', SEGMENT, 'main', SEGMENT, 'main', '2026-13-1']);
  assert.deepEqual(normalize(segment([])).games, [], 'A genuinely empty segment remains distinct from an outdated populated one.');
});

test('bad or aborted metadata never triggers another request or seeds the calendar cache', async () => {
  for (const invalid of [
    { ...metadata(), currentSelectionId: '../../private' },
    { ...metadata(), currentSelectionId: '2026-15-1' },
    { ...metadata(), title: 'NBA' },
  ]) {
    const source = createFoxSource({ now: () => NOW });
    let calls = 0;
    await assert.rejects(source.load({ key: 'current', requestJson: async () => { calls += 1; return invalid; } }));
    assert.equal(calls, 1);
  }
  const source = createFoxSource({ now: () => NOW });
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(source.load({ key: 'current', signal: controller.signal, requestJson: async () => {
    calls += 1; controller.abort(); return metadata();
  } }), { name: 'AbortError' });
  assert.equal(calls, 1);
  const paths = [];
  await source.load({ key: 'current', requestJson: async url => { paths.push(new URL(url).pathname); return url.includes('/main?') ? metadata() : segment(); } });
  assert.equal(paths.length, 2, 'Aborted metadata was not cached.');
});

class FeedError extends Error { constructor(message, options = {}) { super(message); Object.assign(this, options); } }
function feedWithFox(segmentAge, metadataAge = 120, warning) {
  return createFeedService({
    sources: [createFoxSource({ now: () => NOW })],
    ErrorType: FeedError, label: 'FOX test feed', invalidCode: 'INVALID', unavailableCode: 'UNAVAILABLE', timeoutCode: 'TIMEOUT',
    now: () => NOW,
    fetchImpl: async (url, options) => {
      assert.equal(options.redirect, 'error');
      assert.ok(options.signal);
      const main = new URL(url).pathname.endsWith('/main');
      return Response.json(main ? metadata() : segment(), { headers: { Age: String(main ? metadataAge : segmentAge), ...(warning && !main ? { Warning: warning } : {}) } });
    },
  });
}

test('shared freshness checks use game-frame age, not cached calendar age', async () => {
  const fresh = await feedWithFox(0)('current');
  assert.equal(fresh.stale, false);
  assert.equal(fresh.fetchedAt, new Date(NOW).toISOString());
  assert.equal(fresh.sourceId, 'fox');
  const delayed = await feedWithFox(20)('current');
  assert.equal(delayed.stale, true);
  assert.equal(delayed.feedStatus, 'cached');
  assert.equal(delayed.fetchedAt, new Date(NOW - 20_000).toISOString());
  assert.equal(delayed.checkedAt, new Date(NOW).toISOString());
  await assert.rejects(feedWithFox(46)('current'));
  await assert.rejects(feedWithFox(1, 120, '110 upstream "Response is stale"')('current'));
  await assert.rejects(feedWithFox(0, 301)('current'));
});

test('an incomplete fresh FOX fallback preserves the last known score during a primary outage', async () => {
  for (const final of [false, true]) {
    let now = NOW, outage = false;
    const known = normalize(segment([live()]));
    known.games[0].away.score = 7;
    known.games[0].home.score = 3;
    const incomplete = live();
    delete incomplete.lowerTeam.score;
    if (final) { incomplete.eventStatus = 3; incomplete.statusLine = 'FINAL'; }
    const read = createFeedService({
      sources: [{ id: 'primary', url: () => 'https://primary.example/scoreboard' }, createFoxSource({ now: () => now })],
      normalize: (data, { fetchedAt }) => ({ ...data, fetchedAt }),
      ErrorType: FeedError, label: 'FOX test feed', invalidCode: 'INVALID', unavailableCode: 'UNAVAILABLE', timeoutCode: 'TIMEOUT',
      now: () => now,
      fetchImpl: async url => {
        if (new URL(url).hostname === 'primary.example') return outage ? Response.json({}, { status: 503 }) : Response.json(known);
        return Response.json(url.includes('/main?') ? metadata() : segment([captured[0], incomplete, captured[3]]));
      },
    });
    const first = await read('current');
    now += 1001; outage = true;
    const fallback = await read('current');
    assert.equal(fallback.stale, true);
    assert.equal(fallback.sourceId, 'primary');
    assert.equal(fallback.fetchedAt, first.fetchedAt);
    assert.equal(fallback.games[0].away.score, 7);
    assert.equal(fallback.games[0].home.score, 3);
  }
});
