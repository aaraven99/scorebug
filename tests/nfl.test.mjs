import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createScoreboardService, downDistance, normalizeGame, normalizePlay, normalizePlayer, normalizeScoreboard, ScoreboardError, validateDate } from '../lib/nfl.mjs';

const liveFixture = JSON.parse(readFileSync(new URL('./fixtures/espn-live-v121.json', import.meta.url)));

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

test('current down accepts a valid long text or numeric pair, without borrowing an old play position', () => {
  for (const [situation, expected] of [
    [{ downDistanceText: '3rd & 7 at PHI 43' }, '3rd & 7'],
    [{ shortDownDistanceText: '', downDistanceText: '1st & Goal at DAL 6' }, '1st & Goal'],
    [{ downDistanceText: '2nd and 4 at 50' }, '2nd & 4'],
    [{ down: '4', distance: '1' }, '4th & 1'],
    [{ down: 2, distance: 0 }, '2nd & 0'],
    [{ down: -1, distance: 0, shortDownDistanceText: '1st & 10' }, null],
    [{ down: -1, shortDownDistanceText: 'KICKOFF' }, 'KICKOFF'],
    [{ downDistanceText: '5th & 9 at PHI 40' }, null],
    [{ downDistanceText: '1th & 10 at PHI 40' }, null],
    [{ downDistanceText: '3rd & 101 at PHI 40' }, null],
    [{ lastPlay: { end: { down: 2, distance: 8 } } }, null],
  ]) {
    assert.equal(downDistance(situation), expected, JSON.stringify(situation));
    assert.equal(normalizeGame(event({ situation })).downDistance, expected);
  }
});

test('actual PHI–DAL primary sample preserves reported down and attributes its reception to Smith', () => {
  const game = normalizeGame(liveFixture.scoreboardEvent);
  assert.equal(game.id, '401873080');
  assert.equal(game.phase, 'live');
  assert.equal(game.downDistance, '1st & 10');
  assert.equal(game.fieldPosition, 'PHI 39');
  assert.equal(game.lastPlayDetails.player.name, 'DeVonta Smith');
  assert.equal(game.lastPlayDetails.player.teamId, '21');
  assert.equal(game.lastPlayDetails.player.headshot, 'https://a.espncdn.com/i/headshots/nfl/players/full/4241478.png');
});

test('players keep official names with a nullable photo and reject lookalike, insecure or credentialed image URLs', () => {
  const teams = [{ id: '21', abbreviation: 'PHI' }];
  const athlete = { id: '4241478', displayName: 'DeVonta Smith', team: { abbreviation: 'PHI' }, position: { abbreviation: 'WR' } };
  const player = normalizePlayer(athlete, teams);
  assert.deepEqual(player, { id: '4241478', name: 'DeVonta Smith', headshot: null, teamId: '21', position: 'WR' });
  for (const headshot of ['http://a.espncdn.com/i/headshots/nfl/players/full/4241478.png', 'https://a.espncdn.com.evil.example/i/headshots/nfl/players/full/1.png', 'https://user:pass@a.espncdn.com/i/headshots/nfl/players/full/1.png', 'https://evil.example/player.png', 'javascript:alert(1)', 'https://a.espncdn.com/i/teamlogos/nfl/500/phi.png']) {
    assert.equal(normalizePlayer({ ...athlete, headshot }, teams).headshot, null);
  }
  assert.equal(normalizePlayer({ id: '123', headshot: 'https://a.espncdn.com/i/headshots/nfl/players/full/123.png' }, teams), null);
});

test('structured scorer and PAT roles stay separate and never select the passer on a passing touchdown', () => {
  const teams = [{ id: '6', abbreviation: 'DAL' }, { id: '21', abbreviation: 'PHI' }];
  const rawPlayers = liveFixture.summary.boxscore.players.flatMap((entry) => entry.statistics.flatMap((group) => group.athletes.map((row) => normalizePlayer(row.athlete, teams, { teamId: entry.team.id }))));
  const original = liveFixture.summary.drives.previous[0].plays.find((play) => play.id === '401873080943');
  const play = normalizePlay({ ...original, participants: liveFixture.touchdownParticipants }, teams, { players: rawPlayers, scoringTeamId: '6' });
  assert.equal(play.player.name, 'KaVontae Turpin');
  assert.equal(play.player.id, '3676833');
  assert.equal(play.conversionPlayer.name, 'Brandon Aubrey');
  assert.notEqual(play.player.id, '2577417');
});

test('confirmed turnover attribution selects the recoverer or interception returner, not the fumbler or passer', () => {
  const source = liveFixture.turnovers;
  const players = source.boxscorePlayers.flatMap((entry) => entry.statistics.flatMap((group) => group.athletes.map((row) => normalizePlayer(row.athlete, source.teams, { teamId: entry.team.id }))));
  const fumble = normalizePlay(source.plays.find((play) => play.type.id === '29'), source.teams, { players });
  const interception = normalizePlay(source.plays.find((play) => play.type.id === '26'), source.teams, { players });
  assert.equal(fumble.player.name, 'Malcolm Rodriguez');
  assert.equal(fumble.player.teamId, '8');
  assert.equal(interception.player.name, 'Dillon Thieneman');
  assert.equal(interception.player.teamId, '3');
});

test('ambiguous abbreviations and lateral plays without a named scorer remain unattributed', () => {
  const teams = [{ id: '3', abbreviation: 'CHI' }, { id: '8', abbreviation: 'DET' }];
  const players = [{ id: '1', name: 'John Smith', teamId: '3', headshot: null }, { id: '2', name: 'James Smith', teamId: '3', headshot: null }];
  const base = { id: '12345', type: { id: '24', text: 'Pass Reception' }, text: 'Q.Player pass deep left to J.Smith for 35 yards.', start: { team: { id: '3' } }, statYardage: 35 };
  assert.equal(normalizePlay(base, teams, { players }).player, null);
  const lateral = { ...base, type: { id: '67', text: 'Passing Touchdown' }, text: 'Q.Player pass to John Smith. LATERAL to another player, TOUCHDOWN.', participants: [{ type: 'receiver', athlete: { id: '1', displayName: 'John Smith', team: { id: '3' } } }] };
  assert.equal(normalizePlay(lateral, teams, { players, scoringTeamId: '3' }).player, null);
  const passerOnly = { ...base, type: { id: '67', text: 'Passing Touchdown' }, text: 'A passing touchdown.', participants: [{ type: 'passer', athlete: { id: '9', displayName: 'The Quarterback', team: { id: '3' } } }] };
  assert.equal(normalizePlay(passerOnly, teams, { scoringTeamId: '3' }).player, null);
});

test('a standalone two-point pass attributes the conversion receiver and never its passer', () => {
  const teams = [{ id: '3', abbreviation: 'CHI' }, { id: '8', abbreviation: 'DET' }];
  const play = normalizePlay({
    id: '12346', type: { id: '17', text: 'Two Point Pass' }, scoreValue: 2, scoringPlay: true,
    text: 'The two-point pass is complete.', team: { id: '3' }, start: { team: { id: '3' } },
    participants: [
      { type: 'passer', athlete: { id: '11', displayName: 'Quarterback', team: { id: '3' } } },
      { type: 'receiver', athlete: { id: '12', displayName: 'Conversion Receiver', team: { id: '3' } } },
      { type: 'patScorer', athlete: { id: '12', displayName: 'Conversion Receiver', team: { id: '3' } } },
    ],
  }, teams);
  assert.equal(play.player.id, '12');
  assert.equal(play.conversionPlayer, null);
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

test('concurrent readers share one request and warm cache expires after one second', async () => {
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
  now += 999;
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
  const successful = await get();
  fail = true;
  now += 5_001;
  const delayed = await get();
  assert.equal(delayed.stale, true);
  assert.equal(delayed.feedStatus, 'cached');
  assert.equal(delayed.fetchedAt, successful.fetchedAt);
  assert.deepEqual(delayed.games, successful.games);
  fail = false;
  now += 30_001;
  assert.equal((await get()).games.length, 1);
  assert.equal((await get()).stale, false);
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
    () => new Response('<html>upstream error</html>', { headers: { 'content-type': 'text/html' } }),
    () => new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '5000000' } }),
    () => new Response('{', { headers: { 'content-type': 'application/json' } }),
  ]) {
    const get = createScoreboardService({ fetchImpl: async () => response() });
    await assert.rejects(get(), { code: 'INVALID_UPSTREAM', statusCode: 502 });
  }
  const get = createScoreboardService({ fetchImpl: async () => { throw new TypeError('private network internals'); } });
  await assert.rejects(get(), (error) => error instanceof ScoreboardError && error.statusCode === 502 && !error.message.includes('private'));
});

test('scoreboard automatically uses the mirror, then retries the primary after its cooldown', async () => {
  let now = Date.parse('2026-11-26T19:00:00Z'), primaryFails = true;
  const calls = [];
  const get = createScoreboardService({ now: () => now, fetchImpl: async (url) => {
    calls.push(url);
    if (url.startsWith('https://site.api.') && primaryFails) return new Response('Unavailable', { status: 503 });
    return jsonResponse({ events: [event()] });
  } });
  const backup = await get();
  assert.equal(backup.sourceId, 'espn-web');
  assert.equal(backup.feedStatus, 'backup');
  assert.equal(backup.stale, false);
  now += 1001;
  await get();
  assert.equal(calls.filter((url) => url.startsWith('https://site.api.')).length, 1);
  primaryFails = false; now += 3000;
  assert.equal((await get()).sourceId, 'espn-site');
  assert.equal((await get()).feedStatus, 'primary');
});

test('the final ESPN CDN route unwraps its scoreboard after other routes fail', async () => {
  const calls = [];
  const get = createScoreboardService({ fetchImpl: async (url) => {
    calls.push(url);
    if (url.startsWith('https://cdn.espn.com/')) return jsonResponse({ content: { sbData: { events: [event()] } } });
    return new Response('Unavailable', { status: 503 });
  } });
  const result = await get();
  assert.equal(result.sourceId, 'espn-cdn');
  assert.equal(result.games[0].downDistance, '4th & 6');
  assert.equal(calls.length, 5);
  assert.ok(calls.includes('https://cdn.espn.com/core/nfl/scoreboard?xhr=1'));
});

test('the CDN scoreboard is never used for a date it cannot honor', async () => {
  const calls = [];
  const get = createScoreboardService({ fetchImpl: async (url) => { calls.push(url); return new Response('Unavailable', { status: 503 }); } });
  await assert.rejects(get({ date: '20261011' }));
  assert.equal(calls.length, 3);
  assert.equal(calls.some((url) => url.startsWith('https://cdn.espn.com/')), false);
});

test('an old HTTP 200 CDN cache response or stale warning falls through instead of masquerading as live', async () => {
  for (const headers of [{ age: '86400' }, { warning: '110 edge "Response is Stale"' }]) {
    const get = createScoreboardService({ fetchImpl: async (url) => {
      if (url.startsWith('https://site.api.')) return new Response(JSON.stringify({ events: [event()] }), { headers: { 'content-type': 'application/json', ...headers } });
      return jsonResponse({ events: [event()] });
    } });
    assert.equal((await get()).sourceId, 'espn-web');
  }
});

test('a partial response does not drop the selected live game while a backup still has it', async () => {
  let now = Date.parse('2026-11-26T19:00:00Z'), incomplete = false;
  const get = createScoreboardService({ now: () => now, fetchImpl: async (url) => jsonResponse({ events: incomplete && url.startsWith('https://site.api.') ? [] : [event()] }) });
  await get();
  incomplete = true; now += 5001;
  const data = await get();
  assert.equal(data.sourceId, 'espn-web');
  assert.equal(data.games[0].id, '401873081');
});

test('a timed-out primary uses a working backup without leaking upstream errors', async () => {
  const get = createScoreboardService({ fetchImpl: async (url) => {
    if (url.startsWith('https://site.api.')) throw new DOMException('Private upstream host', 'TimeoutError');
    return jsonResponse({ events: [event()] });
  } });
  const data = await get();
  assert.equal(data.sourceId, 'espn-web');
  assert.equal(data.stale, false);
});
