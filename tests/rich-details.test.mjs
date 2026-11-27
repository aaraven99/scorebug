import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeGameDetails } from '../lib/details.mjs';
import { normalizeCoreDetails } from '../lib/espn-core.mjs';
import { retainKnownStats } from '../public/feed-state.js';

const captured = JSON.parse(readFileSync(new URL('./fixtures/espn-rich-v130.json', import.meta.url)));
const core = JSON.parse(readFileSync(new URL('./fixtures/espn-core-v122.json', import.meta.url)));
const fixture = () => structuredClone(captured.summary);
const fetchedAt = '2026-11-27T02:00:00.000Z';

test('official full summary preserves all team stats, quarters, scoring history, drives and player categories', () => {
  const data = normalizeGameDetails(fixture(), { fetchedAt });
  assert.equal(data.teamStats.length, 6, 'The compact scorebug contract stays intact.');
  assert.equal(data.allTeamStats.length, 24);
  assert.equal(data.allTeamStats.filter((row) => row.key === 'interceptions').length, 1, 'ESPN repeats interceptions thrown in two groups.');
  assert.deepEqual(data.quarterScores, [
    { period: 1, label: 'Q1', away: 0, home: 14 }, { period: 2, label: 'Q2', away: 10, home: 14 },
    { period: 3, label: 'Q3', away: 7, home: 3 }, { period: 4, label: 'Q4', away: 22, home: 7 },
  ]);
  assert.equal(data.playByPlay.length, 195);
  assert.equal(data.scoringPlays.length, 13);
  assert.equal(data.drives.length, 25);
  assert.equal(new Set(data.playByPlay.map((play) => play.id)).size, 195);
  assert.ok(data.playByPlay.every((play, index, all) => !index || BigInt(all[index - 1].id) >= BigInt(play.id)));
  assert.deepEqual(data.playerStats.map((group) => group.key), ['passing', 'rushing', 'receiving', 'fumbles', 'defensive', 'interceptions', 'kickReturns', 'puntReturns', 'kicking', 'punting']);
  const passing = data.playerStats.find((group) => group.key === 'passing');
  assert.equal(passing.columns[0].label, 'C/ATT');
  assert.equal(passing.away.athletes[0].player.name, 'Joe Milton');
  assert.equal(passing.away.athletes[0].values[0], '21/31');
  assert.equal(passing.away.totals[1], '301');
  assert.equal(passing.away.totals[6], null, 'Provider -- remains unknown.');
  assert.ok(data.playerStats.every((group) => ['away', 'home'].every((side) => group[side].athletes.every((athlete) => athlete.values.length === group.columns.length))));
  assert.equal(data.eventPlays.length, 24); assert.equal(data.recentPlays.length, 3);
});

test('source game metadata is exposed without invented weather, venue features, or broadcast guesses', () => {
  const info = normalizeGameDetails(fixture()).gameInfo;
  assert.equal(info.venue.name, 'AT&T Stadium'); assert.equal(info.venue.city, 'Arlington');
  assert.equal(info.venue.indoor, null); assert.equal(info.weather, null);
  assert.equal(info.attendance, 93417); assert.deepEqual(info.broadcasts, ['Fox']);
  assert.deepEqual(info.season, { year: 2026, type: 2, label: null }); assert.equal(info.week, 12);
  assert.equal(info.officials.length, 7);
  const payload = fixture();
  payload.gameInfo.weather = { displayValue: 'Sunny', temperature: 62 };
  const weather = normalizeGameDetails(payload).gameInfo.weather;
  assert.deepEqual(weather, { summary: 'Sunny', temperature: 62, unit: null }, 'Do not guess a temperature unit.');
});

test('player columns align by source keys across reordered or partial team categories', () => {
  const payload = fixture();
  const away = payload.boxscore.players.find((entry) => entry.team.id === '21');
  const home = payload.boxscore.players.find((entry) => entry.team.id === '6');
  away.statistics = [{ name: 'passing', keys: ['passingYards', 'passingTouchdowns'], labels: ['YDS', 'TD'], descriptions: ['Yards', 'Touchdowns'], athletes: [{ athlete: { id: '11', displayName: 'Away Player' }, stats: ['100', '0'] }], totals: ['100', '0'] }];
  home.statistics = [{ name: 'passing', keys: ['passingTouchdowns', 'passingYards', 'interceptions'], labels: ['TD', 'YDS', 'INT'], athletes: [{ athlete: { id: '12', displayName: 'Home Player' }, stats: ['2', '200', '1'] }], totals: ['2', '200', '1'] }];
  const group = normalizeGameDetails(payload).playerStats[0];
  assert.deepEqual(group.columns.map((column) => column.key), ['passingYards', 'passingTouchdowns', 'interceptions']);
  assert.deepEqual(group.away.athletes[0].values, ['100', '0', null]);
  assert.deepEqual(group.home.athletes[0].values, ['200', '2', '1']);
  assert.deepEqual(group.home.totals, ['200', '2', '1']);
});

test('missing rich sections stay empty, source numeric ratios keep their units, and missing quarter sides stay null', () => {
  const payload = { header: fixture().header, boxscore: { teams: [{ team: { id: '21' }, statistics: [
    { name: 'thirdDownEff', value: 0.5 }, { name: 'possessionTime', value: 90 }, { name: 'totalYards', value: 0 },
  ] }] } };
  const competition = payload.header.competitions[0];
  for (const competitor of competition.competitors) competitor.linescores = [];
  competition.competitors.find((entry) => entry.id === '21').linescores = [{ period: 5, displayValue: '3' }];
  const data = normalizeGameDetails(payload);
  assert.deepEqual(data.quarterScores, [{ period: 5, label: 'OT', away: 3, home: null }]);
  assert.equal(data.allTeamStats.find((row) => row.key === 'thirdDownEff').away, null);
  assert.equal(data.allTeamStats.find((row) => row.key === 'possessionTime').away, null);
  assert.equal(data.allTeamStats.find((row) => row.key === 'totalYards').away, '0');
  assert.deepEqual(data.playerStats, []); assert.deepEqual(data.drives, []);
  assert.deepEqual(data.playByPlay, []); assert.deepEqual(data.scoringPlays, []);
});

test('historical drives deduplicate current/previous entries without becoming the current field position', () => {
  const payload = fixture();
  const raw = payload.drives.previous.at(-1);
  payload.drives.current = structuredClone(raw);
  const data = normalizeGameDetails(payload);
  assert.equal(data.drives.length, 25);
  assert.ok(data.drives.every((drive) => !drive.isActive));
  assert.equal(data.situation, null);
  const first = data.drives.at(-1);
  assert.deepEqual(first.start, { period: 1, clock: '15:00', fieldPosition: 'DAL 23', yardLine: 23 });
  assert.equal(first.playIds.length, payload.drives.previous[0].plays.length);
});

test('play history is bounded separately from the animation and compact-hover windows', () => {
  const payload = fixture();
  payload.scoringPlays = [];
  payload.drives = { previous: [{ id: '1', team: { id: '21' }, plays: Array.from({ length: 310 }, (_, index) => ({
    id: String(1000 + index), sequenceNumber: index, text: `Play ${index}`, scoringPlay: index % 25 === 0,
  })) }] };
  const data = normalizeGameDetails(payload);
  assert.equal(data.playByPlay.length, 250); assert.equal(data.scoringPlays.length, 13);
  assert.equal(data.eventPlays.length, 24); assert.equal(data.recentPlays.length, 3);
  assert.equal(data.playByPlay[0].id, '1309');
  assert.ok(data.scoringPlays.some((play) => play.id === '1000'), 'The scoring history is not truncated with ordinary recent plays.');
});

test('play-only fallback retains rich cumulative sections with their age and merges history, never an old current position', () => {
  const previous = normalizeGameDetails(fixture(), { fetchedAt });
  previous.drives[0].isActive = true;
  previous.situation = { possessionTeamId: '21', fieldPosition: 'DAL 2' };
  const next = normalizeCoreDetails(core, { key: '401873080', fetchedAt: '2026-11-27T02:00:02.000Z', previous });
  for (const key of ['teamStats', 'allTeamStats', 'quarterScores', 'playerStats', 'gameInfo', 'leaders']) assert.deepEqual(next[key], previous[key]);
  assert.equal(next.statsStale, true); assert.equal(next.statsFetchedAt, fetchedAt);
  assert.ok(next.playByPlay.length >= previous.playByPlay.length - 5, 'Core may replace action records but cannot erase the retained history.');
  assert.ok(next.scoringPlays.length >= 13);
  assert.equal(next.situation, null); assert.equal(next.drive, null);
  assert.ok(next.drives.every((drive) => !drive.isActive));
  const wrong = normalizeCoreDetails(core, { key: '401873080', fetchedAt, previous: { ...previous, gameId: '999' } });
  assert.deepEqual(wrong.playerStats, []); assert.equal(wrong.gameInfo, null); assert.equal(wrong.statsFetchedAt, null);
});

test('a corrected no-play removes its old scoring entry even during a partial fallback', () => {
  const previous = normalizeGameDetails(fixture(), { fetchedAt });
  const formerScore = previous.scoringPlays[0];
  const correction = { ...formerScore, text: 'Penalty, NO PLAY', scoringPlay: false, isNoPlay: true };
  const next = { ...previous, fetchedAt: '2026-11-27T02:00:02.000Z', statsFetchedAt: null, dataScope: 'plays',
    playByPlay: [correction], eventPlays: [correction], scoringPlays: [], allTeamStats: [] };
  const retained = retainKnownStats(next, previous);
  assert.equal(retained.playByPlay.find((play) => play.id === formerScore.id).isNoPlay, true);
  assert.ok(retained.scoringPlays.every((play) => play.id !== formerScore.id));
  assert.equal(retained.statsFetchedAt, fetchedAt);
});

test('a sparse drive play retains its explicit scoring-list fact but an explicit correction can remove it', () => {
  const payload = fixture();
  const id = payload.scoringPlays[0].id;
  const source = payload.drives.previous.flatMap((drive) => drive.plays).find((play) => play.id === id);
  delete source.scoringPlay;
  assert.ok(normalizeGameDetails(payload).scoringPlays.some((play) => play.id === id));
  source.scoringPlay = false;
  assert.ok(normalizeGameDetails(payload).scoringPlays.every((play) => play.id !== id));
});
