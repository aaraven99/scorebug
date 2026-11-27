import test from 'node:test';
import assert from 'node:assert/strict';
import { createFeedService } from '../lib/feed-service.mjs';
import { snapshotIsOlder, retryAfterMs } from '../public/feed-state.js';

const NOW = Date.parse('2026-11-27T00:00:00Z');
const turn = () => new Promise((resolve) => setImmediate(resolve));
const json = (data, init = {}) => Response.json(data, init);
const game = (overrides = {}) => ({ id: '1', startTime: '2026-11-26T23:00:00Z', state: 'in', phase: 'live', period: 2, clock: '5:00', away: { id: '3', score: 14 }, home: { id: '8', score: 7 }, ...overrides });
const payload = (overrides = {}) => ({ games: [game()], ...overrides });
class FeedError extends Error { constructor(message, options = {}) { super(message); Object.assign(this, options); } }
function service(options = {}) {
  return createFeedService({
    sources: ['primary', 'backup', 'other'].map((id) => ({ id, url: (key) => `https://${id}.example/${key}` })),
    normalize: (data, { fetchedAt }) => ({ ...data, fetchedAt }), ErrorType: FeedError,
    label: 'test feed', invalidCode: 'INVALID', unavailableCode: 'UNAVAILABLE', timeoutCode: 'TIMEOUT',
    now: () => NOW, ...options,
  });
}

test('a fast healthy primary never calls backups, and simultaneous readers share the one-second cache', async () => {
  let now = NOW;
  const calls = [];
  const read = service({ now: () => now, fetchImpl: async (url) => { calls.push(url); return json(payload()); } });
  const [a, b] = await Promise.all([read('current'), read('current')]);
  assert.equal(a, b);
  now += 999; assert.equal(await read('current'), a);
  now += 1; await read('current');
  now += 2000; await read('current');
  assert.deepEqual(calls, Array(3).fill('https://primary.example/current'));
});

test('a slow primary is hedged at 1.5 seconds, losers are aborted, and the working backup is reused', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let now = NOW, mode = 'fail';
  const calls = [], signals = [];
  const read = service({ now: () => now, fetchImpl: async (url, { signal }) => {
    calls.push(url); signals.push({ url, signal });
    if (url.includes('primary')) {
      if (mode === 'fail') return json({}, { status: 503 });
      if (mode === 'slow') return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    }
    return json(payload());
  } });
  assert.equal((await read('current')).sourceId, 'backup');
  now += 4001; mode = 'slow'; // The primary's previous failure entry has expired.
  const request = read('current'); await turn();
  const before = calls.length;
  t.mock.timers.tick(1499); await turn(); assert.equal(calls.length, before);
  t.mock.timers.tick(1); await turn();
  assert.equal((await request).sourceId, 'backup');
  assert.equal(signals.filter((item) => item.url.includes('primary')).at(-1).signal.aborted, true);
  now += 1001;
  const afterRace = calls.length;
  assert.equal((await read('current')).sourceId, 'backup');
  assert.deepEqual(calls.slice(afterRace), ['https://backup.example/current']);
  now += 10000; mode = 'healthy';
  assert.equal((await read('current')).sourceId, 'primary');
});

test('Retry-After is honored on cold requests and never delays a usable backup until the primary recovers', async () => {
  let now = NOW, backupHealthy = false;
  const calls = [];
  const read = service({ now: () => now, fetchImpl: async (url) => {
    calls.push(url);
    if (url.includes('primary')) return json({}, { status: 429, headers: { 'Retry-After': '120' } });
    if (backupHealthy) return json(payload());
    throw new TypeError('offline');
  } });
  await assert.rejects(read('current'), (error) => error.retryAfterMs === 4000);
  assert.equal(calls.length, 3);
  now += 1000;
  await assert.rejects(read('different-date'), (error) => error.statusCode === 503 && error.retryAfterMs === 3000);
  assert.equal(calls.length, 3, 'A cold new key must not bypass source throttling.');
  now += 3000; backupHealthy = true;
  assert.equal((await read('current')).feedStatus, 'backup');
  assert.equal(calls.filter((url) => url.includes('primary')).length, 1);
  assert.equal(retryAfterMs(new Date(NOW + 120000).toUTCString(), NOW), 120000);
  assert.equal(retryAfterMs('120', NOW), 120000);
  assert.equal(retryAfterMs('not a date', NOW), 0);
});

test('slightly aged live data tries fresh backups, then can show an honestly delayed cold-start score', async () => {
  const calls = [];
  const read = service({ fetchImpl: async (url) => {
    calls.push(url);
    if (url.includes('other')) return json({}, { status: 503 });
    return json(payload(), { headers: { Age: url.includes('primary') ? '20' : '6' } });
  } });
  const data = await read('current');
  assert.equal(calls.length, 3);
  assert.equal(data.sourceId, 'backup');
  assert.equal(data.stale, true); assert.equal(data.feedStatus, 'cached');
  assert.equal(data.fetchedAt, new Date(NOW - 6000).toISOString());
  assert.equal(data.checkedAt, new Date(NOW).toISOString());
  assert.equal(data.games[0].away.score, 14);
  const fresh = service({ fetchImpl: async (url) => json(payload(), { headers: url.includes('primary') ? { Age: '6' } : {} }) });
  assert.equal((await fresh('current')).stale, false, 'An aged candidate must never beat a fresh backup.');
});

test('aged candidates cannot replace newer known data, and very old or explicitly stale responses are rejected', async () => {
  let now = NOW, aged = false;
  const read = service({ now: () => now, fetchImpl: async () => json(payload(), { headers: aged ? { Age: '6' } : {} }) });
  const first = await read('current');
  now += 1001; aged = true;
  const kept = await read('current');
  assert.equal(kept.fetchedAt, first.fetchedAt); assert.equal(kept.stale, true);
  for (const headers of [{ Age: '46' }, { Age: '6', Warning: '110 edge "Response is Stale"' }]) {
    const bad = service({ fetchImpl: async () => json(payload(), { headers }) });
    await assert.rejects(bad('current'), { code: 'UNAVAILABLE' });
  }
});

test('provider timestamps and backwards fallback progress outrank fetch time without suppressing legitimate corrections', async () => {
  const before = { ...payload(), fetchedAt: new Date(NOW).toISOString(), sourceId: 'primary' };
  const behind = { ...payload({ games: [game({ clock: '6:00', away: { id: '3', score: 7 } })] }), fetchedAt: new Date(NOW + 2000).toISOString(), sourceId: 'backup' };
  assert.equal(snapshotIsOlder(behind, before, NOW + 2000), true);
  assert.equal(snapshotIsOlder({ ...behind, sourceId: 'primary' }, before, NOW + 2000), false, 'The same route can correct a score or clock.');
  const stamped = { ...before, games: [game({ sourceUpdatedAt: new Date(NOW).toISOString() })] };
  const olderProviderFrame = { ...before, fetchedAt: new Date(NOW + 2000).toISOString(), games: [game({ sourceUpdatedAt: new Date(NOW - 2000).toISOString() })] };
  assert.equal(snapshotIsOlder(olderProviderFrame, stamped, NOW + 2000), true);
  const confirmedCorrection = { ...behind, games: [game({ clock: '6:00', sourceUpdatedAt: new Date(NOW + 1000).toISOString() })] };
  assert.equal(snapshotIsOlder(confirmedCorrection, stamped, NOW + 2000), false);
  let now = NOW, phase = 'first';
  const read = service({ now: () => now, fetchImpl: async (url) => {
    if (phase === 'first') return json(payload());
    if (url.includes('primary')) return json({}, { status: 503 });
    return json(payload({ games: behind.games }));
  } });
  const good = await read('current'); now += 2000; phase = 'behind';
  const retained = await read('current');
  assert.equal(retained.games[0].clock, '5:00');
  assert.equal(retained.fetchedAt, good.fetchedAt); assert.equal(retained.stale, true);
});

test('an aged HTTP summary with a proven newer provider frame replaces an older frame and remains labeled delayed', async () => {
  let now = NOW, newer = false;
  const read = service({ now: () => now, fetchImpl: async (url) => {
    if (newer && !url.includes('backup')) return json({}, { status: 503 });
    return json({ gameId: '1', state: 'in', sourceUpdatedAt: new Date(NOW - (newer ? 7000 : 20000)).toISOString(),
      teamStats: [{ away: newer ? '180' : '150' }] }, { headers: newer ? { Age: '6' } : {} });
  } });
  const first = await read('current');
  now += 2000; newer = true;
  const updated = await read('current');
  assert.ok(Date.parse(updated.fetchedAt) < Date.parse(first.fetchedAt));
  assert.ok(Date.parse(updated.sourceUpdatedAt) > Date.parse(first.sourceUpdatedAt));
  assert.equal(updated.teamStats[0].away, '180');
  assert.equal(updated.sourceId, 'backup'); assert.equal(updated.stale, true);
  assert.equal((await read('current')).teamStats[0].away, '180');
});
