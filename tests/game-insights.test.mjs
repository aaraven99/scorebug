import test from 'node:test';
import assert from 'node:assert/strict';
import { buildComparisonRows, getPerformanceScore, estimateWin, getGameInsights } from '../public/game-insights.js';

const game = (changes = {}) => ({
  id: '100', state: 'in', phase: 'live', period: 3, clock: '7:30',
  away: { id: '1', abbreviation: 'AWY', score: 14 }, home: { id: '2', abbreviation: 'HME', score: 14 },
  possessionTeamId: null, fieldPosition: null, ...changes,
});
const stats = (changes = {}) => ({
  gameId: '100', away: { id: '1' }, home: { id: '2' }, phase: 'live', statsStale: false,
  allTeamStats: [
    { key: 'totalYards', label: 'Total yards', away: '250', home: '200' },
    { key: 'yardsPerPlay', label: 'Yards per play', away: '6.5', home: '5.0' },
    { key: 'thirdDownEff', label: '3rd down', away: '3-6', home: '2-6' },
    { key: 'turnovers', label: 'Turnovers', away: '0', home: '1' },
    { key: 'redZoneAttempts', label: 'Red zone', away: '2-2', home: '1-2' },
    { key: 'possessionTime', label: 'Possession', away: '24:00', home: '21:00' },
  ], ...changes,
});
const flippedGame = (input) => ({ ...input, away: input.home, home: input.away });
const flippedStats = (input) => ({ ...input, away: input.home, home: input.away,
  allTeamStats: input.allTeamStats.map((row) => ({ ...row, away: row.home, home: row.away })) });

test('comparison signs are numerical truth while lower turnovers and penalties favor the smaller side', () => {
  const rows = buildComparisonRows(stats({ allTeamStats: [
    { key: 'turnovers', label: 'Turnovers', away: '2', home: '6' },
    { key: 'totalPenaltiesYards', label: 'Penalties', away: '8-86', home: '10-70' },
    { key: 'sacksYardsLost', label: 'Sacked', away: '2-18', home: '4-22' },
    { key: 'totalOffensivePlays', label: 'Offensive plays', away: '40', home: '30' },
  ] }));
  assert.equal(rows[0].comparison, '<'); assert.equal(rows[0].betterSide, 'away');
  assert.match(rows[0].note, /Fewer/);
  assert.equal(rows.find((row) => row.key === 'penalties').comparison, '<');
  assert.equal(rows.find((row) => row.key === 'penalties').betterSide, 'away');
  assert.equal(rows.find((row) => row.key === 'penaltyYards').comparison, '>');
  assert.equal(rows.find((row) => row.key === 'penaltyYards').betterSide, 'home');
  assert.equal(rows.find((row) => row.key === 'sacksAllowed').betterSide, 'away');
  assert.equal(rows.at(-1).comparison, '>'); assert.equal(rows.at(-1).betterSide, null);
});

test('conversion fractions compare by the displayed rate, missing attempts remain unknown, and zero is real data', () => {
  const rows = buildComparisonRows(stats({ allTeamStats: [
    { key: 'thirdDownEff', label: '3rd down', away: '3-10', home: '2-5' },
    { key: 'redZoneAttempts', label: 'Red zone', away: '0-0', home: '0-2' },
    { key: 'turnovers', label: 'Turnovers', away: '0', home: '0' },
    { key: 'netPassingYards', label: 'Passing', away: '-5', home: '0' },
  ] }));
  assert.equal(rows[0].away, '3/10 · 30%'); assert.equal(rows[0].home, '2/5 · 40%');
  assert.equal(rows[0].comparison, '<'); assert.equal(rows[0].betterSide, 'home');
  assert.equal(rows[1].awayValue, null); assert.equal(rows[1].homeValue, 0); assert.equal(rows[1].comparison, null);
  assert.equal(rows[2].comparison, '='); assert.equal(rows[2].betterSide, 'even');
  assert.equal(rows[3].comparison, '<'); assert.equal(rows[3].betterSide, 'home');
});

test('missing values never become zeros or contribute fake evidence', () => {
  for (const value of [null, undefined, '--', '', 'N/A', false]) {
    const rows = buildComparisonRows(stats({ allTeamStats: [{ key: 'totalYards', label: 'Yards', away: value, home: '150' }] }));
    assert.equal(rows[0].awayValue, null); assert.equal(rows[0].comparison, null);
    const score = getPerformanceScore(rows);
    assert.equal(score.available, false); assert.equal(score.away, null); assert.equal(score.coverage.used, 0);
  }
  assert.equal(getGameInsights(game(), stats({ allTeamStats: [] })).performance.available, false);
});

test('performance score and win estimate are symmetric under swapping both teams and their data', () => {
  for (const period of [1, 2, 3, 4, 5]) {
    for (const lead of [-21, -7, 0, 3, 14]) {
      const input = game({ period, clock: '4:15', away: { id: '1', abbreviation: 'AWY', score: 21 + lead }, possessionTeamId: '1', fieldPosition: 'HME 20' });
      const detail = stats();
      const before = getGameInsights(input, detail), after = getGameInsights(flippedGame(input), flippedStats(detail));
      assert.equal(before.performance.away, after.performance.home);
      assert.equal(before.performance.home, after.performance.away);
      assert.equal(before.prediction.away, after.prediction.home);
      assert.equal(before.prediction.home, after.prediction.away);
    }
  }
});

test('score and time drive the estimate; same stat score is not used as the winning chance', () => {
  const tied = getGameInsights(game({ possessionTeamId: null }), stats());
  assert.ok(tied.performance.away > 60);
  assert.ok(tied.prediction.away < tied.performance.away);
  const leading = (period, clock, score) => estimateWin(game({ period, clock, away: { id: '1', abbreviation: 'AWY', score } }), null);
  const early = leading(1, '10:00', 21), late = leading(4, '2:00', 21), larger = leading(4, '2:00', 28);
  assert.ok(late.away > early.away); assert.ok(larger.away >= late.away);
  assert.ok(late.away > 50 && late.away < 100);
  assert.equal(late.calibrated, false); assert.match(late.method, /uncalibrated/);
});

test('only current possession and field position can affect the estimate', () => {
  const neutral = estimateWin(game(), null);
  const ownTerritory = estimateWin(game({ possessionTeamId: '1', fieldPosition: 'AWY 20' }), null);
  const redZone = estimateWin(game({ possessionTeamId: '1', fieldPosition: 'HME 5' }), null);
  assert.ok(ownTerritory.away > neutral.away); assert.ok(redZone.away > ownTerritory.away);
  const historical = stats({ situation: null, lastPlay: { end: { teamId: '1', fieldPosition: 'HME 1', yardsToEndzone: 1 } } });
  assert.equal(estimateWin(game(), historical).away, neutral.away);
  const staleSituation = stats({ statsStale: true, situation: { possessionTeamId: '1', fieldPosition: 'HME 1', yardsToEndzone: 1 } });
  assert.equal(estimateWin(game(), staleSituation).away, neutral.away);
});

test('stale scores suspend the estimate and retained stale stats are labeled and excluded from fresh-score estimates', () => {
  const blocked = getGameInsights(game(), stats(), { stale: true });
  assert.equal(blocked.prediction.available, false); assert.equal(blocked.prediction.stale, true);
  assert.equal(blocked.performance.stale, true);
  const partial = getGameInsights(game(), stats({ statsStale: true, dataScope: 'plays' }));
  assert.equal(partial.performance.available, true); assert.equal(partial.performance.stale, true);
  assert.equal(partial.prediction.available, true); assert.equal(partial.prediction.away, 50);
  assert.ok(partial.prediction.drivers.every((driver) => driver.key !== 'teamStats'));
});

test('pregame, missing clocks, halftime, tied regulation and overtime have honest states', () => {
  assert.equal(getGameInsights(game({ phase: 'scheduled', state: 'pre', clock: null, period: null }), stats()).prediction.available, false);
  assert.equal(estimateWin(game({ clock: null }), null).available, false);
  const halftime = estimateWin(game({ phase: 'halftime', period: 2, clock: null, possessionTeamId: '1' }), null);
  assert.equal(halftime.available, true); assert.equal(halftime.away, 50);
  assert.ok(halftime.drivers.every((driver) => driver.key !== 'possession'));
  assert.equal(estimateWin(game({ period: 4, clock: '0:00' }), null).available, false);
  const overtime = estimateWin(game({ period: 5, clock: null, away: { id: '1', score: 20 } }), null);
  assert.equal(overtime.available, true); assert.ok(overtime.away <= 95); assert.match(overtime.reason, /Overtime/);
});

test('final scores are results, a final tie is not presented as a fifty-fifty prediction, and missing final scores are unknown', () => {
  const final = getGameInsights(game({ state: 'post', phase: 'final', clock: null, away: { id: '1', score: 21 } }), stats()).prediction;
  assert.equal(final.kind, 'result'); assert.equal(final.away, 100); assert.equal(final.home, 0);
  assert.equal(final.label, 'Final result');
  const tie = estimateWin(game({ state: 'post', phase: 'final' }), null);
  assert.equal(tie.tie, true); assert.equal(tie.kind, 'result'); assert.equal(tie.away, null); assert.equal(tie.home, null);
  assert.equal(estimateWin(game({ state: 'post', phase: 'final', away: { id: '1', score: null } }), null).available, false);
});

test('a summary for another game or reversed matchup cannot leak its stats into this game', () => {
  for (const summary of [stats({ gameId: '999' }), flippedStats(stats())]) {
    const result = getGameInsights(game(), summary);
    assert.deepEqual(result.rows, []); assert.equal(result.performance.available, false);
    assert.equal(result.prediction.away, 50);
  }
});

test('known ESPN detail identity survives an independent scoreboard provider without weakening matchup checks', () => {
  const independent = game({ id: 'thescore-500', detailsGameId: '100' });
  const matched = getGameInsights(independent, stats());
  assert.equal(matched.rows.length, 6); assert.equal(matched.performance.available, true);
  assert.ok(matched.prediction.drivers.some((driver) => driver.key === 'teamStats'));
  for (const input of [
    { ...independent, detailsGameId: null },
    { ...independent, detailsGameId: '999' },
    { ...independent, away: independent.home, home: independent.away },
  ]) {
    const rejected = getGameInsights(input, stats());
    assert.deepEqual(rejected.rows, []); assert.equal(rejected.performance.available, false);
    assert.equal(rejected.prediction.drivers.some((driver) => driver.key === 'teamStats'), false);
  }
});
