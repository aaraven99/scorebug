import test from 'node:test';
import assert from 'node:assert/strict';
import { selectGame, feedIsStale, gameLabel, ScoreboardPoller } from '../public/score-client.js';

const NOW = Date.parse('2026-11-26T19:00:00Z');
function game(id, { away = 'CHI', home = 'DET', phase = 'live', startTime = '2026-11-26T18:00:00Z' } = {}) {
  return {
    id,
    away: { abbreviation: away, score: 0 },
    home: { abbreviation: home, score: 3 },
    phase,
    state: phase === 'scheduled' ? 'pre' : phase === 'final' ? 'post' : 'in',
    isLive: phase === 'live',
    startTime,
  };
}

test('automatic selection follows the Bears even when another live game is listed first', () => {
  const other = game('1', { away: 'PHI', home: 'DAL' });
  const bears = game('2');
  assert.equal(selectGame([other, bears], {}, NOW), bears);
});

test('an explicit game selection wins, and a missing pinned game does not silently switch teams', () => {
  const bears = game('1');
  const chosen = game('2', { away: 'KC', home: 'BUF' });
  assert.equal(selectGame([bears, chosen], { gameId: '2' }, NOW), chosen);
  assert.equal(selectGame([bears, chosen], { gameId: '999' }, NOW), null);
  assert.equal(selectGame([], {}, NOW), null);
  assert.equal(selectGame(undefined, {}, NOW), null);
});

test('live games take priority over upcoming games when the favorite is absent', () => {
  const upcoming = game('1', { away: 'PHI', home: 'DAL', phase: 'scheduled', startTime: '2026-11-26T21:30:00Z' });
  const live = game('2', { away: 'KC', home: 'BUF' });
  assert.equal(selectGame([upcoming, live], {}, NOW), live);
});

test('halftime and quarter breaks keep the current game selected', () => {
  const upcoming = game('1', { phase: 'scheduled', startTime: '2026-12-03T18:00:00Z' });
  for (const phase of ['halftime', 'intermission']) {
    const current = game('2', { phase });
    assert.equal(selectGame([upcoming, current], {}, NOW), current);
  }
});

test('a delayed or suspended in-state game is not mistaken for active live play', () => {
  const upcoming = game('1', { phase: 'scheduled', startTime: '2026-11-26T21:30:00Z' });
  for (const phase of ['delayed', 'suspended']) {
    const paused = game('2', { phase });
    assert.equal(paused.state, 'in');
    assert.equal(selectGame([paused, upcoming], {}, NOW), upcoming);
  }
});

test('the next scheduled game is chosen in time order without mutating the schedule', () => {
  const later = game('1', { phase: 'scheduled', startTime: '2026-12-03T18:00:00Z' });
  const next = game('2', { phase: 'scheduled', startTime: '2026-11-26T21:30:00Z' });
  const schedule = [later, next];
  assert.equal(selectGame(schedule, {}, NOW), next);
  assert.deepEqual(schedule, [later, next]);
});

test('freshness depends on last checked time and immediately flags failed or unknown checks', () => {
  const fresh = { fetchedAt: new Date(NOW - 10_000).toISOString() };
  const old = { fetchedAt: new Date(NOW - 45_001).toISOString() };
  assert.equal(feedIsStale(fresh, false, NOW), false);
  assert.equal(feedIsStale(old, false, NOW), true);
  assert.equal(feedIsStale(fresh, true, NOW), true);
  assert.equal(feedIsStale(null, false, NOW), true);
  assert.equal(feedIsStale({ fetchedAt: 'invalid date' }, false, NOW), true);
});

test('game labels preserve real zero scores and distinguish unavailable scores', () => {
  assert.equal(gameLabel(game('1')), 'CHI 0 · DET 3');
  const missing = game('2');
  missing.home.score = null;
  assert.equal(gameLabel(missing), 'CHI 0 · DET –');
});

test('stopping an in-flight poller and restarting it resumes successful updates', async () => {
  const names = ['document', 'addEventListener', 'removeEventListener', 'fetch'];
  const originals = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const documentEvents = new EventTarget();
  documentEvents.baseURI = 'https://scorebug.example/';
  documentEvents.hidden = false;
  const windowEvents = new EventTarget();
  const payload = { games: [game('1')], fetchedAt: new Date(NOW).toISOString() };
  const updates = [];
  let requests = 0;
  let firstWasAborted = false;
  let poller;
  try {
    Object.defineProperties(globalThis, {
      document: { configurable: true, writable: true, value: documentEvents },
      addEventListener: { configurable: true, writable: true, value: windowEvents.addEventListener.bind(windowEvents) },
      removeEventListener: { configurable: true, writable: true, value: windowEvents.removeEventListener.bind(windowEvents) },
      fetch: { configurable: true, writable: true, value: async (_url, { signal }) => {
        requests += 1;
        if (requests === 1) {
          await new Promise((_resolve, reject) => signal.addEventListener('abort', () => {
            firstWasAborted = true;
            reject(new DOMException('Aborted', 'AbortError'));
          }, { once: true }));
        }
        return { ok: true, json: async () => payload };
      } },
    });
    poller = new ScoreboardPoller({ onUpdate: (update) => updates.push(update) });
    poller.start();
    poller.stop();
    poller.start();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(firstWasAborted, true);
    assert.equal(requests, 2, 'Restart must start a new request instead of remaining stuck in-flight');
    assert.equal(updates.length, 1, 'An aborted previous generation must not publish an error');
    assert.equal(updates[0].error, null);
    assert.deepEqual(updates[0].data, payload);
    assert.equal(poller.inFlight, false);
  } finally {
    poller?.stop();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});
