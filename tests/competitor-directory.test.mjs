import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSportsService, normalizeCompetitorDirectory } from '../lib/sports.mjs';
import { getLeague } from '../public/sports.js';
import { createFeedService } from '../lib/feed-service.mjs';

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/competitor-directories/${name}.json`, import.meta.url)));
const response = (body, status = 200) => Response.json(body, { status });
const turn = () => new Promise(resolve => setImmediate(resolve));
const stamp = Date.parse('2026-11-27T20:00:00Z');

test('the full verified golf catalogs load all pages, including the final page, with at most four parallel page reads', async () => {
  for (const [leagueId, expected, pageCount] of [['pga', 4426, 5], ['lpga', 3111, 4]]) {
    const calls = []; let active = 0, maximum = 0;
    const service = createSportsService({ now: () => stamp, fetchImpl: async input => {
      const url = new URL(input); calls.push(url);
      if (url.pathname.endsWith('/scoreboard')) return response(fixture(`${leagueId}-scoreboard`));
      active++; maximum = Math.max(maximum, active); await turn(); active--;
      return response(fixture(`${leagueId}-page${url.searchParams.get('page')}`));
    } });
    const result = await service.teams({ leagueId });
    assert.equal(result.teams.length, expected); assert.equal(new Set(result.teams.map(team => team.id)).size, expected);
    assert.equal(result.coverage.complete, true); assert.equal(result.coverage.pageCount, pageCount); assert.equal(result.coverage.pagesLoaded, pageCount);
    assert.match(result.coverage.message, /historical/); assert.equal(result.coverage.scope, 'catalog'); assert.ok(maximum <= 4);
    const pages = calls.filter(url => url.pathname.endsWith('/athletes'));
    assert.deepEqual(pages.map(url => Number(url.searchParams.get('page'))), Array.from({ length: pageCount }, (_, index) => index + 1));
    assert.ok(pages.every(url => url.hostname === 'sports.core.api.espn.com' && url.searchParams.get('limit') === '1000'));
    const finalId = fixture(`${leagueId}-page${pageCount}`).items.at(-1).id; assert.ok(result.teams.some(team => team.id === `${leagueId}:${finalId}`));
    const before = calls.length; await service.teams({ leagueId }); assert.equal(calls.length, before);
  }
});

test('tennis rankings remain searchable without a current draw and never claim to include every athlete', async () => {
  for (const leagueId of ['atp', 'wta']) {
    const service = createSportsService({ fetchImpl: async input => response(input.includes('/rankings') ? fixture(`${leagueId}-rankings`) : fixture(`${leagueId}-scoreboard`)) });
    const result = await service.teams({ leagueId });
    assert.equal(result.coverage.scope, 'ranking'); assert.equal(result.coverage.complete, false); assert.equal(result.coverage.sourceCount, 150);
    assert.ok(result.teams.length >= 150); assert.ok(result.teams.every(team => team.id.startsWith(`${leagueId}:`)));
    assert.match(result.coverage.message, /outside the published list/);
    if (leagueId === 'atp') assert.equal(result.teams.length, 150);
    else assert.equal(result.teams.length, 187);
  }
});

test('all supplied driver records are distinct from the current weekend entrants and preserve league identity', async () => {
  for (const [leagueId, expected] of [['f1', 37], ['nascar', 59], ['indycar', 33]]) {
    const service = createSportsService({ fetchImpl: async input => response(input.includes('/athletes') ? fixture(`${leagueId}-page1`) : fixture(`${leagueId}-scoreboard`)) });
    const result = await service.teams({ leagueId }); assert.equal(result.teams.length, expected); assert.equal(result.coverage.complete, true);
    assert.equal(result.coverage.scope, 'catalog'); assert.match(result.coverage.message, /reserves|previously listed/);
    assert.ok(result.teams.every(team => team.kind === 'driver' && team.leagueId === leagueId && team.id.startsWith(`${leagueId}:`)));
    if (leagueId === 'f1') assert.ok(result.teams.some(team => team.name === 'Max Verstappen'));
  }
});

test('missing or mismatched pages cannot become a falsely complete golf catalog', async () => {
  const calls = [];
  const service = createSportsService({ fetchImpl: async input => {
    const url = new URL(input); calls.push(url);
    if (url.pathname.endsWith('/scoreboard')) return response(fixture('pga-scoreboard'));
    const page = Number(url.searchParams.get('page'));
    return response(fixture(`pga-page${page === 3 ? 2 : page}`));
  } });
  const result = await service.teams({ leagueId: 'pga' });
  assert.equal(result.coverage.complete, false); assert.equal(result.coverage.scope, 'event'); assert.equal(result.coverage.retryable, true);
  assert.equal(result.teams.length, 0); assert.ok(calls.length <= 6); assert.match(result.coverage.message, /temporarily unavailable/);
});

test('a failed catalog refresh retains the last complete catalog with its original timestamp and stale label', async () => {
  let now = stamp, unavailable = false;
  const service = createSportsService({ now: () => now, fetchImpl: async input => {
    const url = new URL(input);
    if (url.pathname.endsWith('/scoreboard')) return response(fixture('pga-scoreboard'));
    if (unavailable) return response({}, 503);
    return response(fixture(`pga-page${url.searchParams.get('page')}`));
  } });
  const original = await service.teams({ leagueId: 'pga' }); now += 900001; unavailable = true;
  const result = await service.teams({ leagueId: 'pga' });
  assert.equal(result.teams.length, 4426); assert.equal(result.stale, true); assert.equal(result.fetchedAt, original.fetchedAt);
});

test('partial provider catalogs, unknown names and unsafe photos remain explicitly incomplete or absent', () => {
  const raw = fixture('pga-page1');
  const incomplete = normalizeCompetitorDirectory(raw, { league: getLeague('pga') });
  assert.equal(incomplete.coverage.complete, false); assert.equal(incomplete.teams.length, 1000);
  const tennis = fixture('atp-rankings'); tennis.rankings[0].ranks[0].athlete.headshot = 'https://untrusted.example/photo.png';
  const result = normalizeCompetitorDirectory(tennis, { league: getLeague('atp') });
  assert.ok(result.teams.every(team => !team.logo || new URL(team.logo).hostname === 'a.espncdn.com'));
  assert.throws(() => normalizeCompetitorDirectory({}, { league: getLeague('pga') }), { code: 'INVALID_TEAMS' });
});

test('pagination opt-in keeps the default two-request cap and enforces the absolute six-request cap', async () => {
  class FeedError extends Error { constructor(message, options) { super(message); Object.assign(this, options); } }
  for (const [maxRequests, attempted, expectedReads, succeeds] of [[undefined, 3, 2, false], [6, 6, 6, true], [100, 7, 6, false]]) {
    let calls = 0;
    const read = createFeedService({ sources: [{ id: 'test', maxRequests, url: () => 'https://catalog.example/page/1',
      async load({ requestJson }) { for (let page = 1; page <= attempted; page++) await requestJson(`https://catalog.example/page/${page}`); return { payload: { teams: [] } }; } }],
      normalize: (value, { fetchedAt }) => ({ ...value, fetchedAt }), ErrorType: FeedError, label: 'test catalog', invalidCode: 'INVALID', unavailableCode: 'UNAVAILABLE', timeoutCode: 'TIMEOUT',
      fetchImpl: async () => { calls++; return response({}); }, totalTimeoutMs: 18000 });
    if (succeeds) await read('directory'); else await assert.rejects(read('directory'), { code: 'INVALID' });
    assert.equal(calls, expectedReads);
  }
});
