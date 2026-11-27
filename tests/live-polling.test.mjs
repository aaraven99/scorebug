import test from 'node:test';
import assert from 'node:assert/strict';
import { ScoreboardPoller, readCachedScoreboard } from '../public/score-client.js';
import { GameDetailsPoller } from '../public/game-details-client.js';

const NOW = Date.parse('2026-11-27T00:00:00Z');
const turn = () => new Promise((resolve) => setImmediate(resolve));
const snapshot = (kind, now, extra = {}) => ({
  fetchedAt: new Date(now).toISOString(), sourceId: 'espn-site', sourceUpdatedAt: new Date(now).toISOString(), stale: false, feedStatus: 'primary',
  ...(kind === 'scores' ? { games: [{ id: '1', away: { id: '3', score: 14 }, home: { id: '8', score: 7 }, period: 2, clock: '5:00', state: 'in' }] }
    : { gameId: '1', teamStats: [{ key: 'totalYards', away: '150', home: '120' }] }), ...extra,
});

for (const kind of ['scores', 'stats']) {
  const create = (options) => {
    const poller = kind === 'scores' ? new ScoreboardPoller({ storage: null, ...options }) : new GameDetailsPoller(options);
    if (kind === 'stats') poller.setGame('1');
    return poller;
  };
  const dataOf = (poller) => kind === 'scores' ? poller.data : poller.state.data;

  test(`${kind}: the two-second cadence includes request time, and a pending request never overlaps`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let now = NOW;
    const pending = [];
    const poller = create({ now: () => now, fetcher: () => new Promise((resolve) => pending.push(resolve)) });
    try {
      poller.start(); assert.equal(pending.length, 1);
      now += 800; t.mock.timers.tick(800);
      pending[0](Response.json(snapshot(kind, now))); await turn();
      now += 1199; t.mock.timers.tick(1199); await turn(); assert.equal(pending.length, 1);
      now += 1; t.mock.timers.tick(1); await turn(); assert.equal(pending.length, 2);
      now += 2000; t.mock.timers.tick(2000); await poller.refresh();
      assert.equal(pending.length, 2);
      assert.ok(dataOf(poller), 'A pending refresh keeps the previous data.');
    } finally { poller.stop(); }
  });

  test(`${kind}: throttling retains the last good values, honors Retry-After, then resumes at two seconds`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let now = NOW, calls = 0;
    const poller = create({ now: () => now, fetcher: async () => {
      calls++;
      if (calls === 2) return Response.json({ error: 'Try again later' }, { status: 429, headers: { 'Retry-After': new Date(NOW + 12000).toUTCString() } });
      return Response.json(snapshot(kind, now));
    } });
    try {
      poller.start(); await turn();
      const successful = dataOf(poller);
      await poller.refresh();
      assert.equal(poller.failures, 1);
      assert.equal(dataOf(poller).fetchedAt, successful.fetchedAt);
      assert.equal(dataOf(poller).stale, true);
      await poller.refresh(); assert.equal(calls, 2, 'Focus/manual refresh must not bypass provider throttling.');
      now += 11999; t.mock.timers.tick(11999); await turn(); assert.equal(calls, 2);
      now += 1; t.mock.timers.tick(1); await turn();
      assert.equal(calls, 3); assert.equal(poller.failures, 0); assert.equal(dataOf(poller).stale, false);
      now += 1999; t.mock.timers.tick(1999); await turn(); assert.equal(calls, 3);
      now += 1; t.mock.timers.tick(1); await turn(); assert.equal(calls, 4);
    } finally { poller.stop(); }
  });

  test(`${kind}: a new fetch of older provider data never replaces newer known information`, async () => {
    let now = NOW, calls = 0;
    const poller = create({ now: () => now, fetcher: async () => {
      calls++;
      return Response.json(snapshot(kind, now, calls === 2 ? { sourceId: 'espn-web', sourceUpdatedAt: new Date(NOW - 60000).toISOString() } : {}));
    } });
    try {
      poller.start(); await turn();
      const first = dataOf(poller);
      now += 2000; await poller.refresh();
      assert.equal(dataOf(poller).sourceId, 'espn-site');
      assert.equal(dataOf(poller).fetchedAt, first.fetchedAt);
      assert.equal(dataOf(poller).sourceUpdatedAt, first.sourceUpdatedAt);
      assert.equal(dataOf(poller).stale, true);
      now += 2000; await poller.refresh();
      assert.equal(dataOf(poller).fetchedAt, new Date(now).toISOString());
      assert.equal(poller.failures, 0);
    } finally { poller.stop(); }
  });
}

test('a proven newer scoreboard frame survives persistence and a later outage even when its HTTP snapshot is older', async () => {
  let now = NOW, calls = 0;
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const poller = new ScoreboardPoller({ storage, now: () => now, fetcher: async () => {
    calls++;
    if (calls > 2) throw new TypeError('offline');
    const newer = calls === 2;
    const data = snapshot('scores', newer ? NOW - 4000 : NOW, { sourceId: 'thescore', stale: newer, feedStatus: newer ? 'cached' : 'backup' });
    delete data.sourceUpdatedAt;
    data.games[0].sourceUpdatedAt = new Date(NOW - (newer ? 7000 : 20000)).toISOString();
    data.games[0].away.score = newer ? 21 : 14;
    return Response.json(data);
  } });
  try {
    poller.start(); await turn();
    now += 2000; await poller.refresh();
    assert.equal(poller.data.games[0].away.score, 21);
    assert.equal(poller.data.stale, true);
    assert.equal(readCachedScoreboard(null, { storage, now }).games[0].away.score, 21);
    now += 2000; await poller.refresh();
    assert.equal(poller.data.games[0].away.score, 21);
    assert.equal(poller.data.fetchedAt, new Date(NOW - 4000).toISOString());
  } finally { poller.stop(); }
});
