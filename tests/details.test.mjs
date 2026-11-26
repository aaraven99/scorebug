import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGameDetails, createGameDetailsService, validateGameId, GameDetailsError } from '../lib/details.mjs';
import gameHandler from '../api/game.js';

function fixture() {
  return {
    header: { id: '12345', competitions: [{
      date: '2026-11-26T18:00Z',
      status: { period: 2, displayClock: '6:45', type: { state: 'in', name: 'STATUS_IN_PROGRESS' } },
      // ESPN's ordering is often home first; details must preserve away/home.
      competitors: [
        { id: '8', homeAway: 'home', score: '7', team: { id: '8', abbreviation: 'DET', displayName: 'Detroit Lions' } },
        { id: '3', homeAway: 'away', score: '0', team: { id: '3', abbreviation: 'CHI', displayName: 'Chicago Bears' } },
      ],
    }] },
    boxscore: { teams: [
      { team: { id: '8' }, statistics: [
        { name: 'totalYards', displayValue: '125' }, { name: 'netPassingYards', displayValue: '85' },
        { name: 'rushingYards', displayValue: '40' }, { name: 'thirdDownEff', displayValue: '2-4', value: .5 },
        { name: 'turnovers', displayValue: '0' }, { name: 'possessionTime', displayValue: '9:30', value: 570 },
      ] },
      { team: { id: '3' }, statistics: [
        { name: 'totalYards', displayValue: '0', value: 0 }, { name: 'netPassingYards', value: -5 },
        { name: 'rushingYards', displayValue: '5' }, { name: 'thirdDownEff', displayValue: '0-1', value: 0 },
        { name: 'turnovers', displayValue: '1' }, { name: 'possessionTime', displayValue: '5:30', value: 330 },
      ] },
    ] },
    leaders: [{ team: { id: '3' }, leaders: [{ name: 'passingYards', leaders: [{ athlete: { displayName: 'Caleb Williams' }, displayValue: '0/1, 0 YDS' }] }] }],
    drives: {
      previous: [{ team: { id: '8' }, plays: [{ id: '123451', sequenceNumber: '100', text: 'A previous play.', period: { number: 1 }, clock: { displayValue: '1:00' } }] }],
      current: { team: { id: '3' }, offensivePlays: 2, yards: -5, timeElapsed: { displayValue: '0:34' }, description: '2 plays, -5 yards, 0:34', plays: [
        { id: '123453', sequenceNumber: '300', text: 'Sacked for a loss of 5 yards.', type: { text: 'Sack' }, period: { number: 2 }, clock: { displayValue: '6:45' }, statYardage: -5, scoringPlay: false, wallclock: '2026-11-26T18:50:01Z', start: { team: { id: '3' }, down: 2, distance: 10, possessionText: 'CHI 25', yardsToEndzone: 75 }, end: { team: { id: '3' }, down: 3, distance: 15, possessionText: 'CHI 20', yardsToEndzone: 80 } },
        { id: '123452', sequenceNumber: '200', text: 'Incomplete pass.', period: { number: 2 }, clock: { displayValue: '7:19' }, statYardage: 0 },
      ] },
    },
    meta: { lastUpdatedAt: '2026-11-26T18:50:03Z' },
  };
}

const jsonResponse = (body, options = {}) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' }, ...options });

test('team stats map by team ID and preserve zero, negative net yards, conversion text, and possession units', () => {
  const result = normalizeGameDetails(fixture(), { gameId: '12345', fetchedAt: '2026-11-26T18:51:00Z' });
  assert.equal(result.away.abbreviation, 'CHI');
  assert.equal(result.home.abbreviation, 'DET');
  assert.deepEqual(result.teamStats[0], { key: 'totalYards', label: 'Total yards', away: '0', home: '125' });
  assert.equal(result.teamStats.find((row) => row.key === 'netPassingYards').away, '-5');
  assert.equal(result.teamStats.find((row) => row.key === 'thirdDownEff').away, '0-1');
  assert.equal(result.teamStats.find((row) => row.key === 'possessionTime').home, '9:30');
  assert.equal(result.sourceUpdatedAt, '2026-11-26T18:50:03.000Z');
  assert.equal(result.fetchedAt, '2026-11-26T18:51:00Z');
});

test('missing summary stats stay unknown instead of becoming zeros, fractional third downs, or possession seconds', () => {
  const payload = fixture();
  payload.boxscore.teams[1].statistics = [{ name: 'thirdDownEff', value: .5 }, { name: 'possessionTime', value: 330 }, { name: 'turnovers', displayValue: '--' }];
  const result = normalizeGameDetails(payload);
  assert.equal(result.teamStats.every((row) => row.away === null), true);
  delete payload.boxscore;
  assert.equal(normalizeGameDetails(payload).teamStats.every((row) => row.away === null && row.home === null), true);
});

test('latest play follows sequence and historical end position is never promoted to current situation', () => {
  const result = normalizeGameDetails(fixture());
  assert.equal(result.lastPlay.id, '123453');
  assert.equal(result.lastPlay.yardsGained, -5);
  assert.equal(result.lastPlay.end.fieldPosition, 'CHI 20');
  assert.equal(result.lastPlay.end.yardsToEndzone, 80);
  assert.equal(result.situation, null);
  assert.deepEqual(result.recentPlays.map((play) => play.id), ['123453', '123452', '123451']);
});

test('duplicated current/previous drives are deduplicated and absent play data remains absent', () => {
  const payload = fixture();
  payload.drives.previous.push(payload.drives.current);
  assert.equal(normalizeGameDetails(payload).recentPlays.length, 3);
  delete payload.drives;
  const result = normalizeGameDetails(payload);
  assert.equal(result.lastPlay, null);
  assert.equal(result.drive, null);
  assert.deepEqual(result.recentPlays, []);
});

test('ESPN scoring records identify the scoring team and retain same-ID TD/conversion components', () => {
  const payload = fixture();
  const td = {
    id: '123454', sequenceNumber: '400', type: { id: '67', text: 'Passing Touchdown' },
    text: 'Pass for 41 yards, TOUCHDOWN. TWO-POINT CONVERSION ATTEMPT. ATTEMPT SUCCEEDS.',
    awayScore: 8, homeScore: 7, scoringPlay: true, scoringType: { name: 'touchdown' },
    pointAfterAttempt: { id: 16, text: 'Two Point Rush', value: 2 }, isTurnover: false, statYardage: 41,
    teamParticipants: [{ id: '3', type: 'offense' }, { id: '8', type: 'defense' }],
    start: { team: { id: '3' } }, end: { team: { id: '3' } },
  };
  payload.drives.current.plays.push(td);
  payload.scoringPlays = [{ id: '123454', text: 'Scoring summary.', type: td.type, team: { id: '3' }, awayScore: 8, homeScore: 7, scoringType: td.scoringType }];
  const result = normalizeGameDetails(payload);
  assert.equal(result.lastPlay.id, '123454');
  assert.equal(result.lastPlay.text, td.text);
  assert.equal(result.lastPlay.sequenceNumber, 400);
  assert.equal(result.lastPlay.typeId, '67');
  assert.equal(result.lastPlay.scoringTeamId, '3');
  assert.deepEqual(result.lastPlay.scores, { away: 8, home: 7 });
  assert.deepEqual(result.lastPlay.pointAfterAttempt, { typeId: '16', type: 'Two Point Rush', points: 2 });
  assert.equal(result.eventPlays.filter((entry) => entry.id === '123454').length, 1);
});

test('turnover flags and defensive scoring attribution survive without inferring every fumble is lost', () => {
  const payload = fixture();
  payload.drives.current.plays = [
    { id: '123454', sequenceNumber: '400', text: 'FUMBLES, and recovers.', type: { id: '9', text: 'Fumble Recovery (Own)' }, isTurnover: false, start: { team: { id: '3' } }, end: { team: { id: '3' } } },
    { id: '123455', sequenceNumber: '500', text: 'FUMBLES, RECOVERED by the defense.', type: { id: '29', text: 'Fumble Recovery (Opponent)' }, isTurnover: true, start: { team: { id: '3' } }, end: { team: { id: '8' } } },
    { id: '123456', sequenceNumber: '600', text: 'FUMBLES. PENALTY in the End Zone, SAFETY.', type: { id: '20', text: 'Safety' }, scoringPlay: true, scoringType: { name: 'safety' }, isTurnover: false, awayScore: 0, homeScore: 9, start: { team: { id: '3' } }, end: { team: { id: '8' } } },
  ];
  payload.scoringPlays = [{ id: '123456', text: 'Safety.', team: { id: '8' }, scoringType: { name: 'safety' } }];
  const plays = normalizeGameDetails(payload).eventPlays;
  assert.equal(plays.find((entry) => entry.id === '123454').isTurnover, false);
  assert.equal(plays.find((entry) => entry.id === '123455').isTurnover, true);
  const safety = plays.find((entry) => entry.id === '123456');
  assert.equal(safety.isTurnover, false);
  assert.equal(safety.offenseTeamId, '3');
  assert.equal(safety.scoringTeamId, '8');
});

test('animation evidence keeps at most 24 recent plays while hover keeps three, including mixed scoring-list sources', () => {
  const payload = fixture();
  payload.drives.current.plays = Array.from({ length: 30 }, (_, index) => ({ id: String(123500 + index), sequenceNumber: String(index * 100), text: `Play ${index}.` }));
  // This old scoring record has no corresponding drive or sequence. Its full
  // numeric event ID must not sort ahead of newer drive sequence numbers.
  payload.scoringPlays = [{ id: '123400', text: 'An older field goal.', type: { id: '59', text: 'Field Goal Good' }, team: { id: '3' } }];
  const result = normalizeGameDetails(payload);
  assert.equal(result.eventPlays.length, 24);
  assert.equal(result.recentPlays.length, 3);
  assert.deepEqual(result.recentPlays.map((entry) => entry.id), ['123529', '123528', '123527']);
  assert.equal(result.eventPlays.some((entry) => entry.id === '123400'), false);
});

test('actual current situation is included only during live play, not halftime or a completed drive', () => {
  const payload = fixture();
  payload.header.competitions[0].situation = { possession: '3', down: 3, distance: 15, possessionText: 'CHI 20', yardsToEndzone: 80 };
  const result = normalizeGameDetails(payload);
  assert.equal(result.situation.possessionTeamId, '3');
  assert.equal(result.situation.down, 3);
  payload.header.competitions[0].status.type.name = 'STATUS_HALFTIME';
  assert.equal(normalizeGameDetails(payload).situation, null);
  assert.equal(normalizeGameDetails(payload).drive.isActive, false);
});

test('player leaders retain names and published display values without fabricated missing leaders', () => {
  const result = normalizeGameDetails(fixture());
  assert.deepEqual(result.leaders[0].away, { name: 'Caleb Williams', displayValue: '0/1, 0 YDS' });
  assert.equal(result.leaders[0].home, null);
  assert.equal(result.leaders[1].away, null);
});

test('invalid or mismatched event payloads fail rather than showing a different game', () => {
  for (const id of [undefined, null, '1&event=2', 'abc', '', '12345678901234567', 12345]) assert.throws(() => validateGameId(id), { code: 'INVALID_GAME_ID' });
  assert.equal(validateGameId('12345'), '12345');
  assert.throws(() => normalizeGameDetails(fixture(), { gameId: '99999' }), { code: 'INVALID_DETAILS' });
  assert.throws(() => normalizeGameDetails({}), GameDetailsError);
});

test('concurrent details readers share a short cache, and expired failure never returns old stats as fresh', async () => {
  let calls = 0;
  let time = Date.parse('2026-11-26T18:51:00Z');
  let fail = false;
  const service = createGameDetailsService({ now: () => time, fetchImpl: async () => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 2));
    if (fail) return jsonResponse({}, { status: 503 });
    return jsonResponse(fixture());
  } });
  const results = await Promise.all([service({ gameId: '12345' }), service({ gameId: '12345' })]);
  assert.equal(calls, 1);
  assert.equal(results[0], results[1]);
  await service({ gameId: '12345' });
  assert.equal(calls, 1);
  time += 10001;
  fail = true;
  await assert.rejects(() => service({ gameId: '12345' }), { statusCode: 503 });
  assert.equal(calls, 2);
});

test('service rejects unsafe IDs before fetch, routes the fixed summary URL, and fails safely on bad upstream responses', async () => {
  let seen;
  const service = createGameDetailsService({ fetchImpl: async (url) => { seen = url; return jsonResponse(fixture()); } });
  await assert.rejects(() => service({ gameId: '../foo' }), { statusCode: 400 });
  assert.equal(seen, undefined);
  await service({ gameId: '12345' });
  assert.equal(seen, 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=12345');
  for (const response of [new Response('<html>error</html>'), new Response('{broken', { headers: { 'Content-Type': 'application/json' } }), new Response('{}', { headers: { 'Content-Type': 'application/json', 'Content-Length': String(5 * 1024 * 1024) } })]) {
    const failing = createGameDetailsService({ fetchImpl: async () => response });
    await assert.rejects(() => failing({ gameId: '12345' }), { code: 'INVALID_DETAILS' });
  }
});

test('API rejects missing, duplicate and malformed IDs, rejects writes, and HEAD errors have no body', async () => {
  function response() { return { headers: {}, statusCode: 200, body: null, setHeader(key, value) { this.headers[key] = value; }, end(body) { this.body = body; } }; }
  for (const url of ['/api/game', '/api/game?id=123&id=456', '/api/game?id=abc']) {
    const res = response(); await gameHandler({ method: 'GET', url }, res);
    assert.equal(res.statusCode, 400); assert.equal(res.headers['Cache-Control'], 'no-store');
  }
  const write = response(); await gameHandler({ method: 'POST', url: '/api/game?id=12345' }, write);
  assert.equal(write.statusCode, 405);
  const head = response(); await gameHandler({ method: 'HEAD', url: '/api/game' }, head);
  assert.equal(head.statusCode, 400); assert.equal(head.body, undefined);
});
