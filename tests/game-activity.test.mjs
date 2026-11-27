import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameActivity } from '../public/game-activity.js';

const NOW = Date.parse('2026-11-26T20:00:00Z');
const turn = () => new Promise((resolve) => setImmediate(resolve));
const iso = (value) => new Date(value).toISOString();
function game(score = 0, id = '401873081') {
  return { id, phase: 'live', period: 3, clock: '10:00',
    away: { id: '3', abbreviation: 'CHI', score }, home: { id: '8', abbreviation: 'DET', score: 0 },
    lastPlayDetails: { id: '100', type: 'Rush', typeId: '5', text: 'A reported rush.', yardsGained: 3, scoringPlay: false, isTurnover: false, offenseTeamId: '3', teamId: '3' } };
}
function touchdown(id, total, now = NOW) {
  return { id: String(id), type: 'Rushing Touchdown', typeId: '68', text: 'Rushing touchdown. Extra point good.',
    scoringType: 'touchdown', scoringPlay: true, scoringTeamId: '3', offenseTeamId: '3', teamId: '3',
    scores: { away: total, home: 0 }, pointAfterAttempt: { typeId: '61', type: 'Extra Point Good', points: 1 },
    isTurnover: false, yardsGained: 5, wallclock: iso(now) };
}

function harness(t) {
  let now = NOW, timerId = 0;
  const timers = new Map(), requests = [], events = [], resets = [];
  t.mock.method(Date, 'now', () => now);
  // Drive network completions and elapsed time explicitly; no real timers or
  // network calls are needed to reproduce cross-feed races and suspension.
  t.mock.method(globalThis, 'setTimeout', (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; });
  t.mock.method(globalThis, 'clearTimeout', (id) => timers.delete(id));
  t.mock.method(globalThis, 'fetch', function (url, options) {
    // Browser fetch must keep its Window/global receiver. A detached native
    // fetch stored as `this.fetcher` would fail this check with illegal invocation.
    assert.equal(this, globalThis);
    return new Promise((resolve, reject) => requests.push({ url, options, resolve, reject }));
  });
  const activity = createGameActivity({ onEvents: (next, current) => events.push(...next.map((event) => ({ ...event, displayedGameId: current.id }))), onReset: () => resets.push(now) });
  t.after(() => activity.stop());
  return {
    activity, requests, events, resets,
    get now() { return now; },
    at(elapsed) { now = NOW + elapsed; },
    set(current, context = 'current', stamp = now, feed = {}) { activity.setGame(current, context, stamp === null ? null : iso(stamp), feed); },
    async resolve(index, plays = [], id = '401873081') {
      requests[index].resolve({ ok: true, json: async () => ({ gameId: id, fetchedAt: iso(now), teamStats: [], eventPlays: plays }) });
      await turn();
    },
    async fail(index) { requests[index].reject(new Error('Feed unavailable')); await turn(); },
  };
}

test('startup waits for a primary game, hydrates silently, and uses browser-safe fetch binding', async (t) => {
  const h = harness(t); h.activity.start();
  assert.equal(h.requests.length, 0);
  h.set(game(7));
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url.searchParams.get('id'), '401873081');
  await h.resolve(0, [touchdown(200, 7)]);
  assert.deepEqual(h.events, []);
  h.at(1000); h.set(game(14)); h.activity.refresh();
  await h.resolve(1, [touchdown(300, 14, h.now)]);
  assert.deepEqual(h.events.map((event) => event.kind), ['touchdown', 'extra-point']);
});

test('summary-first scoring evidence waits for fresh primary points through the full activity bridge', async (t) => {
  const h = harness(t); h.activity.start(); h.set(game()); await h.resolve(0);
  h.at(1000); h.activity.refresh(); await h.resolve(1, [touchdown(200, 7, h.now)]);
  assert.deepEqual(h.events, []);
  h.at(2000); h.set(game(7));
  assert.deepEqual(h.events.map((event) => [event.kind, event.points]), [['touchdown', 6], ['extra-point', 1]]);
  h.at(12000); h.set(game(7));
  assert.equal(h.events.length, 2);
});

test('switching games rejects an aborted older summary and seeds the selected game silently', async (t) => {
  const h = harness(t); h.activity.start(); h.set(game());
  h.at(1000); h.set(game(7, '401873080'));
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[0].options.signal.aborted, true);
  await h.resolve(1, [touchdown(200, 7, h.now)], '401873080');
  await h.resolve(0, [touchdown(200, 7, h.now)]);
  assert.deepEqual(h.events, []);
  h.at(2000); h.set(game(14, '401873080')); h.activity.refresh();
  await h.resolve(2, [touchdown(300, 14, h.now)], '401873080');
  assert.deepEqual(h.events.map((event) => event.displayedGameId), ['401873080', '401873080']);
});

test('summary polling and preference rerenders cannot keep a stale primary baseline alive', async (t) => {
  const h = harness(t); h.activity.start(); h.set(game()); await h.resolve(0);
  const initialStamp = h.now;
  for (let index = 1; index <= 5; index++) {
    h.at(index * 10000);
    h.activity.refresh();
    await h.resolve(index, index >= 2 ? [touchdown(200, 7, NOW + 20000)] : []);
    // Moving/resizing the widget can call setGame with the same scoreboard.
    h.set(game(), 'current', initialStamp);
  }
  assert.deepEqual(h.events, []);
  h.at(60000); h.set(game(7));
  h.at(74000); h.set(game(7));
  assert.deepEqual(h.events, []);
  h.at(75000); h.set(game(14)); h.activity.refresh();
  await h.resolve(6, [touchdown(300, 14, h.now)]);
  assert.deepEqual(h.events.map((event) => event.kind), ['touchdown', 'extra-point']);
});

test('a summary arriving first after sleep cannot reseed old scores and produce a delayed generic celebration', async (t) => {
  const h = harness(t); h.activity.start(); h.set(game()); await h.resolve(0);
  h.at(60000); h.activity.refresh();
  await h.resolve(1, [touchdown(200, 7, h.now)]);
  h.at(61000); h.set(game(7));
  h.at(75000); h.set(game(7));
  assert.deepEqual(h.events, []);
});

test('stop/restart requires a fresh primary snapshot and ignores the old outstanding summary', async (t) => {
  const h = harness(t); h.activity.start(); h.set(game());
  h.activity.stop(); h.at(60000); h.activity.start();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].options.signal.aborted, true);
  h.set(game(7));
  assert.equal(h.requests.length, 2);
  await h.resolve(0, [touchdown(200, 7, h.now)]);
  await h.resolve(1, [touchdown(200, 7, h.now)]);
  h.at(75000); h.set(game(7));
  assert.deepEqual(h.events, []);
  assert.ok(h.resets.length >= 2);
});

test('failed summaries allow one generic score fallback and a late summary cannot repeat it', async (t) => {
  const h = harness(t); h.activity.start(); h.set(game()); await h.resolve(0);
  h.at(1000); h.set(game(7)); h.activity.refresh(); await h.fail(1);
  h.at(14000); h.set(game(7));
  assert.deepEqual(h.events.map((event) => [event.kind, event.points]), [['score', 7]]);
  h.at(15000); h.activity.refresh(); await h.resolve(2, [touchdown(200, 7, h.now)]);
  h.at(25000); h.set(game(7));
  assert.equal(h.events.length, 1);
});

test('changing date context reseeds even when the selected event ID remains the same', async (t) => {
  const h = harness(t); h.activity.start(); h.set(game(), '20261126'); await h.resolve(0);
  h.at(1000); h.set(game(7), 'current');
  h.activity.refresh(); await h.resolve(1, [touchdown(200, 7, h.now)]);
  h.at(15000); h.set(game(7), 'current');
  assert.deepEqual(h.events, []);
});

test('demo player data is available only from a fresh successful summary for the selected game', async (t) => {
  const h = harness(t); h.activity.start(); h.set(game());
  assert.equal(h.activity.getDetails(), null);
  await h.resolve(0);
  assert.equal(h.activity.getDetails().gameId, '401873081');
  h.at(1000); h.activity.refresh(); await h.fail(1);
  assert.equal(h.activity.getDetails(), null);
  h.activity.refresh(); await h.resolve(2);
  assert.equal(h.activity.getDetails().gameId, '401873081');
  h.at(47000);
  assert.equal(h.activity.getDetails(), null);
  h.set(game(7, '401873080'));
  assert.equal(h.activity.getDetails(), null);
  await h.resolve(3, [], '401873080');
  assert.equal(h.activity.getDetails().gameId, '401873080');
  h.activity.stop();
  assert.equal(h.activity.getDetails(), null);
});

test('feed switches and cached-score recovery reset celebrations without replaying old points', async (t) => {
  const h = harness(t); h.activity.start(); h.set(game()); await h.resolve(0);
  h.at(1000); h.set(game(7), 'current', h.now, { sourceId: 'espn-web' });
  h.activity.refresh(); await h.resolve(1, [touchdown(200, 7, h.now)]);
  h.at(14000); h.set(game(7), 'current', h.now, { sourceId: 'espn-web' });
  assert.deepEqual(h.events, []);
  h.at(15000); h.set(game(14), 'current', h.now, { sourceId: 'espn-web' });
  h.activity.refresh(); await h.resolve(2, [touchdown(300, 14, h.now)]);
  assert.deepEqual(h.events.map((event) => event.kind), ['touchdown', 'extra-point']);
  h.at(16000); h.set(game(14), 'current', h.now, { sourceId: 'espn-web', stale: true });
  assert.equal(h.activity.getDetails(), null);
  h.activity.refresh(); await h.resolve(3, [touchdown(400, 21, h.now)]);
  h.at(18000); h.set(game(21), 'current', h.now, { sourceId: 'espn-web' });
  h.at(32000); h.set(game(21), 'current', h.now, { sourceId: 'espn-web' });
  assert.equal(h.events.length, 2, 'Recovery establishes a new baseline instead of replaying outage scores');
  h.at(33000); h.set(game(21), 'current', h.now, { sourceId: 'espn-site' });
  h.at(47000); h.set(game(21));
  assert.equal(h.events.length, 2);
});

test('an independent provider ID never gets sent to the ESPN summary endpoint', async (t) => {
  const h = harness(t); h.activity.start();
  h.set({ ...game(7, 'thescore-140741'), detailsGameId: null }, 'current', h.now, { sourceId: 'thescore' });
  assert.equal(h.requests.length, 0);
  assert.equal(h.activity.getDetails(), null);
  h.at(1000); h.set(game(7)); await h.resolve(0);
  assert.equal(h.requests[0].url.searchParams.get('id'), '401873081');
  assert.deepEqual(h.events, []);
});

test('a cached summary cannot supply demo portraits or new play celebrations', async (t) => {
  const h = harness(t); h.activity.start(); h.set(game());
  h.requests[0].resolve({ ok: true, json: async () => ({ gameId: '401873081', fetchedAt: iso(h.now), stale: true, teamStats: [], eventPlays: [touchdown(200, 7)] }) });
  await turn();
  assert.equal(h.activity.getDetails(), null);
  assert.deepEqual(h.events, []);
});
