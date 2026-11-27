import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LEAGUES, getLeague, leagueGroups, formatPeriod, formatSituation } from '../public/sports.js';
import { referenceForLeague } from '../public/sport-fixtures.js';
import { createSportsService, normalizeSportScoreboard, normalizeSportGame, normalizeSportDetails, normalizeSportTeams } from '../lib/sports.mjs';
import { createFavoriteDirectoryStore, searchFavoriteTeams, favoriteFromTeam } from '../public/favorite-search.js';
import { matchesFavorite, normalizeFavorites } from '../public/preferences-model.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/college/${name}.json`, import.meta.url)));
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const board = (league) => normalizeSportScoreboard(fixture(`${league}-scoreboard`), { leagueId: league });

test('both selectors can share one College sports group without dropping or duplicating a league', () => {
  const groups = leagueGroups();
  assert.deepEqual(groups.map((group) => group.label), ['Leagues & competitions', 'College sports']);
  assert.deepEqual(groups[1].leagues.map((league) => league.id), ['cfb', 'cbb', 'wcbb', 'ncaavb', 'ncaamvb']);
  assert.deepEqual(groups[0].leagues, LEAGUES.filter((league) => league.group !== 'college'));
  assert.equal(new Set(groups.flatMap((group) => group.leagues.map((league) => league.id))).size, LEAGUES.length);
  assert.equal(groups.reduce((total, group) => total + group.leagues.length, 0), LEAGUES.length);
  for (const group of groups) for (const league of group.leagues) assert.equal(league.group, group.id);
});

test('the verified football Division I filter contains every FBS and FCS game, once each', () => {
  const verification = fixture('coverage-verification'), football = verification.football;
  assert.equal(football['90'].name, 'NCAA Division I');
  assert.equal(football['80'].name, 'FBS'); assert.equal(football['81'].name, 'FCS');
  assert.match(football['80'].parent, /\/groups\/90\?/); assert.match(football['81'].parent, /\/groups\/90\?/);
  const combined = new Set([...football['80'].eventIds, ...football['81'].eventIds]);
  assert.equal(football['80'].eventIds.length, 58); assert.equal(football['81'].eventIds.length, 62);
  assert.equal(combined.size, 116);
  assert.deepEqual(new Set(football['90'].eventIds), combined);
  const data = normalizeSportScoreboard(fixture('cfb-division-one-scoreboard'), { leagueId: 'cfb' });
  assert.equal(data.games.length, 116);
  assert.deepEqual(new Set(data.games.map((game) => game.providerId)), combined);
  assert.equal(verification.footballLimit1000EventIds.length, 25);
  assert.deepEqual(verification.badFootballFilterEventIds, []);
  assert.equal(board('cfb').games.length, 13);
});

test('college basketball includes unranked Division I games omitted by the default schedule', () => {
  const verification = fixture('coverage-verification');
  for (const [league, expected, defaultCount] of [['cbb', 55, 14], ['wcbb', 78, 10]]) {
    const data = board(league), source = verification.basketball[league];
    assert.equal(data.games.length, expected); assert.equal(source.defaultEventIds.length, defaultCount);
    assert.deepEqual(new Set(data.games.map((game) => game.providerId)), new Set(source.allDivisionOneEventIds));
    const additional = data.games.filter((game) => !source.defaultEventIds.includes(game.providerId));
    assert.ok(additional.some((game) => game.home.rank === 99 && game.away.rank === 99));
    assert.ok(additional.every((game) => game.id.startsWith(`${league}:`) && game.away.id.startsWith(`${league}:`)));
  }
});

test('college filters are league-specific on primary and mirror routes with no extra healthy requests', async () => {
  for (const [league, group] of [['cfb', '90'], ['cbb', '50'], ['wcbb', '50'], ['ncaavb', null], ['ncaamvb', null]]) {
    const calls = [], payload = ['cfb', 'cbb', 'wcbb'].includes(league) ? fixture(`${league}-scoreboard`) : { events: [] };
    const service = createSportsService({ fetchImpl: async (url) => { calls.push(new URL(url)); return response(payload); } });
    await service.scoreboard({ leagueId: league, date: '2026-11-27' });
    await service.scoreboard({ leagueId: league, date: '20261127' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].searchParams.get('groups'), group);
    assert.equal(calls[0].searchParams.get('limit'), '300');
    assert.equal(calls[0].searchParams.get('dates'), '20261127');
    assert.ok(calls[0].pathname.includes(getLeague(league).espnPath));
  }
  const calls = [], service = createSportsService({ fetchImpl: async (url) => {
    calls.push(new URL(url)); return url.includes('site.api.') ? response({}, 503) : response(fixture('cfb-scoreboard'));
  } });
  const fallback = await service.scoreboard({ leagueId: 'cfb' });
  assert.equal(fallback.feedStatus, 'backup'); assert.equal(fallback.games.length, 13);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((url) => url.searchParams.get('groups') === '90' && !url.searchParams.has('dates')));
});

test('live college football preserves actual downs, possession, timeouts, team branding and quarter scores', () => {
  const game = board('cfb').games.find((game) => game.providerId === '401856762');
  assert.equal(game.away.name, 'Mississippi State Bulldogs'); assert.equal(game.home.name, 'Ole Miss Rebels');
  assert.equal(game.away.id, 'cfb:344'); assert.equal(game.home.id, 'cfb:145');
  assert.equal(game.clock, '10:48'); assert.equal(formatPeriod(game), 'Q2');
  assert.equal(game.downDistance, '1st & 15'); assert.equal(game.fieldPosition, 'MISS 16');
  assert.equal(formatSituation(game), '1st & 15 · MISS 16');
  assert.equal(game.possessionTeamId, game.away.id); assert.equal(game.situation.possessionTeamId, game.away.id);
  assert.equal(game.away.timeouts, 3); assert.equal(game.home.timeouts, 3); assert.equal(game.away.maxTimeouts, 3);
  assert.match(game.away.logo, /\/ncaa\/500\/344\.png$/); assert.ok(game.away.linescores.length);
  assert.equal(game.playClock, null);
  const raw = fixture('cfb-scoreboard').events.find((event) => event.id === '401856762');
  delete raw.competitions[0].situation;
  const missing = normalizeSportGame(raw, 'cfb');
  assert.equal(missing.possessionTeamId, null); assert.equal(missing.downDistance, null); assert.equal(missing.away.timeouts, null);
});

test('real men’s halves, women’s quarters and overtime labels remain distinct in scores, details and samples', () => {
  const men = board('cbb').games.find((game) => game.providerId === '401920429');
  const women = board('wcbb').games.find((game) => game.providerId === '401927987');
  assert.equal(formatPeriod(men), 'H2'); assert.equal(men.clock, '6:28');
  assert.equal(formatPeriod(women), 'Q4'); assert.equal(women.clock, '5:34');
  assert.equal(formatPeriod({ ...men, period: 3 }), 'OT'); assert.equal(formatPeriod({ ...men, period: 4 }), '2OT');
  assert.equal(formatPeriod({ ...women, period: 3 }), 'Q3'); assert.equal(formatPeriod({ ...women, period: 5 }), 'OT');
  assert.equal(formatPeriod({ ...men, phase: 'halftime', period: 1 }), 'Halftime');
  assert.equal(formatPeriod(referenceForLeague('cbb')), 'H2'); assert.equal(formatPeriod(referenceForLeague('wcbb')), 'Q3');
  assert.equal(men.away.timeouts, null); assert.equal(men.away.maxTimeouts, null); assert.equal(men.situation.shotClock, null);
  for (const [league, labels, statCount] of [['cbb', ['H1', 'H2'], 25], ['wcbb', ['Q1', 'Q2', 'Q3', 'Q4'], 24]]) {
    const raw = fixture(`${league}-summary`), details = normalizeSportDetails(raw, { leagueId: league, gameId: `${league}:${raw.header.id}` });
    assert.equal(raw.format.regulation.periods, labels.length);
    assert.equal(raw.format.regulation.clock, league === 'cbb' ? 1200 : 600);
    assert.deepEqual(details.quarterScores.map((period) => period.label), labels);
    assert.equal(details.allTeamStats.length, statCount); assert.ok(details.playerStats[0].away.athletes.length);
    assert.ok(details.scoringPlays.some((play) => play.player?.name && play.scoringTeamId?.startsWith(`${league}:`)));
    assert.ok(details.players.every((player) => player.teamId?.startsWith(`${league}:`)));
  }
});

test('college football details retain the real college photos and source without changing NFL adapters', () => {
  const raw = fixture('cfb-summary'), gameId = `cfb:${raw.header.id}`;
  const details = normalizeSportDetails(raw, { leagueId: 'cfb', gameId });
  assert.equal(raw.format.regulation.periods, 4); assert.equal(raw.format.regulation.clock, 900);
  assert.match(details.sourceUrl, /\/football\/college-football\/summary\?event=401856762$/);
  assert.equal(details.allTeamStats.length, 15); assert.equal(details.playerStats.length, 10);
  assert.deepEqual(details.quarterScores.map((period) => period.label), ['Q1', 'Q2']);
  const athlete = details.players.find((player) => player.id === '5294646');
  assert.equal(athlete.name, 'Parker Puckett'); assert.equal(athlete.teamId, 'cfb:344');
  assert.equal(athlete.headshot, 'https://a.espncdn.com/i/headshots/college-football/players/full/5294646.png');
  assert.ok(details.playerStats.flatMap((group) => group.away.athletes).some((row) => row.player.id === athlete.id && row.player.headshot === athlete.headshot));
  assert.equal(details.scoringPlays[0].scoringTeamId, 'cfb:145'); assert.equal(details.scoringPlays[0].scoringType, 'field-goal');
  for (const entry of raw.boxscore.players) for (const group of entry.statistics) for (const row of group.athletes) {
    if (row.athlete.id === athlete.id) row.athlete.headshot = { href: 'https://example.invalid/photo.png' };
  }
  assert.equal(normalizeSportDetails(raw, { leagueId: 'cfb', gameId }).players.find((player) => player.id === athlete.id).headshot, null);
});

test('college directories preserve every supplied team and keep the same school separate across sports', async () => {
  const calls = [], service = createSportsService({ fetchImpl: async (url) => {
    const league = ['cfb', 'cbb', 'wcbb'].find((id) => url.includes(getLeague(id).espnPath));
    calls.push(new URL(url)); return response(fixture(`${league}-teams`));
  } });
  const schools = [];
  for (const [league, expected] of [['cfb', 763], ['cbb', 365], ['wcbb', 363]]) {
    const data = await service.teams({ leagueId: league });
    assert.equal(data.teams.length, expected); assert.equal(data.teams.at(-1).name, 'Youngstown State Penguins');
    assert.equal(new Set(data.teams.map((team) => team.id)).size, expected);
    assert.ok(data.teams.every((team) => team.leagueId === league && team.id.startsWith(`${league}:`)));
    schools.push(data.teams.find((team) => team.providerId === '130'));
    await service.teams({ leagueId: league });
  }
  assert.equal(calls.length, 3); assert.ok(calls.every((url) => url.searchParams.get('limit') === '1000'));
  assert.deepEqual(schools.map((school) => school.id), ['cfb:130', 'cbb:130', 'wcbb:130']);
  const favorites = normalizeFavorites(schools.map(favoriteFromTeam));
  assert.equal(favorites.length, 3);
  const game = { leagueId: 'cfb', away: schools[0], home: { id: 'cfb:145' } };
  assert.equal(matchesFavorite(game, [favorites[0]]), true); assert.equal(matchesFavorite(game, [favorites[1]]), false);
});

test('loading a college directory once makes full school names and the last team searchable without requests per keystroke', async () => {
  const calls = [], store = createFavoriteDirectoryStore({ fetcher: async (url) => {
    const league = new URL(url, 'https://scorebug.example').searchParams.get('league'); calls.push(league);
    return response({ leagueId: league, teams: normalizeSportTeams(fixture(`${league}-teams`), league) });
  } });
  try {
    await store.load('cfb');
    for (const query of ['Michigan Wolverines', 'MichiganWolverines', '  MICHIGAN  wolverines ']) {
      assert.equal(searchFavoriteTeams(store.teams(), query, { leagueId: 'cfb', preferredLeagueId: 'f1' }).enterTeam?.id, 'cfb:130');
    }
    const text = 'Youngstown State Penguins';
    for (let index = 1; index <= text.length; index++) searchFavoriteTeams(store.teams(), text.slice(0, index), { leagueId: 'cfb' });
    assert.equal(searchFavoriteTeams(store.teams(), text, { leagueId: 'cfb' }).enterTeam?.id, 'cfb:2754');
    await store.load('cfb'); assert.deepEqual(calls, ['cfb']);
    await store.load('cbb');
    const shared = searchFavoriteTeams(store.teams(), 'Michigan Wolverines', { preferredLeagueId: 'cbb' });
    assert.equal(shared.teams[0].leagueId, 'cbb'); assert.equal(shared.enterTeam, null);
    assert.deepEqual(calls, ['cfb', 'cbb']);
  } finally { store.stop(); }
});
