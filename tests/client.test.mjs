import test from 'node:test';
import assert from 'node:assert/strict';
import { selectGame, isActiveGame, activeGames, DEFAULT_PREFERENCES, feedIsStale, gameLabel, ScoreboardPoller, isSupportedGameId, reconcileGameIdentity, readCachedScoreboard, writeCachedScoreboard, SCOREBOARD_CACHE_KEY, SCOREBOARD_CACHE_MAX_AGE_MS, initializePreferences, getPreferences, updatePreferences } from '../public/score-client.js';

const NOW = Date.parse('2026-11-26T19:00:00Z');
const TEAM_IDS = { CHI: '3', DET: '8', PHI: '21', DAL: '6', KC: '12', BUF: '2', SF: '25', GB: '9' };
function game(id, { away = 'CHI', home = 'DET', phase = 'live', startTime = '2026-11-26T18:00:00Z' } = {}) {
  return {
    id,
    away: { id: TEAM_IDS[away], abbreviation: away, score: 0 },
    home: { id: TEAM_IDS[home], abbreviation: home, score: 3 },
    phase,
    state: phase === 'scheduled' ? 'pre' : phase === 'final' ? 'post' : 'in',
    isLive: phase === 'live',
    startTime,
  };
}

test('Automatic has no favorite and chooses an active game over legacy Bears preferences', () => {
  assert.equal(DEFAULT_PREFERENCES.team, null);
  assert.equal(DEFAULT_PREFERENCES.gameId, null);
  assert.equal(DEFAULT_PREFERENCES.date, null);
  const other = game('1', { away: 'PHI', home: 'DAL' });
  for (const phase of ['scheduled', 'final', 'delayed', 'suspended']) {
    const bears = game('2', { phase });
    assert.equal(selectGame([bears, other], { gameId: null, team: 'CHI' }, NOW), other);
    assert.equal(selectGame([other, bears], {}, NOW), other);
  }
});

test('an explicit game selection wins, and a missing pinned game does not silently switch teams', () => {
  const bears = game('1');
  const chosen = game('2', { away: 'KC', home: 'BUF', phase: 'final' });
  assert.equal(selectGame([bears, chosen], { gameId: '2' }, NOW), chosen);
  assert.equal(selectGame([bears, chosen], { gameId: '999' }, NOW), null);
  assert.equal(selectGame([], {}, NOW), null);
  assert.equal(selectGame(undefined, {}, NOW), null);
});

test('live games take priority over upcoming games without team preference', () => {
  const upcoming = game('1', { away: 'PHI', home: 'DAL', phase: 'scheduled', startTime: '2026-11-26T21:30:00Z' });
  const live = game('2', { away: 'KC', home: 'BUF' });
  assert.equal(selectGame([upcoming, live], {}, NOW), live);
});

test('halftime and quarter breaks keep the current game selected', () => {
  const upcoming = game('1', { phase: 'scheduled', startTime: '2026-12-03T18:00:00Z' });
  const otherLive = game('3', { away: 'PHI', home: 'DAL', startTime: '2026-11-26T18:30:00Z' });
  for (const phase of ['halftime', 'intermission']) {
    const current = game('2', { phase });
    assert.equal(selectGame([upcoming, otherLive, current], {}, NOW), current);
  }
});

test('active-game classification excludes delayed, suspended, pregame and final even with an inconsistent live flag', () => {
  for (const phase of ['live', 'halftime', 'intermission']) assert.equal(isActiveGame(game('1', { phase })), true);
  for (const phase of ['scheduled', 'final', 'delayed', 'suspended', 'postponed', 'canceled', 'unknown']) {
    assert.equal(isActiveGame({ ...game('1', { phase }), isLive: true }), false, phase);
  }
  for (const state of ['pre', 'post']) assert.equal(isActiveGame({ ...game('1'), state }), false);
  assert.equal(isActiveGame(null), false);
  assert.equal(isActiveGame({ isLive: true, state: 'in' }), false);
});

test('Automatic keeps a stable fixture when active games reorder or provider IDs change', () => {
  const early = game('99', { away: 'PHI', home: 'DAL', startTime: '2026-11-26T17:00:00Z' });
  const later = game('1', { startTime: '2026-11-26T18:00:00Z' });
  assert.equal(selectGame([later, early], { team: 'CHI' }, NOW), early);
  assert.equal(selectGame([early, later], { team: 'CHI' }, NOW), early);
  const tied = [game('300', { away: 'PHI', home: 'DAL' }), game('200', { away: 'KC', home: 'BUF' }), game('100')];
  const chosen = selectGame(tied, {}, NOW);
  assert.equal(activeGames(tied)[0], chosen, 'The Live now list uses the same order as Automatic.');
  assert.equal(selectGame([...tied].reverse(), {}, NOW), chosen);
  assert.equal(selectGame([tied[1], tied[2], tied[0]], {}, NOW), chosen);
  const backup = [...tied].reverse().map((value, index) => ({ ...value, id: `thescore-${index + 1}` }));
  const chosenBackup = selectGame(backup, {}, NOW);
  assert.equal(chosenBackup.away.id, chosen.away.id);
  assert.equal(chosenBackup.home.id, chosen.home.id);
  assert.deepEqual(tied.map((value) => value.id), ['300', '200', '100'], 'Automatic must not reorder the source schedule.');
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

test('without an active or upcoming game, Automatic chooses the latest result without a favorite bias', () => {
  const bears = game('1', { phase: 'final', startTime: '2026-11-19T18:00:00Z' });
  const latest = game('2', { away: 'PHI', home: 'DAL', phase: 'final', startTime: '2026-11-26T17:00:00Z' });
  const postponed = game('3', { away: 'KC', home: 'BUF', phase: 'postponed', startTime: '2026-11-28T18:00:00Z' });
  assert.equal(selectGame([bears, postponed, latest], { team: 'CHI' }, NOW), latest);
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
    poller = new ScoreboardPoller({ onUpdate: (update) => updates.push(update), now: () => NOW });
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

const turn = () => new Promise((resolve) => setImmediate(resolve));
const response = (data) => ({ ok: true, json: async () => data });
function memoryStorage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
}
function snapshot(games = [game('401873081')], extra = {}) {
  return { games, fetchedAt: new Date(NOW).toISOString(), source: 'ESPN', sourceId: 'espn-site', feedStatus: 'primary', stale: false, ...extra };
}

test('provider aliases preserve either pinned ID through backup and recovery without mutating source snapshots', () => {
  const primary = game('401873081');
  const backup = { ...game('thescore-140742'), detailsGameId: null };
  const next = reconcileGameIdentity([backup], [primary]);
  assert.deepEqual(next[0].idAliases, ['401873081']);
  assert.equal(next[0].id, 'thescore-140742');
  assert.equal(next[0].detailsGameId, null);
  assert.equal(selectGame(next, { gameId: '401873081' }), next[0]);
  const recovered = reconcileGameIdentity([primary], next);
  assert.deepEqual(recovered[0].idAliases, ['thescore-140742']);
  assert.equal(selectGame(recovered, { gameId: 'thescore-140742' }), recovered[0]);
  assert.equal(selectGame(recovered, { gameId: '401873081' }), recovered[0]);
  assert.equal(Object.hasOwn(primary, 'idAliases'), false);
  assert.equal(Object.hasOwn(backup, 'idAliases'), false);
});

test('FOX IDs stay bounded and preserve explicit pins through cache restoration and ESPN recovery', () => {
  assert.equal(isSupportedGameId('fox-11284'), true);
  for (const id of ['fox-', 'fox-../11284', 'fox-abc', 'fox-1234567890123456', 'fox-1?game=2']) assert.equal(isSupportedGameId(id), false);
  const primary = game('401873081');
  const fox = { ...game('fox-11284'), detailsGameId: null };
  const backed = reconcileGameIdentity([fox], [primary]);
  assert.equal(selectGame(backed, { gameId: primary.id }).id, fox.id);
  const storage = memoryStorage();
  assert.equal(writeCachedScoreboard(null, snapshot(backed, { sourceId: 'fox', source: 'FOX Sports', feedStatus: 'backup' }), { storage, now: NOW }), true);
  const restored = readCachedScoreboard(null, { storage, now: NOW });
  assert.equal(selectGame(restored.games, { gameId: primary.id }).id, fox.id);
  const recovered = reconcileGameIdentity([primary], restored.games);
  assert.equal(selectGame(recovered, { gameId: fox.id }).id, primary.id);
});

test('aliases require the exact home/away IDs and a unique kickoff match within five minutes', () => {
  const original = game('401873081');
  const changed = [
    game('thescore-1', { away: 'DET', home: 'CHI' }),
    game('thescore-2', { away: 'PHI', home: 'DAL' }),
    game('thescore-3', { startTime: '2026-12-03T18:00:00Z' }),
    game('thescore-4', { startTime: '2026-11-26T18:05:01Z' }),
    { ...game('thescore-5'), startTime: null },
    { ...game('thescore-6'), away: { abbreviation: 'CHI' } },
  ];
  for (const candidate of changed) {
    const result = reconcileGameIdentity([candidate], [original]);
    assert.equal(selectGame(result, { gameId: original.id }), null);
  }
  const within = reconcileGameIdentity([game('thescore-7', { startTime: '2026-11-26T18:05:00Z' })], [original]);
  assert.equal(selectGame(within, { gameId: original.id }), within[0]);
  const ambiguous = reconcileGameIdentity([game('thescore-8')], [original, game('401873082')]);
  assert.equal(selectGame(ambiguous, { gameId: original.id }), null);
  const duplicateIncoming = reconcileGameIdentity([game('thescore-8'), game('thescore-9')], [original]);
  assert.equal(selectGame(duplicateIncoming, { gameId: original.id }), null);
  const ambiguousAliases = [game('thescore-10'), game('thescore-11')].map((value) => ({ ...value, idAliases: [original.id] }));
  assert.equal(selectGame(ambiguousAliases, { gameId: original.id }), null);
});

test('aliases are bounded and reject unsupported IDs and the game’s own ID', () => {
  const source = { ...game('thescore-12'), idAliases: ['thescore-12', '401', '401', 'thescore-13', 'https://evil.example', 'espn-99', 'thescore-abc', '402', '403', '404'] };
  const [result] = reconcileGameIdentity([source]);
  assert.deepEqual(result.idAliases, ['401', 'thescore-13', '402', '403']);
  assert.equal(isSupportedGameId('thescore-140742'), true);
  assert.equal(isSupportedGameId('401873081'), true);
  for (const id of ['thescore-', 'thescore-abc', 'thescore-1234567890123456', '../401873081', 401873081]) assert.equal(isSupportedGameId(id), false);
});

test('query preferences accept a bounded provider ID and reject unrelated namespaces', async () => {
  const prior = getPreferences(), original = Object.getOwnPropertyDescriptor(globalThis, 'location');
  try {
    Object.defineProperty(globalThis, 'location', { configurable: true, value: { search: '?game=thescore-140742&date=20261126' } });
    let next = await initializePreferences();
    assert.equal(next.gameId, 'thescore-140742');
    assert.equal(next.date, '20261126');
    globalThis.location.search = '?game=other-provider-140742';
    next = await initializePreferences();
    assert.equal(next.gameId, 'thescore-140742');
  } finally {
    await updatePreferences(prior);
    if (original) Object.defineProperty(globalThis, 'location', original); else delete globalThis.location;
  }
});

test('fresh backups are healthy while explicit stale/cached flags override a recent timestamp', () => {
  assert.equal(feedIsStale(snapshot([], { sourceId: 'thescore', feedStatus: 'backup' }), false, NOW), false);
  assert.equal(feedIsStale(snapshot([], { stale: true }), false, NOW), true);
  assert.equal(feedIsStale(snapshot([], { feedStatus: 'cached' }), false, NOW), true);
  assert.equal(feedIsStale(snapshot([], { fetchedAt: new Date(NOW + 60001).toISOString() }), false, NOW), true);
});

test('browser restoration is date-isolated, always stale, and retains source, aliases, and original fetchedAt', () => {
  const storage = memoryStorage();
  const data = snapshot([{ ...game('thescore-140742'), idAliases: ['401873081'], detailsGameId: null }], { sourceId: 'thescore', source: 'theScore', feedStatus: 'backup' });
  assert.equal(writeCachedScoreboard('20261126', data, { storage, now: NOW }), true);
  const restored = readCachedScoreboard('20261126', { storage, now: NOW + 15000 });
  assert.equal(restored.fetchedAt, data.fetchedAt);
  assert.equal(restored.sourceId, 'thescore');
  assert.equal(restored.stale, true);
  assert.equal(restored.feedStatus, 'cached');
  assert.equal(restored.cacheOrigin, 'browser');
  assert.equal(selectGame(restored.games, { gameId: '401873081' }).id, 'thescore-140742');
  assert.equal(readCachedScoreboard('20261127', { storage, now: NOW }), null);
  assert.equal(readCachedScoreboard(null, { storage, now: NOW }), null);
  assert.equal(readCachedScoreboard('invalid', { storage, now: NOW }), null);
  assert.equal(data.stale, false);
});

test('local snapshots expire after six hours based on fetchedAt, even when repeatedly saved as cached', () => {
  const storage = memoryStorage();
  const data = snapshot();
  writeCachedScoreboard(null, data, { storage, now: NOW });
  const almostExpired = { ...data, stale: true, feedStatus: 'cached', checkedAt: new Date(NOW + SCOREBOARD_CACHE_MAX_AGE_MS - 1).toISOString() };
  writeCachedScoreboard(null, almostExpired, { storage, now: NOW + SCOREBOARD_CACHE_MAX_AGE_MS - 1 });
  assert.equal(readCachedScoreboard(null, { storage, now: NOW + SCOREBOARD_CACHE_MAX_AGE_MS }).fetchedAt, data.fetchedAt);
  assert.equal(readCachedScoreboard(null, { storage, now: NOW + SCOREBOARD_CACHE_MAX_AGE_MS + 1 }), null);
  assert.equal(writeCachedScoreboard(null, data, { storage, now: NOW + SCOREBOARD_CACHE_MAX_AGE_MS + 1 }), false);
});

test('storage keeps only eight dates and a late cached server response cannot overwrite newer saved scores', () => {
  const storage = memoryStorage();
  for (let index = 0; index < 9; index++) {
    const clock = NOW + index * 1000;
    assert.equal(writeCachedScoreboard(`202611${10 + index}`, snapshot([game(String(index + 1))], { fetchedAt: new Date(clock).toISOString() }), { storage, now: clock }), true);
  }
  assert.equal(JSON.parse(storage.getItem(SCOREBOARD_CACHE_KEY)).entries.length, 8);
  assert.equal(readCachedScoreboard('20261110', { storage, now: NOW + 9000 }), null);
  const newest = readCachedScoreboard('20261118', { storage, now: NOW + 9000 });
  assert.equal(writeCachedScoreboard('20261118', snapshot([game('99')], { feedStatus: 'cached', stale: true }), { storage, now: NOW + 10000 }), false);
  assert.equal(readCachedScoreboard('20261118', { storage, now: NOW + 10000 }).fetchedAt, newest.fetchedAt);
  assert.equal(readCachedScoreboard('20261118', { storage, now: NOW + 10000 }).games[0].id, '9');
});

test('corrupt, blocked, oversized, or unavailable browser storage cannot break score polling', async () => {
  const corrupt = { getItem: () => '{bad JSON', setItem: () => { throw new Error('Quota exceeded'); } };
  const blocked = { getItem: () => { throw new Error('Storage disabled'); }, setItem: () => { throw new Error('Storage disabled'); } };
  const oversized = { getItem: () => 'x'.repeat(750001), setItem: () => { throw new Error('Quota exceeded'); } };
  for (const storage of [null, corrupt, blocked, oversized]) {
    assert.equal(readCachedScoreboard(null, { storage, now: NOW }), null);
    assert.equal(writeCachedScoreboard(null, snapshot(), { storage, now: NOW }), false);
    const poller = new ScoreboardPoller({ storage, now: () => NOW, fetcher: async () => response(snapshot()) });
    try { poller.start(); await turn(); assert.equal(poller.data.games[0].id, '401873081'); assert.equal(poller.error, null); }
    finally { poller.stop(); }
  }
});

test('a local restoration is published as loading/stale and never as a successful network check', async () => {
  const storage = memoryStorage(), updates = [];
  const saved = snapshot([game('401873081')], { fetchedAt: new Date(NOW - 120000).toISOString() });
  writeCachedScoreboard(null, saved, { storage, now: NOW });
  let rejectRequest;
  const poller = new ScoreboardPoller({ storage, now: () => NOW, onUpdate: (value) => updates.push(value), fetcher: () => new Promise((_resolve, reject) => { rejectRequest = reject; }) });
  try {
    poller.start();
    assert.equal(updates.length, 1);
    assert.equal(updates[0].loading, true);
    assert.equal(updates[0].data.stale, true);
    assert.equal(updates[0].data.fetchedAt, saved.fetchedAt);
    rejectRequest(new Error('Offline')); await turn();
    assert.equal(updates.at(-1).loading, false);
    assert.equal(updates.at(-1).error.message, 'Offline');
    assert.equal(updates.at(-1).data.fetchedAt, saved.fetchedAt);
  } finally { poller.stop(); }
});

test('primary failure, cached response, independent backup, and primary recovery preserve accurate freshness and pins', async () => {
  const storage = memoryStorage(); let clock = NOW;
  const primary = snapshot();
  const cached = snapshot([game('401873081')], { fetchedAt: new Date(NOW - 60000).toISOString(), feedStatus: 'cached', stale: true });
  const backup = snapshot([{ ...game('thescore-140742'), detailsGameId: null }], { fetchedAt: new Date(NOW + 5000).toISOString(), sourceId: 'thescore', source: 'theScore', feedStatus: 'backup' });
  const recovered = snapshot([game('401873081')], { fetchedAt: new Date(NOW + 10000).toISOString() });
  const pending = [primary, new Error('Upstream offline'), cached, backup, recovered];
  const poller = new ScoreboardPoller({ storage, now: () => clock, fetcher: async () => { const next = pending.shift(); if (next instanceof Error) throw next; return response(next); } });
  try {
    poller.start(); await turn(); assert.equal(poller.failures, 0);
    await poller.refresh(); assert.equal(poller.failures, 1); assert.equal(poller.data.stale, true); assert.equal(poller.error.message, 'Upstream offline');
    await poller.refresh(); assert.equal(poller.failures, 2); assert.equal(poller.error, null); assert.equal(poller.data.feedStatus, 'cached');
    assert.equal(poller.data.fetchedAt, primary.fetchedAt, 'An older server cache cannot replace the newer known snapshot');
    clock += 5000; await poller.refresh(); assert.equal(poller.failures, 0); assert.equal(poller.error, null); assert.equal(feedIsStale(poller.data, false, clock), false);
    assert.equal(poller.data.sourceId, 'thescore'); assert.equal(selectGame(poller.data.games, { gameId: '401873081' }).id, 'thescore-140742');
    clock += 5000; await poller.refresh(); assert.equal(poller.data.sourceId, 'espn-site'); assert.equal(selectGame(poller.data.games, { gameId: 'thescore-140742' }).id, '401873081');
    const restored = readCachedScoreboard(null, { storage, now: clock });
    assert.equal(selectGame(restored.games, { gameId: 'thescore-140742' }).id, '401873081'); assert.equal(restored.fetchedAt, recovered.fetchedAt);
    assert.equal(primary.stale, false, 'Marking retained data stale must not mutate a received snapshot');
  } finally { poller.stop(); }
});

test('a cached response on first load remains stale with a retry pending, then a fresh backup recovers', async () => {
  let request = 0;
  const cached = snapshot([], { fetchedAt: new Date(NOW - 60000).toISOString(), stale: true, feedStatus: 'cached' });
  const healthy = snapshot([], { sourceId: 'espn-web', feedStatus: 'backup' });
  const poller = new ScoreboardPoller({ storage: memoryStorage(), now: () => NOW, fetcher: async () => response(request++ ? healthy : cached) });
  try {
    poller.start(); await turn();
    assert.equal(poller.error, null); assert.equal(poller.failures, 1); assert.equal(poller.data.fetchedAt, cached.fetchedAt); assert.equal(poller.data.stale, true); assert.ok(poller.timer);
    await poller.refresh(); assert.equal(poller.failures, 0); assert.equal(poller.data.stale, false); assert.equal(poller.data.feedStatus, 'backup');
  } finally { poller.stop(); }
});

test('switching dates restores only that date and discards a late old-date response even when it ignores abort', async () => {
  const storage = memoryStorage(), requests = [], updates = [];
  writeCachedScoreboard('20261126', snapshot([game('1')]), { storage, now: NOW });
  writeCachedScoreboard('20261127', snapshot([game('2', { away: 'KC', home: 'BUF' })]), { storage, now: NOW });
  const poller = new ScoreboardPoller({ date: '20261126', storage, now: () => NOW, onUpdate: value => updates.push(value), fetcher: (url, options) => new Promise(resolve => requests.push({ url, options, resolve })) });
  try {
    poller.start(); assert.equal(updates.at(-1).data.games[0].id, '1');
    poller.setDate('20261127'); assert.equal(updates.at(-1).data.games[0].id, '2'); assert.equal(updates.at(-1).data.stale, true);
    assert.equal(requests[0].options.signal.aborted, true);
    assert.equal(requests[1].url.searchParams.get('date'), '20261127');
    requests[0].resolve(response(snapshot([game('99')]))); await turn(); assert.equal(poller.data.games[0].id, '2');
    requests[1].resolve(response(snapshot([game('2', { away: 'KC', home: 'BUF' })]))); await turn(); assert.equal(poller.data.stale, false); assert.equal(poller.data.games[0].id, '2');
    poller.stop(); poller.setDate('20261128'); assert.equal(poller.data, null); assert.equal(updates.at(-1).loading, true);
  } finally { poller.stop(); }
});
