import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LEAGUES, getLeague, formatPeriod, formatSituation, mergeSportDetails } from '../public/sports.js';
import { normalizeSportScoreboard, normalizeSportGame, normalizeSportDetails, normalizeSportPlay, normalizeSportTeams, createSportsService, validateLeague, parseSportGameId, sportDate, safeImage } from '../lib/sports.mjs';
import { createOpenF1Enricher, normalizeRaceControl, currentRaceFlag, mergeOpenF1Timing } from '../lib/openf1.mjs';
const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/multisport/${name}.json`, import.meta.url)));
const clone = (value) => structuredClone(value);
const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const stamp = '2026-11-27T04:00:00Z';

test('league IDs and routes form a finite allowlist and invalid inputs never become upstream paths', () => {
  assert.equal(new Set(LEAGUES.map((l) => l.id)).size, LEAGUES.length);
  assert.ok(LEAGUES.length >= 25);
  for (const league of LEAGUES) { assert.equal(validateLeague(league.id), league); assert.match(league.espnPath, /^[a-z0-9.-]+\/[a-z0-9.-]+$/); }
  for (const input of ['../nfl', 'NBA', '', '__proto__', 'https://evil.test', ['nba']]) assert.throws(() => validateLeague(input), { statusCode: 400, code: 'INVALID_LEAGUE' });
  assert.equal(validateLeague().id, 'nfl');
  assert.equal(sportDate('2026-11-25'), '20261125');
  assert.throws(() => sportDate('2026-02-29'), { code: 'INVALID_DATE' });
  assert.throws(() => parseSportGameId('mlb:401909317', getLeague('nba')), { code: 'INVALID_GAME_ID' });
  assert.throws(() => parseSportGameId('nba:../../secret', getLeague('nba')), { code: 'INVALID_GAME_ID' });
});

test('real NBA scores, branding and IDs remain basketball-specific and cannot collide with NFL IDs', () => {
  const game = normalizeSportScoreboard(fixture('nba-scoreboard'), { leagueId: 'nba' }).games[0];
  assert.equal(game.id, 'nba:401909317'); assert.equal(game.away.id, 'nba:14');
  assert.equal(game.away.name, 'Miami Heat'); assert.equal(game.home.name, 'Philadelphia 76ers');
  assert.equal(game.away.score, 104); assert.equal(game.home.score, 111);
  assert.equal(game.away.leagueId, 'nba'); assert.equal(game.away.sport, 'basketball');
  assert.match(game.away.logo, /\/nba\//); assert.equal(game.downDistance, null);
  assert.equal(game.away.timeouts, null); assert.equal(game.situation.shotClock, null);
  assert.equal(game.clock, null);
});

test('basketball uses supplied timeouts, bonus and shot clock, without a locally invented countdown', () => {
  const source = clone(fixture('nba-scoreboard').events[0]);
  const c = source.competitions[0]; c.status = { period: 4, displayClock: '2:14', type: { state: 'in', name: 'STATUS_IN_PROGRESS' } };
  c.situation = { awayTimeouts: 0, homeTimeouts: 2, awayBonus: true, homeBonus: false, shotClock: 14, possession: '14' };
  const game = normalizeSportGame(source, 'nba');
  assert.equal(game.away.timeouts, 0); assert.equal(game.home.timeouts, 2); assert.equal(game.away.maxTimeouts, 7);
  assert.equal(game.situation.awayBonus, true); assert.equal(game.situation.homeBonus, false);
  assert.equal(game.situation.shotClock, 14); assert.equal(game.possessionTeamId, 'nba:14');
  delete c.situation.shotClock; assert.equal(normalizeSportGame(source, 'nba').situation.shotClock, null);
  for (const clock of ['0:09.6', '9.6', '0.0']) { c.status.displayClock = clock; assert.equal(normalizeSportGame(source, 'nba').clock, clock); }
  c.status.type = { state: 'post', name: 'STATUS_FINAL', completed: true }; assert.equal(normalizeSportGame(source, 'nba').clock, null);
});

test('real NBA box scores preserve all rows, three-point percentage and player totals with named scorers', () => {
  const raw = fixture('nba-summary'); const details = normalizeSportDetails(raw, { leagueId: 'nba', gameId: `nba:${raw.header.id}` });
  assert.equal(details.allTeamStats.length, 25); assert.equal(details.playerStats.length, 1);
  const threes = details.allTeamStats.find((s) => s.key === 'threePointFieldGoalPct');
  assert.equal(threes.away, '26'); assert.equal(threes.home, '40');
  assert.ok(details.playerStats[0].away.athletes.some((p) => p.player.name === 'Bam Adebayo'));
  assert.equal(details.playerStats[0].away.totals.length, details.playerStats[0].columns.length);
  const shot = details.scoringPlays.find((p) => p.scoreValue === 3);
  assert.equal(shot.eventType, 'three-pointer'); assert.equal(shot.scoringType, 'three-pointer');
  assert.ok(shot.player?.name); assert.ok(shot.player.teamId.startsWith('nba:'));
  assert.equal(details.quarterScores.length, 4);
  assert.ok(details.playByPlay.every((p) => p.type !== undefined && p.scores && 'isNoPlay' in p));
});

test('misses never become three-point celebrations and invalid player/image fields remain absent', () => {
  const game = normalizeSportScoreboard(fixture('nba-scoreboard'), { leagueId: 'nba' }).games[0];
  const play = normalizeSportPlay({ id: '123', text: 'A three-point attempt misses.', scoreValue: 0, scoringPlay: false, shootingPlay: true, pointsAttempted: 3, team: { id: '14' }, participants: [{ athlete: { id: '9', displayName: 'Player Name', headshot: 'https://evil.test/photo.png' } }] }, game);
  assert.equal(play.eventType, null); assert.equal(play.scoringPlay, false); assert.equal(play.player.headshot, null);
  assert.equal(play.scoringTeamId, null);
  assert.equal(safeImage('https://a.espncdn.com.evil.test/i/photo.png'), null);
  assert.equal(safeImage('https://user:pass@a.espncdn.com/i/photo.png'), null);
});

test('baseball preserves actual inning, count, runners and batting side without football language', () => {
  const raw = clone(fixture('mlb-scoreboard').events[0]), c = raw.competitions[0];
  c.status = { period: 7, type: { state: 'in', name: 'STATUS_BOTTOM' }, displayClock: '0:00' };
  c.situation = { balls: 0, strikes: 2, outs: 1, onFirst: true, onSecond: false, onThird: true };
  const game = normalizeSportGame(raw, 'mlb');
  assert.equal(game.clock, null); assert.equal(game.period, 7); assert.equal(game.situation.half, 'bottom');
  assert.deepEqual(game.situation.bases, [true, false, true]); assert.equal(game.situation.balls, 0);
  assert.equal(game.possessionTeamId, game.home.id); assert.equal(formatPeriod(game), 'Bot 7');
  assert.equal(formatSituation(game), '0–2 · 1 out');
  c.situation = {}; const missing = normalizeSportGame(raw, 'mlb'); assert.deepEqual(missing.situation.bases, [null, null, null]);
});

test('real baseball batting and pitching totals remain separate and all player categories survive', () => {
  const raw = fixture('mlb-summary'), d = normalizeSportDetails(raw, { leagueId: 'mlb', gameId: `mlb:${raw.header.id}` });
  assert.equal(d.allTeamStats.find((r) => r.key === 'batting.hits').away, '8');
  assert.ok(d.allTeamStats.some((r) => r.key === 'pitching.hits'));
  assert.equal(d.playerStats.length, 2); assert.equal(d.quarterScores.length, 9);
  const game = normalizeSportScoreboard(fixture('mlb-scoreboard'), { leagueId: 'mlb' }).games[0];
  const homer = normalizeSportPlay({ id: '99', text: 'Home run', type: { text: 'Home Run', type: 'home-run' }, scoringPlay: true, scoreValue: 4, team: { id: game.away.providerId } }, game);
  assert.equal(homer.eventType, 'grand-slam'); assert.equal(homer.scoringTeamId, game.away.id);
});

test('real hockey produces goals and hockey player/stat categories without NFL score labels', () => {
  const raw = fixture('nhl-summary'), d = normalizeSportDetails(raw, { leagueId: 'nhl', gameId: `nhl:${raw.header.id}` });
  assert.equal(d.allTeamStats.length, 14); assert.equal(d.playerStats.length, 4);
  assert.ok(d.scoringPlays.every((p) => p.eventType === 'goal'));
  assert.equal(formatPeriod({ sport: 'hockey', leagueId: 'nhl', period: 4, phase: 'live' }), 'OT');
});

test('tennis flattens actual tournament draws into distinct singles/doubles matches and keeps set tiebreaks', () => {
  const data = normalizeSportScoreboard(fixture('atp-scoreboard'), { leagueId: 'atp' });
  assert.equal(data.games.length, 30); assert.equal(new Set(data.games.map((g) => g.id)).size, 30);
  const doubles = data.games.find((g) => g.id === 'atp:187517');
  assert.equal(doubles.away.score, 1); assert.equal(doubles.home.score, 2);
  assert.equal(doubles.away.linescores[2].tiebreak, 4);
  assert.equal(doubles.away.isAthlete, true); assert.equal(doubles.clock, null);
  const singles = data.games.find((g) => g.id === 'atp:187505');
  assert.equal(singles.home.name, 'Alexander Zverev'); assert.equal(singles.home.score, 2);
  const noDraw = { events: [{ id: '1-2026', name: 'Next tournament', groupings: [] }] };
  assert.deepEqual(normalizeSportScoreboard(noDraw, { leagueId: 'atp' }).games, []);
});

test('volleyball displays sets won separately from points within each set', () => {
  const game = normalizeSportScoreboard(fixture('ncaavb-scoreboard'), { leagueId: 'ncaavb' }).games[0];
  assert.equal(game.home.score, 3); assert.equal(game.away.score, 0);
  assert.deepEqual(game.home.linescores.map((s) => s.value), [25, 25, 25]);
  const raw = fixture('volleyball-summary'), d = normalizeSportDetails(raw, { leagueId: 'ncaavb', gameId: `ncaavb:${raw.header.id}` });
  assert.equal(d.quarterScores[0].label, 'Set 1'); assert.equal(d.quarterScores[0].home, 25);
  assert.equal(d.teamStats.length, 0);
});

test('golf and motorsport are actual classifications, never an invented two-team matchup', () => {
  const golf = normalizeSportScoreboard(fixture('pga-scoreboard'), { leagueId: 'pga' }).games[0];
  assert.equal(golf.kind, 'leaderboard'); assert.equal(golf.away, null); assert.equal(golf.home, null);
  assert.equal(golf.entries[0].name, 'Marco Penge'); assert.equal(golf.entries[0].score, '-16');
  assert.ok(golf.entries[0].rounds[0].holes.length === 18);
  const f1 = normalizeSportScoreboard(fixture('f1-scoreboard'), { leagueId: 'f1' });
  assert.equal(f1.games.length, 5); assert.deepEqual(f1.games.map((g) => g.sessionName), ['Practice 1', 'Practice 2', 'Practice 3', 'Qualifying', 'Race']);
  assert.equal(f1.games[0].entries.length, 22); assert.ok(f1.games.every((g) => g.away === null && g.home === null));
  assert.ok(f1.games.every((g) => g.id.startsWith('f1:'))); assert.equal(f1.games[0].flag, null);
});

test('sprint qualifying and sprint sessions retain their own names, identity and classification', () => {
  const raw = clone(fixture('f1-scoreboard').events[0]);
  raw.competitions = [ { ...raw.competitions[0], id: '111', type: { abbreviation: 'SQ' } }, { ...raw.competitions[0], id: '112', type: { abbreviation: 'Sprint' } } ];
  const data = normalizeSportScoreboard({ events: [raw] }, { leagueId: 'f1' });
  assert.deepEqual(data.games.map((g) => [g.id, g.sessionType]), [['f1:111', 'sprint-qualifying'], ['f1:112', 'sprint']]);
});

test('rugby leagues have safe distinct team namespaces and keep their reported team names', () => {
  for (const leagueId of ['nrl', 'superrugby']) {
    const game = normalizeSportScoreboard(fixture(`${leagueId}-scoreboard`), { leagueId }).games[0];
    assert.equal(game.sport, 'rugby'); assert.ok(game.home.id.startsWith(`${leagueId}:`)); assert.equal(game.playClock, null);
  }
});

test('broken responses never masquerade as empty schedules or fill in unknown scores', () => {
  assert.deepEqual(normalizeSportScoreboard({ events: [] }, { leagueId: 'nba' }).games, []);
  assert.throws(() => normalizeSportScoreboard({ events: [{}] }, { leagueId: 'nba' }), { code: 'INVALID_UPSTREAM' });
  const raw = clone(fixture('nba-scoreboard').events[0]); delete raw.competitions[0].competitors[0].score;
  assert.equal(normalizeSportGame(raw, 'nba').home.score, null);
  const summary = fixture('nba-summary'); assert.throws(() => normalizeSportDetails(summary, { leagueId: 'nba', gameId: 'nba:999' }), { code: 'INVALID_DETAILS' });
});

test('team directory IDs and logos carry league metadata, including the same abbreviation in different sports', () => {
  const payload = { sports: [{ leagues: [{ teams: [{ team: { id: '4', displayName: 'Chicago Bulls', abbreviation: 'CHI', color: 'ce1141', logos: [{ href: 'https://a.espncdn.com/i/teamlogos/nba/500/chi.png' }] } }] }] }] };
  const teams = normalizeSportTeams(payload, 'nba');
  assert.equal(teams[0].id, 'nba:4'); assert.equal(teams[0].leagueId, 'nba'); assert.equal(teams[0].sport, 'basketball'); assert.match(teams[0].logo, /\/nba\//);
});

test('league-aware requests isolate their caches, support mirror failover and reject bad inputs before fetching', async () => {
  const calls = [];
  const service = createSportsService({ fetchImpl: async (url) => { calls.push(url); if (url.includes('site.api.')) return response({}, 503); return response(fixture(url.includes('/nba/') ? 'nba-scoreboard' : 'nhl-scoreboard')); } });
  const data = await service.scoreboard({ leagueId: 'nba', date: '20261125' });
  assert.equal(data.feedStatus, 'backup'); assert.equal(data.sourceId, 'espn-web'); assert.equal(data.games[0].leagueId, 'nba');
  assert.ok(calls.every((url) => url.includes('/basketball/nba/scoreboard') && url.includes('dates=20261125')));
  const previousCount = calls.length; await service.scoreboard({ leagueId: 'nba', date: '2026-11-25' }); assert.equal(calls.length, previousCount);
  await assert.rejects(service.scoreboard({ leagueId: '../secret' }), { code: 'INVALID_LEAGUE' }); assert.equal(calls.length, previousCount);
  await service.scoreboard({ leagueId: 'nhl', date: '20261125' }); assert.ok(calls.some((url) => url.includes('/hockey/nhl/')));
});

test('race details resolve the exact selected historical session across a cold service using its date', async () => {
  const calls = [], service = createSportsService({ fetchImpl: async (url) => { calls.push(url); return response(fixture('f1-scoreboard')); } });
  const details = await service.details({ leagueId: 'f1', gameId: 'f1:401839131', date: '20261108' });
  assert.equal(details.gameId, 'f1:401839131'); assert.equal(details.race.sessionType, 'qualifying'); assert.equal(details.entries.length, 22);
  assert.ok(calls[0].includes('dates=20261108')); assert.ok(!calls[0].includes('/summary'));
  await assert.rejects(service.details({ leagueId: 'f1', gameId: 'f1:999', date: '20261108' }), { code: 'GAME_NOT_FOUND' });
});

test('a failed box score still returns the correct game with missing stats explicitly marked for retention', async () => {
  const service = createSportsService({ fetchImpl: async (url) => url.includes('/summary') ? response({}, 404) : response(fixture('nba-scoreboard')) });
  const details = await service.details({ leagueId: 'nba', gameId: 'nba:401909317', date: '20261125' });
  assert.equal(details.dataScope, 'plays'); assert.equal(details.statsStale, true); assert.equal(details.statsFetchedAt, null); assert.equal(details.away.name, 'Miami Heat');
});

test('an unconfigured live OpenF1 account never triggers private timing requests or falsely claims live flags', async () => {
  let calls = 0; const enrich = createOpenF1Enricher({ env: {}, fetchImpl: async () => { calls++; throw new Error('must not fetch'); } });
  const details = { gameId: 'f1:1', teamStats: [] }, game = { id: 'f1:1', state: 'in', startTime: stamp };
  const result = await enrich(details, game);
  assert.equal(calls, 0); assert.equal(result.coverage.liveTimingConfigured, false); assert.match(result.coverage.message, /live account/);
});

test('actual OpenF1 published results map drivers, teams, gaps, tyres and results without synthetic head-to-head teams', () => {
  const game = normalizeSportScoreboard(fixture('f1-scoreboard'), { leagueId: 'f1' }).games.at(-1);
  const session = fixture('openf1-sessions').at(-1);
  const race = mergeOpenF1Timing(game, { session, drivers: fixture('openf1-drivers'), results: fixture('openf1-results'), stints: fixture('openf1-stints'), control: fixture('openf1-control'), fetchedAt: stamp });
  assert.equal(race.entries.length, 22); assert.equal(race.entries[0].position, 1); assert.equal(race.entries[0].name, 'Lando NORRIS');
  assert.equal(race.entries[0].team.name, 'McLaren'); assert.equal(race.entries[0].gap, 'Leader'); assert.equal(race.entries[0].laps, 71);
  assert.match(race.entries[0].headshot, /^https:\/\/media\.formula1\.com\//);
  assert.equal(race.raceControl.length, 212); assert.equal(race.flag, 'chequered');
  assert.equal(race.away, null); assert.ok(!('pitStops' in race.entries[0]));
});

test('race-control transitions preserve safety cars through local yellows and do not confuse pit-exit lights with track flags', () => {
  const row = (date, flag, message, scope = 'Track') => ({ session_key: 5, date, flag, message, scope, category: 'Flag' });
  const control = normalizeRaceControl([
    row('2026-11-27T00:00:00Z', null, 'SAFETY CAR DEPLOYED'),
    row('2026-11-27T00:00:01Z', 'YELLOW', 'YELLOW IN TRACK SECTOR 2', 'Sector'),
    row('2026-11-27T00:00:02Z', 'GREEN', 'GREEN LIGHT - PIT EXIT OPEN'),
  ], 5);
  assert.equal(currentRaceFlag(control), 'safety-car');
  control.push(...normalizeRaceControl([row('2026-11-27T00:00:03Z', 'RED', 'RED FLAG')], 5));
  assert.equal(currentRaceFlag(control), 'red');
  control.push(...normalizeRaceControl([row('2026-11-27T00:00:04Z', 'GREEN', 'GREEN FLAG')], 5));
  assert.equal(currentRaceFlag(control), 'green');
});

test('selected race detail merging rejects other sessions and future/older timestamps while exposing stale timing', () => {
  const now = Date.parse(stamp), game = { id: 'f1:1', leagueId: 'f1', sport: 'racing', kind: 'race', state: 'in', phase: 'live', startTime: stamp, entries: [], stale: true };
  const details = { gameId: game.id, leagueId: 'f1', timingFetchedAt: stamp, race: { ...game, entries: [{ id: 'f1:44', position: 1 }], flag: 'red', raceControl: [] } };
  const result = mergeSportDetails(game, details, { now }); assert.equal(result.flag, 'red'); assert.equal(result.stale, true); assert.equal(result.timingStale, false); assert.equal(result.state, 'in');
  assert.equal(mergeSportDetails(game, { ...details, gameId: 'f1:2' }, { now }), game);
  assert.equal(mergeSportDetails(game, { ...details, timingFetchedAt: '2027-01-01T00:00:00Z' }, { now }), game);
  assert.equal(mergeSportDetails(game, details, { now: now + 60000 }).timingStale, true);
  assert.equal(mergeSportDetails({ ...game, timingFetchedAt: stamp }, { ...details, timingFetchedAt: '2026-11-27T03:00:00Z' }, { now }).entries.length, 0);
});
