import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { LEAGUES } from '../public/sports.js';
import { normalizePreferencePatch, normalizeFavorites, matchesFavorite, supportedGameId } from '../public/preferences-model.js';
import { readCachedScoreboard, writeCachedScoreboard, ScoreboardPoller } from '../public/score-client.js';

const require = createRequire(import.meta.url);
const { cleanPatch, cleanDetailsContext, cleanDetailsRegions } = require('../desktop/preferences.cjs');
const { detailsPlacement } = require('../desktop/geometry.cjs');

test('all browser league selections and favorite artwork survive a native preference round trip', () => {
  const favorites = normalizeFavorites(LEAGUES.map(({ id: leagueId }, index) => ({
    leagueId, teamId: leagueId === 'nfl' ? '3' : `${leagueId}:3`, name: `${leagueId} team`, abbreviation: 'CHI',
    logo: index % 2 ? '/logos/nba/chi.png' : '/logos/chi.png', color: '#0b162a'
  })));
  for (const { id: leagueId } of LEAGUES) {
    const patch = normalizePreferencePatch({ leagueId, gameId: leagueId === 'nfl' ? '401000001' : `${leagueId}:401000001`, styleId: 'nfl-blades', favorites });
    assert.deepEqual(normalizePreferencePatch(cleanPatch(patch)), patch);
  }
  const free = { anchor: null };
  assert.deepEqual(normalizePreferencePatch(cleanPatch(free)), free, 'free placement must clear a previously selected snap anchor');
});

test('browser IDs and native source context share their full allowed length and reject namespace collisions', () => {
  for (const { id: leagueId } of LEAGUES) {
    const gameId = leagueId === 'nfl' ? '123456789012345' : `${leagueId}:${'x'.repeat(48)}`;
    assert.equal(supportedGameId(gameId), true);
    assert.deepEqual(cleanDetailsContext({ gameId, leagueId }), { gameId, leagueId });
    if (leagueId !== 'nfl') assert.throws(() => cleanDetailsContext({ gameId: '123', leagueId }));
  }
  for (const gameId of ['nba:../private', 'nba:' + 'x'.repeat(49), 'https://example.com', 'fox-1/2']) {
    assert.equal(supportedGameId(gameId), false);
    assert.throws(() => cleanPatch({ gameId }));
  }
  assert.throws(() => cleanDetailsContext({ gameId: 'nba:123', leagueId: 'nhl' }));
});

test('favorite matching keeps identical provider team numbers separate and includes race drivers', () => {
  const favorite = [{ leagueId: 'nba', teamId: 'nba:3', name: 'Favorite', abbreviation: 'FAV' }];
  assert.equal(matchesFavorite({ id: 'nba:1', leagueId: 'nba', away: { id: 'nba:3' }, home: { id: 'nba:4' } }, favorite), true);
  assert.equal(matchesFavorite({ id: 'nhl:1', leagueId: 'nhl', away: { id: 'nhl:3' }, home: { id: 'nhl:4' } }, favorite), false);
  assert.equal(matchesFavorite({ id: '1', leagueId: 'nfl', away: { id: '3' }, home: { id: '4' } }, favorite), false);
  assert.equal(matchesFavorite({ id: 'f1:1', leagueId: 'f1', entries: [{ athlete: { id: 'f1:4' }, team: { id: 'f1:constructor_1' } }] }, [{ leagueId: 'f1', teamId: 'f1:4' }]), true);
  assert.deepEqual(normalizeFavorites([{ leagueId: 'nba', teamId: '3' }, { leagueId: 'nfl', teamId: 'CHI' }, { leagueId: 'nba', teamId: 'nhl:3' }]), []);
});

test('live cache and delayed responses cannot bring an old league into the selected game', async () => {
  const values = new Map(), storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const now = Date.now();
  const feed = leagueId => ({ leagueId, fetchedAt: new Date(now).toISOString(), games: [{ id: `${leagueId}:123`, leagueId, state: 'in', phase: 'live', away: { id: `${leagueId}:3` }, home: { id: `${leagueId}:4` } }] });
  for (const leagueId of ['nba', 'nhl']) assert.equal(writeCachedScoreboard(null, feed(leagueId), { storage, now, leagueId }), true);
  assert.equal(readCachedScoreboard(null, { storage, now, leagueId: 'nba' }).games[0].id, 'nba:123');
  assert.equal(readCachedScoreboard(null, { storage, now, leagueId: 'nhl' }).games[0].id, 'nhl:123');
  let releaseOld;
  const seen = [];
  const poller = new ScoreboardPoller({ leagueId: 'nba', storage: null, now: () => now, onUpdate: snapshot => seen.push(snapshot), fetcher: url => {
    const leagueId = new URL(url).searchParams.get('league');
    if (leagueId === 'nba') return new Promise(resolve => { releaseOld = () => resolve({ ok: true, headers: new Headers(), json: async () => feed('nba') }); });
    return Promise.resolve({ ok: true, headers: new Headers(), json: async () => feed(leagueId) });
  } });
  try {
    poller.start();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(typeof releaseOld, 'function');
    poller.setContext({ leagueId: 'nhl' });
    await new Promise(resolve => setImmediate(resolve));
    releaseOld();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(poller.data.leagueId, 'nhl');
    assert.equal(seen.at(-1).data.leagueId, 'nhl');
    assert.ok(seen.every(snapshot => !snapshot.data || snapshot.data.leagueId === 'nhl'));
  } finally { poller.stop(); }
});

test('adapted Blades use their actual panel, and angled panels preserve the measured source edge', () => {
  const value = { styleId: 'nfl-blades', legacyBlades: false, targets: [{ side: 'comparison', x: 8, y: 32, width: 144, height: 32 }],
    panels: { comparison: { x: 8, y: 32, width: 144, height: 32, fill: '#111111', border: '#444444', ink: '#ffffff' } }, board: { x: 8, y: 32, width: 144, height: 250 } };
  const layout = cleanDetailsRegions(value, { width: 160, height: 320 });
  assert.equal(layout.legacyBlades, false);
  const area = { x: 0, y: 25, width: 1440, height: 850 }, widget = { x: 1264, y: 280, width: 160, height: 320 };
  const timing = detailsPlacement(widget, area, { side: 'comparison', orientation: 'vertical', measuredLayout: layout });
  assert.equal(timing.presentation.gradientY, widget.y + 32 - timing.bounds.y);
  assert.equal(timing.presentation.gradientHeight, 32);
  assert.equal(timing.presentation.teamFill, '#111111');
  const slanted = cleanDetailsRegions({ ...value, targets: [], panels: { home: { x: 8, y: 103, width: 144, height: 96, points: [[17, 103], [152, 103], [143, 199], [8, 199]] } } }, { width: 160, height: 320 });
  const edge = detailsPlacement(widget, area, { side: 'home', orientation: 'vertical', measuredLayout: slanted });
  assert.equal(edge.presentation.direction, 'left');
  const topX = edge.bounds.x + edge.presentation.joinTopX, bottomX = edge.bounds.x + edge.presentation.joinBottomX;
  assert.equal(topX - bottomX, 9, 'lateral joins must retain the real slant rather than a rectangular bounding box');
});
