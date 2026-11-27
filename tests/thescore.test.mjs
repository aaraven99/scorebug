import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTheScoreSource, normalizeTheScoreScoreboard, theScoreDateRange } from '../lib/thescore.mjs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/thescore-scoreboard-v121.json', import.meta.url)));
const capturedLive = fixture.events.find((event) => event.id === 140742);
const options = { key: '20261126', fetchedAt: fixture._capture.retrievedAt, sourceUrl: fixture._capture.sourceUrl };
const normalize = (events = fixture.events, overrides = {}) => normalizeTheScoreScoreboard(events, { ...options, ...overrides });
const live = () => structuredClone(capturedLive);

test('actual independent response preserves all three matchups, canonical ESPN teams, scores, and reported clock', () => {
  const scoreboard = normalize();
  assert.equal(scoreboard.source, 'theScore');
  assert.equal(scoreboard.fetchedAt, fixture._capture.retrievedAt);
  assert.deepEqual(scoreboard.games.map((game) => [game.shortName, game.away.id, game.home.id, game.away.score, game.home.score, game.phase]), [
    ['CHI @ DET', '3', '8', 39, 35, 'final'],
    ['PHI @ DAL', '21', '6', 17, 31, 'live'],
    ['KC @ BUF', '12', '2', 0, 0, 'scheduled'],
  ]);
  assert.equal(scoreboard.games[0].away.color, '#0b1c3a');
  const game = scoreboard.games[1];
  assert.equal(game.id, 'thescore-140742');
  assert.equal(game.detailsGameId, null);
  assert.equal(game.providerGameId, '140742');
  assert.equal(game.clock, '14:53');
  assert.equal(game.period, 4);
  assert.equal(game.downDistance, '3rd & 1');
  assert.equal(game.fieldPosition, 'DAL 35');
  assert.equal(game.possessionTeamId, '6');
  assert.equal(game.broadcast, 'FOX');
  assert.equal(game.venue, 'AT&T Stadium');
  assert.equal(game.playClock, null);
  assert.equal(game.lastPlay, null);
  assert.equal(game.lastPlayDetails, null);
  assert.equal(scoreboard.games[2].clock, null);
});

test('a live frame is atomic: older box-score fields and event metadata never fill its missing values', () => {
  const event = live();
  event.box_score.score.away.score = 99;
  event.box_score.down = 1;
  event.box_score.formatted_distance = '10';
  event.box_score.field_position = 'PHI 9';
  event.box_score.away_timeouts_left = 3;
  event.box_score.home_timeouts_left = 2;
  event.box_score.updated_at = '2026-11-27T00:29:00Z';
  const game = normalize([event]).games[0];
  assert.equal(game.providerFrame, 'live_box_score');
  assert.equal(game.away.score, 17);
  assert.equal(game.clock, '14:53');
  assert.equal(game.downDistance, '3rd & 1');
  assert.equal(game.fieldPosition, 'DAL 35');
  assert.equal(game.away.timeouts, null);
  assert.equal(game.home.timeouts, null);
  assert.equal(game.sourceUpdatedAt, null);
  delete event.live_box_score.down;
  delete event.live_box_score.progress.clock;
  const incomplete = normalize([event]).games[0];
  assert.equal(incomplete.downDistance, null);
  assert.equal(incomplete.clock, null);
});

test('provider IDs stay distinct unless exactly one prior ESPN matchup has the same kickoff within five minutes', () => {
  const game = normalize([live()]).games[0];
  const known = { ...game, id: '401873080', detailsGameId: '401873080' };
  const match = (games) => normalize([live()], { previous: { games } }).games[0];
  assert.equal(match([known]).id, '401873080');
  assert.equal(match([known]).detailsGameId, '401873080');
  assert.equal(match([{ ...known, startTime: '2026-11-26T21:35:00Z' }]).id, '401873080');
  assert.equal(match([{ ...known, id: 'thescore-140742' }]).id, '401873080');
  for (const prior of [
    [{ ...known, startTime: '2026-11-26T21:35:00.001Z' }],
    [{ ...known, startTime: '2026-12-03T21:30:00Z' }],
    [{ ...known, away: known.home, home: known.away }],
    [known, { ...known, id: '401000000' }],
    [{ ...known, id: 'thescore-140742', detailsGameId: null }],
  ]) {
    assert.equal(match(prior).id, 'thescore-140742');
    assert.equal(match(prior).detailsGameId, null);
  }
});

test('explicit dates filter by Eastern NFL game day, retaining after-midnight UTC games and exact day boundaries', () => {
  const previousDay = { ...live(), id: 140740, game_date: '2026-11-26T01:00:00Z' };
  const nextDay = { ...live(), id: 140744, game_date: '2026-11-27T20:00:00Z' };
  assert.deepEqual(normalize([previousDay, ...fixture.events, nextDay]).games.map((game) => game.providerGameId), ['140741', '140742', '140743']);
  const boundaryTimes = ['2026-11-26T04:59:59.999Z', '2026-11-26T05:00:00Z', '2026-11-27T04:59:59.999Z', '2026-11-27T05:00:00Z'];
  const events = boundaryTimes.map((game_date, i) => ({ ...live(), id: 100 + i, game_date }));
  assert.deepEqual(normalize(events).games.map((game) => game.providerGameId), ['101', '102']);
});

test('day ranges honor both DST transitions and current-week rollover at Tuesday Eastern midnight', () => {
  const iso = (key, at) => Object.values(theScoreDateRange(key, at)).map((value) => new Date(value).toISOString());
  assert.deepEqual(iso('20260308'), ['2026-03-08T05:00:00.000Z', '2026-03-09T04:00:00.000Z']);
  assert.deepEqual(iso('20261101'), ['2026-11-01T04:00:00.000Z', '2026-11-02T05:00:00.000Z']);
  assert.deepEqual(iso('current', Date.parse('2026-12-01T04:59:59Z')), ['2026-11-24T05:00:00.000Z', '2026-12-01T05:00:00.000Z']);
  assert.deepEqual(iso('current', Date.parse('2026-12-01T05:00:00Z')), ['2026-12-01T05:00:00.000Z', '2026-12-08T05:00:00.000Z']);
  for (const value of ['20260230', '20261301', '2026-11-26', '../events', '', null]) assert.throws(() => theScoreDateRange(value), TypeError);
});

test('source uses a bounded date query with a six-second budget and keeps the queried week across a fetch-time rollover', () => {
  const source = createTheScoreSource({ now: () => Date.parse('2026-12-01T04:59:59Z') });
  assert.equal(source.id, 'thescore');
  assert.equal(source.timeoutMs, 6000);
  const url = new URL(source.url('current'));
  assert.equal(url.origin, 'https://api.thescore.com');
  assert.equal(url.pathname, '/nfl/events');
  assert.equal(url.searchParams.get('game_date.in'), '2026-11-24T05:00:00.000Z,2026-12-01T04:59:59.999Z');
  const result = source.normalize(fixture.events, { key: 'current', sourceUrl: url.href, fetchedAt: '2026-12-01T05:00:01Z' });
  assert.equal(result.games.length, 3);
});

test('halftime, quarter breaks, and interrupted games hide active down and possession; final uses the final box score', () => {
  for (const [label, expected] of [['Half', 'halftime'], ['Halftime', 'halftime'], ['End 3rd', 'intermission']]) {
    const event = live();
    event.live_box_score.progress.clock_label = label;
    const game = normalize([event]).games[0];
    assert.equal(game.phase, expected);
    assert.equal(game.isLive, false);
    assert.equal(game.downDistance, null);
    assert.equal(game.possessionTeamId, null);
  }
  for (const phase of ['delayed', 'suspended', 'postponed', 'canceled']) {
    const event = live();
    event.event_status = phase;
    const game = normalize([event]).games[0];
    assert.equal(game.phase, phase);
    assert.equal(game.status.toLowerCase(), phase);
    assert.equal(game.downDistance, null);
  }
  const final = live();
  final.status = final.event_status = 'final';
  final.box_score.score.away.score = 24;
  final.box_score.progress.clock_label = 'Final';
  final.box_score.progress.status = 'final';
  const game = normalize([final]).games[0];
  assert.equal(game.phase, 'final');
  assert.equal(game.providerFrame, 'box_score');
  assert.equal(game.away.score, 24);
  assert.equal(game.downDistance, null);
  assert.equal(game.possessionTeamId, null);
});

test('no frame means unknown scores and unsupported details, never fabricated zeroes or three timeouts', () => {
  const event = live();
  event.status = event.event_status = 'pre_game';
  event.live_box_score = event.box_score = null;
  const game = normalize([event]).games[0];
  for (const side of ['away', 'home']) {
    assert.equal(game[side].score, null);
    assert.equal(game[side].timeouts, null);
  }
  for (const field of ['period', 'clock', 'possessionTeamId', 'downDistance', 'fieldPosition', 'lastPlay', 'lastPlayDetails', 'sourceUpdatedAt']) assert.equal(game[field], null);
});

test('reported zero timeouts, goal-to-go and exact possession IDs survive while invalid facts remain unknown', () => {
  const event = live();
  Object.assign(event.live_box_score, { down: 1, formatted_distance: 'Goal', away_timeouts_left: 0, home_timeouts_left: 2, team_in_possession: { id: 19, api_uri: '/nfl/teams/19' } });
  const game = normalize([event]).games[0];
  assert.equal(game.downDistance, '1st & Goal');
  assert.equal(game.away.timeouts, 0);
  assert.equal(game.home.timeouts, 2);
  assert.equal(game.possessionTeamId, '21');
  for (const bad of [{ id: 17, api_uri: '/nfl/teams/19' }, { id: 999 }, { api_uri: 'https://example.invalid/nfl/teams/17' }, null]) {
    event.live_box_score.team_in_possession = bad;
    assert.equal(normalize([event]).games[0].possessionTeamId, null);
  }
  Object.assign(event.live_box_score, { down: -1, formatted_distance: '10', away_timeouts_left: true, home_timeouts_left: 4 });
  const invalid = normalize([event]).games[0];
  assert.equal(invalid.downDistance, null);
  assert.equal(invalid.away.timeouts, null);
  assert.equal(invalid.home.timeouts, null);
});

test('malformed provider payloads cannot masquerade as an empty healthy schedule', () => {
  assert.deepEqual(normalize([]).games, []);
  for (const payload of [null, {}, { events: [] }, [{ id: 140742 }], [{ ...live(), away_team: { id: 999, abbreviation: 'OTHER' } }]]) {
    assert.throws(() => normalize(payload), TypeError);
  }
});
