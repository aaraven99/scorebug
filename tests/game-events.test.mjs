import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameEventTracker } from '../public/game-events.js';
import { normalizePlay } from '../lib/nfl.mjs';

const NOW = Date.parse('2026-11-26T20:00:00Z');
const teams = [{ id: '3', abbreviation: 'CHI' }, { id: '8', abbreviation: 'DET' }];
function play(id, changes = {}) {
  return {
    id: String(id), sequenceNumber: Number(id), text: 'A reported rush.', type: 'Rush', typeId: '5',
    period: 3, clock: '10:00', teamId: '3', offenseTeamId: '3', defenseTeamId: '8',
    scoringTeamId: null, scoringPlay: false, scoringType: null, scoreValue: 0,
    scores: { away: 0, home: 0 }, pointAfterAttempt: null,
    isTurnover: false, isNoPlay: false, yardsGained: 4,
    wallclock: new Date(NOW).toISOString(), start: { teamId: '3' }, end: { teamId: '3' },
    ...changes,
  };
}
function touchdown(id, total = 6, attempt = null) {
  return play(id, { type: 'Rushing Touchdown', typeId: '68', text: 'A rushing touchdown.', scoringPlay: true,
    scoringType: 'touchdown', scoringTeamId: '3', scoreValue: null, scores: { away: total, home: 0 },
    pointAfterAttempt: attempt });
}
const goodPat = { typeId: '61', type: 'Extra Point Good', points: 1 };
function game(away = 0, home = 0, changes = {}) {
  return { id: '401873081', phase: 'live', period: 3, clock: '10:00',
    away: { ...teams[0], score: away }, home: { ...teams[1], score: home },
    lastPlayDetails: null, ...changes };
}
const details = (...plays) => ({ gameId: '401873081', eventPlays: plays });
function harness(options) {
  const tracker = createGameEventTracker(options);
  return { tracker, send: (gameValue, detailsValue = details(play(100)), elapsed = 0, extras = {}) => tracker.update({ game: gameValue, details: detailsValue, now: NOW + elapsed, contextKey: '20261126', ...extras }) };
}

test('initial hydration, duplicate polls, game changes, and date changes seed without replaying history', () => {
  const { send } = harness();
  const scored = touchdown(200, 7, goodPat);
  assert.deepEqual(send(game(7), details(scored)), []);
  assert.deepEqual(send(game(7), details(scored), 10000), []);
  assert.deepEqual(send(game(14), details(touchdown(300, 14, goodPat)), 20000, { contextKey: 'another-date' }), []);
  assert.deepEqual(send(game(21, 0, { id: '401873080' }), { gameId: '401873080', eventPlays: [touchdown(400, 21, goodPat)] }, 30000), []);
});

test('touchdown and later successful PAT on the same ESPN play ID are separate, deduplicated events', () => {
  const { send } = harness();
  send(game());
  assert.deepEqual(send(game(6), details(touchdown(200)), 1000).map((event) => [event.kind, event.points]), [['touchdown', 6]]);
  const pat = send(game(7), details(touchdown(200, 7, goodPat)), 10000);
  assert.deepEqual(pat.map((event) => [event.kind, event.points]), [['extra-point', 1]]);
  assert.equal(pat[0].playId, '200');
  assert.equal(pat[0].teamId, '3');
  assert.equal(pat[0].yardsGained, null);
  assert.deepEqual(send(game(7), details(touchdown(200, 7, goodPat)), 20000), []);
});

test('one poll can reconcile a combined TD and PAT or TD and two-point conversion without guessing from +7/+8', () => {
  for (const [attempt, total, expected] of [[goodPat, 7, 'extra-point'], [{ typeId: '16', type: 'Two Point Rush', points: 2 }, 8, 'two-point']]) {
    const { send } = harness(); send(game());
    const events = send(game(total), details(touchdown(200, total, attempt)), 1000);
    assert.deepEqual(events.map((event) => [event.kind, event.points]), [['touchdown', 6], [expected, total - 6]]);
  }
  const { send } = harness(); send(game());
  assert.deepEqual(send(game(6), details(touchdown(200, 6, { typeId: '62', type: 'Extra Point Missed', points: 0 })), 1000).map((event) => event.kind), ['touchdown']);
});

test('separate PAT play IDs and two-point play IDs are handled as explicit successful scoring plays', () => {
  for (const [type, typeId, scoreValue, total, kind] of [['Extra Point Good', '61', 1, 7, 'extra-point'], ['Two Point Pass', '17', 2, 8, 'two-point']]) {
    const { send } = harness(); send(game(6), details(touchdown(200)));
    const attempt = play(210, { type, typeId, scoreValue, scoringPlay: true, scoringTeamId: '3', scores: { away: total, home: 0 } });
    assert.deepEqual(send(game(total), details(attempt, touchdown(200)), 1000).map((event) => [event.kind, event.points]), [[kind, scoreValue]]);
  }
});

test('scoreboard-first TD+PAT waits for summary evidence and cannot consume the PAT point as touchdown points', () => {
  const { send } = harness(); send(game());
  const sparse = touchdown(200, 7);
  sparse.scores = { away: null, home: null };
  assert.deepEqual(send(game(7, 0, { lastPlayDetails: sparse }), null, 1000), []);
  const events = send(game(7, 0, { lastPlayDetails: sparse }), details(touchdown(200, 7, goodPat)), 5000);
  assert.deepEqual(events.map((event) => event.kind), ['touchdown', 'extra-point']);
  assert.deepEqual(send(game(7), details(touchdown(200, 7, goodPat)), 20000), []);
});

test('summary-first scoring evidence waits for the primary scoreboard before emitting each component', () => {
  const { send } = harness(); send(game());
  const summary = details(touchdown(200, 7, goodPat));
  assert.deepEqual(send(game(), summary, 1000), []);
  assert.deepEqual(send(game(6), summary, 2000).map((event) => event.kind), ['touchdown']);
  assert.deepEqual(send(game(7), summary, 3000).map((event) => event.kind), ['extra-point']);
});

test('an ambiguous increase becomes a generic score update after reconciliation, with no later duplicate touchdown', () => {
  const { send } = harness(); send(game());
  assert.deepEqual(send(game(6), null, 1000), []);
  assert.deepEqual(send(game(6), null, 12000), []);
  assert.deepEqual(send(game(6), null, 13000).map((event) => [event.kind, event.points]), [['score', 6]]);
  assert.deepEqual(send(game(6), details(touchdown(200)), 14000), []);
  assert.deepEqual(send(game(7), details(touchdown(200, 7, goodPat)), 15000).map((event) => event.kind), ['extra-point']);
});

test('explicit field goals, safeties, and otherwise unknown real scoring types use confirmed point ranges', () => {
  for (const [type, typeId, scoringType, points, kind] of [['Field Goal Good', '59', 'field-goal', 3, 'field-goal'], ['Safety', '20', 'safety', 2, 'safety'], ['New scoring type', '999', null, 1, 'score']]) {
    const { send } = harness(); send(game());
    const scored = play(200, { type, typeId, scoringType, scoringPlay: true, scoringTeamId: '8', scoreValue: points,
      scores: { away: 0, home: points }, isTurnover: false, text: type === 'Safety' ? 'FUMBLES. Penalty in the end zone, SAFETY.' : type });
    const events = send(game(0, points), details(scored), 1000);
    assert.deepEqual(events.map((event) => [event.kind, event.teamId, event.points]), [[kind, '8', points]]);
  }
});

test('ordinary fumbles, unconfirmed interception text, punts, and possession changes do not become turnovers', () => {
  const { send } = harness(); send(game());
  const examples = [
    play(200, { typeId: '9', type: 'Fumble Recovery (Own)', text: 'FUMBLES and recovers.', isTurnover: false }),
    play(300, { typeId: '26', type: 'Pass Interception Return', text: 'INTERCEPTED, ruling being corrected.', isTurnover: null, end: { teamId: '8' } }),
    play(400, { typeId: '52', type: 'Punt', isTurnover: false, end: { teamId: '8' }, yardsGained: 50 }),
  ];
  for (const [index, candidate] of examples.entries()) assert.deepEqual(send(game(0, 0, { possessionTeamId: '8' }), details(candidate), (index + 1) * 1000), []);
});

test('confirmed opponent fumble recoveries and interceptions identify the gaining team and emit once', () => {
  for (const [typeId, type, expected] of [['29', 'Fumble Recovery (Opponent)', 'fumble'], ['26', 'Pass Interception Return', 'interception']]) {
    const { send } = harness(); send(game());
    const turnover = play(200, { typeId, type, text: 'The defense recovers possession.', isTurnover: true, end: { teamId: '8' }, yardsGained: 30 });
    const events = send(game(), details(turnover), 1000);
    assert.deepEqual(events.map((event) => [event.kind, event.teamId]), [[expected, '8']]);
    assert.deepEqual(send(game(), details(turnover), 2000), []);
  }
});

test('big plays require trusted net yardage: rush >=20, reception >=25, with no text or kick-distance inference', () => {
  const { send } = harness(); send(game());
  const samples = [
    ['5', 'Rush', 19, false], ['5', 'Rush', 20, true], ['24', 'Pass Reception', 24, false], ['24', 'Pass Reception', 25, true],
    ['53', 'Kickoff', 65, false], ['52', 'Punt', 60, false], ['24', 'Pass Reception', null, false], ['3', 'Pass Incompletion', 30, false],
  ];
  for (const [index, [typeId, type, yardsGained, expected]] of samples.entries()) {
    const candidate = play(200 + index, { typeId, type, yardsGained, text: 'Pass for 99 yards, according to free text.' });
    const events = send(game(), details(candidate), (index + 1) * 1000);
    assert.deepEqual(events.map((event) => event.kind), expected ? ['big-play'] : []);
    if (expected) assert.equal(events[0].yardsGained, yardsGained);
  }
});

test('nullified plays, missing stable IDs, missing teams, and stale wallclock records do not animate', () => {
  const { send } = harness(); send(game());
  const samples = [
    play(200, { yardsGained: 30, isNoPlay: true }),
    play(300, { yardsGained: 30, text: 'A 30-yard rush. NO PLAY.' }),
    play(null, { id: null, yardsGained: 30 }),
    play(400, { yardsGained: 30, teamId: null, offenseTeamId: null }),
    play(500, { yardsGained: 30, wallclock: new Date(NOW - 120000).toISOString() }),
  ];
  for (const [index, candidate] of samples.entries()) assert.deepEqual(send(game(), details(candidate), (index + 1) * 1000), []);
});

test('score decreases and rebound corrections stay silent, but a later independently confirmed field goal can emit', () => {
  const { send } = harness();
  send(game(7), details(touchdown(200, 7, goodPat)));
  assert.deepEqual(send(game(6), details(touchdown(200, 6)), 1000), []);
  assert.deepEqual(send(game(7), details(touchdown(200, 7, goodPat)), 2000), []);
  assert.deepEqual(send(game(7), details(touchdown(200, 7, goodPat)), 15000), []);
  const fieldGoal = play(300, { typeId: '59', type: 'Field Goal Good', scoringType: 'field-goal', scoringPlay: true, scoringTeamId: '3', scores: { away: 10, home: 0 } });
  assert.deepEqual(send(game(10), details(fieldGoal), 20000).map((event) => event.kind), ['field-goal']);
});

test('a rebound correction cannot revive newly arriving old PAT metadata', () => {
  const { send } = harness();
  send(game(7), details(play(500)));
  assert.deepEqual(send(game(6), details(play(500)), 1000), []);
  assert.deepEqual(send(game(7), details(play(500), touchdown(200, 7, goodPat)), 2000), []);
  assert.deepEqual(send(game(7), details(play(500), touchdown(200, 7, goodPat)), 15000), []);
});

test('missing score data creates no false delta on recovery, and wrong-game summaries are ignored', () => {
  const { send } = harness(); send(game());
  assert.deepEqual(send(game(null), null, 1000), []);
  assert.deepEqual(send(game(7), null, 2000), []);
  assert.deepEqual(send(game(7), { gameId: 'another', eventPlays: [touchdown(200, 7, goodPat)] }, 15000), []);
});

test('resume gap, explicit reset, and silent hydration discard backlog', () => {
  const { send, tracker } = harness(); send(game());
  assert.deepEqual(send(game(7), details(touchdown(200, 7, goodPat)), 46000), []);
  tracker.reset();
  assert.deepEqual(send(game(14), details(touchdown(300, 14, goodPat)), 47000), []);
  assert.deepEqual(send(game(21), details(touchdown(400, 21, goodPat)), 48000, { silent: true }), []);
  assert.deepEqual(send(game(21), details(touchdown(400, 21, goodPat)), 49000), []);
});

test('first-open final games stay silent while an observed final transition reconciles the last score', () => {
  const first = harness();
  assert.deepEqual(first.send(game(7, 0, { phase: 'final' }), details(touchdown(200, 7, goodPat))), []);
  assert.deepEqual(first.send(game(14, 0, { phase: 'final' }), details(touchdown(300, 14, goodPat)), 1000), []);
  const second = harness(); second.send(game(6), details(touchdown(200)));
  assert.deepEqual(second.send(game(7, 0, { phase: 'final' }), details(touchdown(200, 7, goodPat)), 1000).map((event) => event.kind), ['extra-point']);
  assert.deepEqual(second.send(game(14, 0, { phase: 'final' }), details(touchdown(300, 14, goodPat)), 32000), []);
});

test('event output and retained evidence stay bounded, and discarded excess never replays', () => {
  const { send } = harness({ maxEvents: 2 }); send(game());
  const batch = Array.from({ length: 24 }, (_, index) => play(200 + index, { yardsGained: 25 }));
  assert.equal(send(game(), details(...batch), 1000).length, 2);
  assert.deepEqual(send(game(), details(...batch), 2000), []);
  for (let index = 0; index < 300; index++) send(game(), details(play(500 + index)), 3000 + index);
  assert.deepEqual(send(game(), details(...batch), 4000), []);
});

test('actual ESPN field shapes preserve combined conversions and confirmed turnover semantics end to end', () => {
  // Field names/types verified against ESPN's public summary for event401873081.
  const raw = {
    id: '4018730813906', sequenceNumber: '390600', type: { id: '67', text: 'Passing Touchdown' },
    text: 'Pass for 41 yards, TOUCHDOWN. TWO-POINT CONVERSION ATTEMPT. ATTEMPT SUCCEEDS.',
    awayScore: 32, homeScore: 35, scoringPlay: true, scoringType: { name: 'touchdown' },
    pointAfterAttempt: { id: 16, text: 'Two Point Rush', value: 2 }, isTurnover: false, statYardage: 41,
    period: { number: 4 }, clock: { displayValue: '7:20' },
    teamParticipants: [{ id: '3', type: 'offense' }, { id: '8', type: 'defense' }],
    start: { team: { id: '3' } }, end: { team: { id: '3' } },
  };
  const normalized = normalizePlay(raw, teams, { scoringTeamId: '3' });
  const { send } = harness(); send(game(24, 35));
  const events = send(game(32, 35), details(normalized), 1000);
  assert.deepEqual(events.map((event) => [event.kind, event.points]), [['touchdown', 6], ['two-point', 2]]);
});
