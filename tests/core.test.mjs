import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCoreDetailsSource, normalizeCoreDetails } from '../lib/espn-core.mjs';
import { createGameDetailsService, normalizeGameDetails } from '../lib/details.mjs';
import { snapshotIsOlder, retainKnownStats } from '../public/feed-state.js';
import { GameDetailsPoller } from '../public/game-details-client.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/espn-core-v122.json', import.meta.url)));
const live = JSON.parse(readFileSync(new URL('./fixtures/espn-live-v121.json', import.meta.url)));
const NOW = Date.parse(fixture._capture.retrievedAt);
const context = { key: '401873080', fetchedAt: new Date(NOW).toISOString(), sourceUrl: fixture._capture.playsUrl };
const turn = () => new Promise((resolve) => setImmediate(resolve));
const known = () => normalizeGameDetails(live.summary, { gameId: context.key, fetchedAt: new Date(NOW - 2000).toISOString() });

test('actual ESPN core response supplies bounded play evidence without inventing totals, current down, timeouts or clock', () => {
  const data = normalizeCoreDetails(fixture, context);
  assert.equal(data.away.abbreviation, 'PHI'); assert.equal(data.home.abbreviation, 'DAL');
  assert.equal(data.gameId, context.key); assert.equal(data.dataScope, 'plays');
  assert.equal(data.eventPlays.length, 24); assert.equal(data.recentPlays.length, 3);
  assert.equal(data.lastPlay.id, '4018730804818');
  assert.equal(data.lastPlay.isTurnover, true); assert.equal(data.lastPlay.typeId, '26');
  assert.deepEqual(data.lastPlay.scores, { away: 39, home: 38 });
  assert.equal(data.lastPlay.end.fieldPosition, 'PHI 28');
  assert.equal(data.situation, null); assert.equal(data.clock, null); assert.equal(data.period, null);
  assert.equal(data.state, 'unknown'); assert.equal(data.drive, null);
  assert.equal(data.statsStale, true); assert.equal(data.statsFetchedAt, null);
  assert.ok(data.teamStats.every((stat) => stat.away === null && stat.home === null));
  assert.equal(data.sourceUpdatedAt, null, 'A play modification is not a full-summary update timestamp.');
  assert.equal(data.playsUpdatedAt, '2026-11-27T01:42:00.000Z');
});

test('core retains only the same matchup’s previous stats and roster, preserving their original check time', () => {
  const previous = known();
  const data = normalizeCoreDetails(fixture, { ...context, previous });
  assert.deepEqual(data.teamStats, previous.teamStats);
  assert.deepEqual(data.leaders, previous.leaders);
  assert.equal(data.statsFetchedAt, previous.fetchedAt);
  assert.equal(data.statsStale, true);
  assert.ok(data.players.length > 0);
  const next = normalizeCoreDetails(fixture, { ...context, fetchedAt: new Date(NOW + 2000).toISOString(), previous: data });
  assert.equal(next.statsFetchedAt, previous.fetchedAt, 'Repeated play checks must not refresh the old totals.');
  const wrong = normalizeCoreDetails(fixture, { ...context, previous: { ...previous, gameId: '999' } });
  assert.equal(wrong.statsFetchedAt, null); assert.deepEqual(wrong.players, []);
  assert.ok(wrong.teamStats.every((stat) => stat.away === null));
});

test('wrong games, references, teams and incomplete core pagination are rejected', () => {
  for (const change of [
    (value) => { value.event.id = '999'; },
    (value) => { value.event.competitions[0].competitors[0].team.$ref = 'https://example.invalid/teams/6'; },
    (value) => { value.plays.$ref = value.plays.$ref.replace('401873080', '401873081'); },
    (value) => { value.plays.items[0].$ref = 'https://example.invalid/play/1'; },
    (value) => { value.plays.pageCount = 2; },
    (value) => { value.plays.count++; },
    (value) => { value.plays.items[0].sequenceNumber = 'invalid'; },
  ]) {
    const changed = structuredClone(fixture); change(changed);
    assert.throws(() => normalizeCoreDetails(changed, context), TypeError);
  }
  assert.throws(() => normalizeCoreDetails(fixture, { ...context, key: '../401873080' }), TypeError);
});

test('all full-summary routes can fail while core recovers plays using two fixed requests, then one with cached identity', async () => {
  let now = NOW;
  const calls = [];
  const service = createGameDetailsService({ now: () => now, fetchImpl: async (url, options) => {
    calls.push(url);
    assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
    if (url === fixture._capture.eventUrl) return Response.json(fixture.event);
    if (url === fixture._capture.playsUrl) return Response.json(fixture.plays);
    return Response.json({}, { status: 503 });
  } });
  const data = await service({ gameId: context.key });
  assert.equal(data.sourceId, 'espn-core'); assert.equal(data.feedStatus, 'backup'); assert.equal(data.stale, false);
  assert.equal(data.statsStale, true); assert.equal(calls.length, 5);
  now += 1001;
  await service({ gameId: context.key });
  assert.deepEqual(calls.slice(5), [fixture._capture.playsUrl]);
});

test('play-only frames still honor HTTP Age and do not become fresh just because current period is unknown', async () => {
  for (const age of ['6', '46']) {
    const service = createGameDetailsService({ now: () => NOW, fetchImpl: async (url) => {
      if (url === fixture._capture.eventUrl) return Response.json(fixture.event, { headers: { Age: '120' } });
      if (url === fixture._capture.playsUrl) return Response.json(fixture.plays, { headers: { Age: age } });
      return Response.json({}, { status: 503 });
    } });
    if (age === '46') await assert.rejects(service({ gameId: context.key }));
    else {
      const data = await service({ gameId: context.key });
      assert.equal(data.stale, true); assert.equal(data.fetchedAt, new Date(NOW - 6000).toISOString());
      assert.equal(data.statsStale, true);
    }
  }
});

test('core↔full and cross-server core play order cannot regress without a current period, while caught-up full summaries recover', () => {
  const core = { ...normalizeCoreDetails(fixture, context), sourceId: 'espn-core' };
  const oldFull = { ...known(), sourceId: 'espn-web', fetchedAt: new Date(NOW + 2000).toISOString(), sourceUpdatedAt: new Date(NOW + 2000).toISOString() };
  assert.equal(snapshotIsOlder(oldFull, core, NOW + 2000), true);
  const oldCore = { ...core, fetchedAt: new Date(NOW + 2000).toISOString(), lastPlay: oldFull.lastPlay, eventPlays: oldFull.eventPlays, recentPlays: oldFull.recentPlays };
  assert.equal(snapshotIsOlder(oldCore, core, NOW + 2000), true);
  const recovered = { ...oldFull, lastPlay: core.lastPlay, recentPlays: core.recentPlays, eventPlays: core.eventPlays, statsStale: false };
  assert.equal(snapshotIsOlder(recovered, core, NOW + 2000), false);
  assert.equal(retainKnownStats(recovered, core), recovered);
  const olderHttpNewerPlays = { ...core, fetchedAt: new Date(NOW - 6000).toISOString() };
  assert.equal(snapshotIsOlder(olderHttpNewerPlays, oldFull, NOW + 2000), false, 'Known newer plays outrank fetch age, with delay labeled independently.');
});

test('a cold server’s partial response keeps browser-known totals, then full-summary recovery clears the stats delay', async () => {
  let now = NOW, calls = 0;
  const previous = { ...known(), fetchedAt: new Date(now).toISOString(), sourceId: 'espn-site' };
  const core = { ...normalizeCoreDetails(fixture, { ...context, fetchedAt: new Date(now + 2000).toISOString() }), sourceId: 'espn-core' };
  const full = { ...previous, fetchedAt: new Date(now + 4000).toISOString(), sourceUpdatedAt: new Date(now + 4000).toISOString(), lastPlay: core.lastPlay, recentPlays: core.recentPlays, eventPlays: core.eventPlays };
  const poller = new GameDetailsPoller({ now: () => now, fetcher: async () => Response.json([previous, core, full][calls++]) });
  try {
    poller.setGame(context.key); poller.start(); await turn();
    now += 2000; await poller.refresh();
    assert.equal(poller.state.data.statsStale, true); assert.equal(Boolean(poller.state.data.stale), false);
    assert.deepEqual(poller.state.data.teamStats, previous.teamStats);
    assert.equal(poller.state.data.statsFetchedAt, previous.statsFetchedAt);
    now += 2000; await poller.refresh();
    assert.equal(poller.state.data.dataScope, 'full'); assert.equal(poller.state.data.statsStale, false);
  } finally { poller.stop(); }
});

test('the core loader never follows references and rejects a mismatched identity before it can be cached', async () => {
  const source = createCoreDetailsSource();
  const calls = [];
  const altered = structuredClone(fixture.event); altered.id = '999';
  await assert.rejects(source.load({ key: context.key, sourceUrl: fixture._capture.playsUrl, now: () => NOW,
    requestJson: async (url) => { calls.push(url); return url === fixture._capture.eventUrl ? altered : fixture.plays; } }));
  assert.deepEqual(calls.sort(), [fixture._capture.eventUrl, fixture._capture.playsUrl].sort());
});
