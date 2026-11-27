import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MLB_TEAMS } from '../lib/official-teams.mjs';
import { normalizeMLBScoreboard, createMLBSource, reconcileProviderAliases, sportsDay } from '../lib/mlb-official.mjs';
import { normalizeSportScoreboard, normalizeSportDetails, createSportsService } from '../lib/sports.mjs';
const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/multisport/${name}.json`, import.meta.url)));
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const now = Date.parse('2026-10-29T03:30:00Z');

test('all 30 official MLB IDs match verified canonical team names and sport-specific logo identities', () => {
  const teams = fixture('official-mlb-teams').teams;
  assert.equal(teams.length, 30); assert.equal(Object.keys(MLB_TEAMS).length, 30);
  for (const team of teams) { const canonical = MLB_TEAMS[team.id]; assert.equal(canonical.name, team.name); assert.match(canonical.id, /^mlb:\d+$/); assert.equal(canonical.leagueId, 'mlb'); assert.equal(canonical.sport, 'baseball'); assert.match(canonical.logo, /^https:\/\/a\.espncdn\.com\/i\/teamlogos\/mlb\//); }
  assert.equal(MLB_TEAMS['158'].id, 'mlb:8'); assert.equal(MLB_TEAMS['139'].id, 'mlb:30');
});

test('official MLB alone preserves scores and innings without pretending its game ID is an ESPN ID', () => {
  const result = normalizeMLBScoreboard(fixture('official-mlb'), { key: '20261028', now });
  const game = result.games[0]; assert.equal(result.source, 'MLB'); assert.equal(game.id, 'mlb:mlb-849799'); assert.equal(game.detailsGameId, null);
  assert.equal(game.away.name, 'Milwaukee Brewers'); assert.equal(game.home.name, 'Tampa Bay Rays'); assert.equal(game.away.score, 4); assert.equal(game.home.score, 1);
  assert.equal(game.period, 9); assert.equal(game.phase, 'final'); assert.equal(game.away.linescores.length, 9);
  assert.equal(game.lastPlayDetails, null); assert.deepEqual(game.situation.bases, [null, null, null]);
});

test('only an exact unique matchup preserves its known ESPN game identity across fallback', () => {
  const primary = normalizeSportScoreboard(fixture('mlb-scoreboard'), { leagueId: 'mlb' });
  const next = normalizeMLBScoreboard(fixture('official-mlb'), { key: '20261028', previous: primary, now });
  assert.equal(next.games[0].id, 'mlb:401908046'); assert.equal(next.games[0].detailsGameId, 'mlb:401908046'); assert.ok(next.games[0].idAliases.includes('mlb:mlb-849799'));
  const ambiguous = { games: [primary.games[0], { ...primary.games[0], id: 'mlb:999999' }] };
  assert.equal(normalizeMLBScoreboard(fixture('official-mlb'), { key: '20261028', previous: ambiguous, now }).games[0].detailsGameId, null);
  const otherDate = { games: [{ ...primary.games[0], startTime: '2026-10-28T00:00:00Z' }] };
  assert.equal(normalizeMLBScoreboard(fixture('official-mlb'), { key: '20261028', previous: otherDate, now }).games[0].detailsGameId, null);
});

test('a cold official provider selection remains discoverable after ESPN recovers', () => {
  const official = normalizeMLBScoreboard(fixture('official-mlb'), { key: '20261028', now });
  const primary = normalizeSportScoreboard(fixture('mlb-scoreboard'), { leagueId: 'mlb' });
  const recovered = reconcileProviderAliases(primary, official);
  assert.equal(recovered.games[0].id, 'mlb:401908046'); assert.equal(recovered.games[0].detailsGameId, 'mlb:401908046');
  assert.ok(recovered.games[0].idAliases.includes('mlb:mlb-849799'));
});

test('doubleheader identity matching must be unique in both schedules before assigning canonical IDs or aliases', () => {
  const primary = normalizeSportScoreboard(fixture('mlb-scoreboard'), { leagueId: 'mlb' });
  const raw = fixture('official-mlb');
  raw.dates[0].games.push({ ...structuredClone(raw.dates[0].games[0]), gamePk: 849800 }); raw.totalGames = 2;
  const official = normalizeMLBScoreboard(raw, { key: '20261028', previous: primary, now });
  assert.deepEqual(official.games.map((game) => game.id), ['mlb:mlb-849799', 'mlb:mlb-849800']);
  assert.ok(official.games.every((game) => game.detailsGameId === null));
  const twoPrimary = { ...primary, games: [...primary.games, { ...primary.games[0], id: 'mlb:401908047', detailsGameId: 'mlb:401908047' }] };
  const oneOfficial = normalizeMLBScoreboard(fixture('official-mlb'), { key: '20261028', now });
  const recovered = reconcileProviderAliases(twoPrimary, oneOfficial);
  assert.ok(recovered.games.every((game) => !game.idAliases?.length));
  assert.ok(reconcileProviderAliases(primary, official).games.every((game) => !game.idAliases?.length));
});

test('official live linescore supplies current count, batter and occupied bases while missing values stay unknown', () => {
  const raw = fixture('official-mlb'), g = raw.dates[0].games[0];
  g.status = { abstractGameState: 'Live', detailedState: 'In Progress', statusCode: 'I' }; g.linescore.outs = 1; g.linescore.balls = 0;
  let game = normalizeMLBScoreboard(raw, { key: '20261028', now }).games[0];
  assert.equal(game.phase, 'live'); assert.equal(game.situation.balls, 0); assert.equal(game.situation.outs, 1); assert.deepEqual(game.situation.bases, [false, true, false]); assert.equal(game.possessionTeamId, game.home.id);
  assert.equal(game.situation.batter, 'Richie Palacios'); assert.equal(game.situation.pitcher, 'Trevor Megill');
  delete g.linescore.offense; delete g.teams.away.score;
  game = normalizeMLBScoreboard(raw, { key: '20261028', now }).games[0]; assert.equal(game.away.score, null); assert.deepEqual(game.situation.bases, [null, null, null]);
});

test('wrong dates, renamed/mismatched IDs and malformed official feeds cannot be reported as healthy empty schedules', () => {
  assert.throws(() => normalizeMLBScoreboard(fixture('official-mlb'), { key: '20261027', now }), { code: 'INVALID_UPSTREAM' });
  const raw = fixture('official-mlb'); raw.dates[0].games[0].teams.home.team.name = 'Another franchise';
  assert.throws(() => normalizeMLBScoreboard(raw, { key: '20261028', now }), { code: 'INVALID_UPSTREAM' });
  assert.throws(() => normalizeMLBScoreboard({ dates: [] }, { key: '20261028', now }), { code: 'INVALID_UPSTREAM' });
  assert.throws(() => normalizeMLBScoreboard({ dates: [], totalGames: 1 }, { key: '20261028', now }), { code: 'INVALID_UPSTREAM' });
  assert.deepEqual(normalizeMLBScoreboard({ dates: [], totalGames: 0 }, { key: '20261028', now }).games, []);
});

test('MLB current-day requests include the previous day only to keep an overnight live game visible', () => {
  const midnight = Date.parse('2026-10-29T05:30:00Z'); assert.equal(sportsDay(midnight), '2026-10-29');
  const source = createMLBSource({ now: () => midnight }); const url = new URL(source.url('current'));
  assert.equal(url.hostname, 'statsapi.mlb.com'); assert.equal(url.searchParams.get('startDate'), '2026-10-28'); assert.equal(url.searchParams.get('endDate'), '2026-10-29');
  const dated = new URL(source.url('20261028')); assert.equal(dated.searchParams.get('date'), '2026-10-28'); assert.equal(dated.searchParams.has('startDate'), false);
  const raw = fixture('official-mlb'); assert.equal(normalizeMLBScoreboard(raw, { key: 'current', now: midnight }).games.length, 0);
  raw.dates[0].games[0].status.abstractGameState = 'Live'; raw.dates[0].games[0].status.detailedState = 'In Progress';
  assert.equal(normalizeMLBScoreboard(raw, { key: 'current', now: midnight }).games.length, 1);
});

test('a real provider outage reaches the independent MLB host, preserving canonical teams and known details identity', async () => {
  let clock = now, fail = false; const calls = [];
  const service = createSportsService({ now: () => clock, fetchImpl: async (url) => { calls.push(url); return url.includes('statsapi.mlb.com') ? json(fixture('official-mlb')) : fail ? json({}, 503) : json(fixture('mlb-scoreboard')); } });
  const primary = await service.scoreboard({ leagueId: 'mlb', date: '20261028' }); assert.equal(primary.sourceId, 'espn-site');
  clock += 2000; fail = true; const fallback = await service.scoreboard({ leagueId: 'mlb', date: '20261028' });
  assert.equal(fallback.sourceId, 'mlb-official'); assert.equal(fallback.feedStatus, 'backup'); assert.equal(fallback.stale, false);
  assert.equal(fallback.games[0].id, primary.games[0].id); assert.equal(fallback.games[0].away.id, primary.games[0].away.id);
  assert.ok(calls.some((u) => u.startsWith('https://statsapi.mlb.com/api/v1/schedule?')));
});

test('cold live MLB fallback can recover to ESPN without dropping its pinned official-ID alias', async () => {
  const official = fixture('official-mlb'), primary = fixture('mlb-scoreboard');
  official.dates[0].games[0].status = { abstractGameState: 'Live', detailedState: 'In Progress', statusCode: 'I' };
  primary.events[0].competitions[0].status = { period: 9, type: { state: 'in', name: 'STATUS_BOTTOM' } };
  let clock = now, fail = true;
  const service = createSportsService({ now: () => clock, fetchImpl: async (url) => url.includes('statsapi.mlb.com') ? json(official) : fail ? json({}, 503) : json(primary) });
  const first = await service.scoreboard({ leagueId: 'mlb', date: '20261028' });
  assert.equal(first.sourceId, 'mlb-official'); assert.equal(first.games[0].state, 'in'); assert.equal(first.games[0].id, 'mlb:mlb-849799');
  clock += 5000; fail = false;
  const recovered = await service.scoreboard({ leagueId: 'mlb', date: '20261028' });
  assert.equal(recovered.sourceId, 'espn-site'); assert.equal(recovered.stale, false);
  assert.equal(recovered.games[0].id, 'mlb:401908046'); assert.equal(recovered.games[0].detailsGameId, 'mlb:401908046');
  assert.ok(recovered.games[0].idAliases.includes(first.games[0].id));
});

test('2026 WNBA directory includes the directly verified Connecticut Sun without inventing a Houston logo', async () => {
  const sun = fixture('wnba-connecticut'); const calls = [];
  const service = createSportsService({ now: () => Date.parse('2026-11-27T04:00:00Z'), fetchImpl: async (url) => { calls.push(url); return json(url.includes('/teams/18') ? sun : { sports: [{ leagues: [{ teams: [{ team: { id: '1', displayName: 'Atlanta Dream', abbreviation: 'ATL' } }] }] }] }); } });
  const value = await service.teams({ leagueId: 'wnba' }); const team = value.teams.find((t) => t.id === 'wnba:18');
  assert.equal(team.name, 'Connecticut Sun'); assert.equal(team.abbreviation, 'CON'); assert.match(team.logo, /\/wnba\/500\/con\.png/); assert.equal(calls.length, 2);
});

test('soccer key events, exact named scorers, roster stats and full commentary survive normalization', () => {
  const raw = fixture('ucl-summary'), details = normalizeSportDetails(raw, { leagueId: 'ucl', gameId: `ucl:${raw.header.id}` });
  assert.equal(details.scoringPlays.length, 5); assert.ok(details.scoringPlays.every((p) => p.scoreValue === 1 && p.scoringType === 'goal'));
  assert.equal(details.scoringPlays.find((p) => p.clock === "55'").player.name, 'Karim Adeyemi');
  assert.ok(details.scoringPlays.every((p) => p.scores.away === null && p.scores.home === null));
  assert.equal(details.playerStats[0].away.athletes.length, 23); assert.equal(details.playerStats[0].home.athletes.length, 23);
  assert.match(details.lastPlay.text, /^Second Half ends/); assert.ok(details.playByPlay.length > 80);
});
