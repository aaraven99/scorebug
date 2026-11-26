import test from 'node:test';
import assert from 'node:assert/strict';
import { createScoreboardService, normalizeGame, normalizeScoreboard, ScoreboardError, validateDate } from '../lib/nfl.mjs';

function event(overrides = {}) {
  return {
    id: '401873081',
    name: 'Chicago Bears at Detroit Lions',
    shortName: 'CHI @ DET',
    date: '2026-11-26T18:00Z',
    competitions: [{
      competitors: [
        { homeAway: 'home', team: { id: '8', displayName: 'Detroit Lions', abbreviation: 'DET', color: '0076b6', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/det.png' }, score: '3', records: [{ type: 'total', summary: '8-2' }] },
        { homeAway: 'away', team: { id: '3', displayName: 'Chicago Bears', abbreviation: 'CHI', color: '0b1c3a', alternateColor: 'e64100' }, score: '0' },
      ],
      status: { displayClock: '6:23', period: 1, type: { name: 'STATUS_IN_PROGRESS', state: 'in', completed: false, description: 'In Progress', shortDetail: '6:23 - 1st' } },
      situation: { down: 4, distance: 6, shortDownDistanceText: '4th & 6', possessionText: 'DET 20', possession: '8', homeTimeouts: 0, awayTimeouts: 3, lastPlay: { text: 'Pass incomplete.' } },
      venue: { fullName: 'Ford Field' },
      broadcasts: [{ names: ['CBS'] }],
      ...overrides,
    }],
  };
}

const jsonResponse = (value, init = {}) => new Response(JSON.stringify(value), { ...init, headers: { 'content-type': 'application/json' } });

test('live data preserves a zero score, zero remaining timeouts, possession, and the actual game clock', () => {
  const game = normalizeGame(event());
  assert.equal(game.away.abbreviation, 'CHI');
  assert.equal(game.home.abbreviation, 'DET');
  assert.equal(game.away.score, 0);
  assert.equal(game.home.timeouts, 0);
  assert.equal(game.possessionTeamId, '8');
  assert.equal(game.downDistance, '4th & 6');
  assert.equal(game.clock, '6:23');
  assert.equal(game.isLive, true);
  assert.equal(game.playClock, null);
  assert.equal(game.broadcast, 'CBS');
});

test('a kickoff/scoring transition never invents a negative down or play clock', () => {
  const game = normalizeGame(event({ situation: { down: -1, distance: 0, possession: '3', lastPlay: { text: 'Official Timeout at 04:07.' } } }));
  assert.equal(game.downDistance, null);
  assert.equal(game.playClock, null);
  assert.equal(game.away.timeouts, null);
  assert.equal(game.lastPlay, 'Official Timeout at 04:07.');
});

test('structured scoreboard last plays preserve identity and explicit facts without assigning the current clock to the old play', () => {
  // The scoreboard's situation.lastPlay carries IDs/type/value/yardage, but
  // often does not carry a play clock, score snapshot, or turnover flag.
  const game = normalizeGame(event({ situation: { lastPlay: {
    id: '401873081200', type: { id: '68', text: 'Rushing Touchdown' }, text: 'Rush for a touchdown.',
    scoreValue: 6, statYardage: 20, team: { id: '3' }, start: { team: { id: '3' } }, end: { team: { id: '3' } },
  } } }));
  assert.equal(game.lastPlay, 'Rush for a touchdown.');
  assert.equal(game.lastPlayDetails.id, '401873081200');
  assert.equal(game.lastPlayDetails.typeId, '68');
  assert.equal(game.lastPlayDetails.scoreValue, 6);
  assert.equal(game.lastPlayDetails.scoringTeamId, '3');
  assert.equal(game.lastPlayDetails.yardsGained, 20);
  assert.equal(game.lastPlayDetails.clock, null);
  assert.equal(game.lastPlayDetails.period, null);
  assert.equal(game.lastPlayDetails.isTurnover, null);
  assert.deepEqual(game.lastPlayDetails.scores, { away: null, home: null });
});

test('missing and invalid play metadata stays unknown and a no-play penalty remains explicit', () => {
  const game = normalizeGame(event({ situation: { lastPlay: {
    id: 'invalid', text: 'Pass for 99 yards. NO PLAY.', type: { id: '24', text: 'Pass Reception' },
    scoreValue: '', statYardage: true, isTurnover: 'true', team: { id: '999' },
  } } }));
  assert.equal(game.lastPlayDetails.id, null);
  assert.equal(game.lastPlayDetails.scoreValue, null);
  assert.equal(game.lastPlayDetails.yardsGained, null);
  assert.equal(game.lastPlayDetails.scoringTeamId, null);
  assert.equal(game.lastPlayDetails.isTurnover, null);
  assert.equal(game.lastPlayDetails.isNoPlay, true);
  assert.equal(normalizeGame(event({ situation: null })).lastPlayDetails, null);
});

test('scheduled and missing data do not become made-up clocks, timeouts, scores, or possession', () => {
  const input = event({ status: { displayClock: '0:00', period: 0, type: { state: 'pre', name: 'STATUS_SCHEDULED' } }, situation: null });
  delete input.competitions[0].competitors[0].score;
  const game = normalizeGame(input);
  assert.equal(game.phase, 'scheduled');
  assert.equal(game.clock, null);
  assert.equal(game.home.score, null);
  assert.equal(game.home.timeouts, null);
  assert.equal(game.possessionTeamId, null);
});

test('halftime, intermission, suspension, delay, cancellation, postponement and final remain distinct', () => {
  for (const [name, state, expected] of [
    ['STATUS_HALFTIME', 'in', 'halftime'],
    ['STATUS_END_PERIOD', 'in', 'intermission'],
    ['STATUS_SUSPENDED', 'in', 'suspended'],
    ['STATUS_DELAYED', 'in', 'delayed'],
    ['STATUS_CANCELED', 'post', 'canceled'],
    ['STATUS_POSTPONED', 'pre', 'postponed'],
    ['STATUS_FINAL_OVERTIME', 'post', 'final'],
  ]) {
    const game = normalizeGame(event({ status: { displayClock: '0:00', period: 5, type: { name, state } } }));
    assert.equal(game.phase, expected);
    assert.equal(game.isLive, false);
    assert.equal(game.possessionTeamId, null);
    assert.equal(game.downDistance, null);
  }
});

test('goal-to-go text and overtime period survive normalization', () => {
  const game = normalizeGame(event({ status: { displayClock: '3:15', period: 5, type: { name: 'STATUS_IN_PROGRESS', state: 'in' } }, situation: { down: 1, distance: 6, downDistanceText: '1st & Goal at DET 6' } }));
  assert.equal(game.period, 5);
  assert.equal(game.downDistance, '1st & Goal');
  assert.equal(game.clock, '3:15');
});

test('unexpected logo domains and invalid colors are not passed into the UI', () => {
  const input = event();
  input.competitions[0].competitors[0].team.logo = 'https://evil.example/track.svg';
  input.competitions[0].competitors[0].team.color = 'red; background:url(https://evil.example)';
  const game = normalizeGame(input);
  assert.equal(game.home.logo, null);
  assert.equal(game.home.color, '#39414c');
});

test('empty weeks are valid, but broken upstream schemas do not masquerade as empty weeks', () => {
  assert.deepEqual(normalizeScoreboard({ events: [] }).games, []);
  assert.throws(() => normalizeScoreboard({}), { code: 'INVALID_UPSTREAM' });
  assert.throws(() => normalizeScoreboard({ events: [{ id: '1' }] }), { code: 'INVALID_UPSTREAM' });
  assert.equal(normalizeScoreboard({ events: [{ id: '1' }, event()] }).games.length, 1);
});

test('dates must be real YYYYMMDD calendar dates', () => {
  assert.equal(validateDate(undefined), undefined);
  assert.equal(validateDate('20240229'), '20240229');
  for (const date of ['20260229', '20261301', '20260001', '20260100', '2026-11-26', '', ['20261126'], 20261126, '../etc']) {
    assert.throws(() => validateDate(date), { statusCode: 400, code: 'INVALID_DATE' });
  }
});

test('concurrent readers share one request and warm cache expires after five seconds', async () => {
  let requests = 0;
  let now = Date.parse('2026-11-26T19:00:00Z');
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  const get = createScoreboardService({ now: () => now, fetchImpl: async () => { requests += 1; await wait; return jsonResponse({ events: [event()] }); } });
  const first = get();
  const second = get();
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(requests, 1);
  assert.equal(a, b);
  now += 4_999;
  assert.equal(await get(), a);
  assert.equal(requests, 1);
  now += 1;
  const refreshed = await get();
  assert.equal(requests, 2);
  assert.notEqual(refreshed.fetchedAt, a.fetchedAt);
});

test('an expired successful response is not returned as live when the feed fails', async () => {
  let fail = false;
  let now = Date.parse('2026-11-26T19:00:00Z');
  const get = createScoreboardService({ now: () => now, fetchImpl: async () => {
    if (fail) return new Response('Unavailable', { status: 503 });
    return jsonResponse({ events: [event()] });
  } });
  await get();
  fail = true;
  now += 5_001;
  await assert.rejects(get(), { statusCode: 503, code: 'UPSTREAM_UNAVAILABLE' });
  fail = false;
  assert.equal((await get()).games.length, 1);
});

test('invalid dates never reach upstream, and dated requests use distinct cache entries', async () => {
  const urls = [];
  const get = createScoreboardService({ fetchImpl: async (url) => { urls.push(url); return jsonResponse({ events: [] }); } });
  await assert.rejects(get({ date: '20260229' }), { statusCode: 400 });
  assert.equal(urls.length, 0);
  await get({ date: '20261126' });
  await get({ date: '20261127' });
  assert.equal(urls.length, 2);
  assert.ok(urls[0].endsWith('?dates=20261126'));
  assert.ok(urls[1].endsWith('?dates=20261127'));
});

test('HTML responses, oversized responses, malformed JSON, and network errors fail safely', async () => {
  for (const response of [
    new Response('<html>upstream error</html>', { headers: { 'content-type': 'text/html' } }),
    new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '5000000' } }),
    new Response('{', { headers: { 'content-type': 'application/json' } }),
  ]) {
    const get = createScoreboardService({ fetchImpl: async () => response });
    await assert.rejects(get(), { code: 'INVALID_UPSTREAM', statusCode: 502 });
  }
  const get = createScoreboardService({ fetchImpl: async () => { throw new TypeError('private network internals'); } });
  await assert.rejects(get(), (error) => error instanceof ScoreboardError && error.statusCode === 502 && !error.message.includes('private'));
});
