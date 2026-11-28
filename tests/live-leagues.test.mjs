import test from 'node:test';
import assert from 'node:assert/strict';
import { LEAGUES } from '../public/sports.js';
import { createAllLeagueLiveFeed } from '../public/live-leagues.js';

function feed(leagueId) {
  const nfl = leagueId === 'nfl';
  return {
    leagueId, fetchedAt: new Date().toISOString(), games: [
      { id: nfl ? '401700123' : `${leagueId}:123`, leagueId, state: 'in', phase: 'live', isLive: true,
        startTime: new Date().toISOString(), away: { id: nfl ? '3' : `${leagueId}:3`, abbreviation: 'AWY', score: 7 },
        home: { id: nfl ? '4' : `${leagueId}:4`, abbreviation: 'HME', score: 10 } },
      { id: nfl ? '401700124' : `${leagueId}:124`, leagueId, state: 'pre', phase: 'scheduled', isLive: false,
        away: { id: nfl ? '5' : `${leagueId}:5`, abbreviation: 'AWY' }, home: { id: nfl ? '6' : `${leagueId}:6`, abbreviation: 'HME' } },
    ],
  };
}

test('on-demand live league feed fetches every other league with bounded concurrency and ranks favorites first', async () => {
  let active = 0, maximum = 0, calls = 0, done;
  const completed = new Promise(resolve => { done = resolve; });
  const feedView = createAllLeagueLiveFeed({
    baseURL: 'https://scorebug.test/', concurrency: 3, refreshInterval: 60000,
    onUpdate: value => { if (!value.loading && value.checked === value.total) done(); },
    fetcher: async url => {
      const leagueId = new URL(url).searchParams.get('league') || 'nfl';
      calls++; active++; maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 2));
      active--;
      return { ok: true, json: async () => feed(leagueId) };
    },
  });
  feedView.start('nba');
  await completed;
  const result = feedView.result(['nhl', 'f1']);
  assert.equal(calls, LEAGUES.length - 1);
  assert.ok(maximum <= 3);
  assert.equal(result.total, LEAGUES.length - 1);
  assert.equal(result.loading, false);
  assert.equal(result.unavailable, 0);
  assert.equal(result.games.length, LEAGUES.length - 1);
  assert.deepEqual(new Set(result.games.slice(0, 2).map(game => game.leagueId)), new Set(['f1', 'nhl']));
  assert.ok(!['f1', 'nhl'].includes(result.games[2].leagueId), 'favorite leagues rank before the remaining leagues');
  assert.ok(result.games.every(game => game.phase === 'live'));
  assert.ok(result.games.every(game => game.leagueId !== 'nba'));
  feedView.stop();
  assert.equal(feedView.result().total, 0);
});

test('failed and malformed league feeds are reported while successful live results remain visible', async () => {
  let done;
  const completed = new Promise(resolve => { done = resolve; });
  const feedView = createAllLeagueLiveFeed({
    baseURL: 'https://scorebug.test/', concurrency: 5,
    onUpdate: value => { if (!value.loading && value.checked + value.unavailable === value.total) done(); },
    fetcher: async url => {
      const leagueId = new URL(url).searchParams.get('league') || 'nfl';
      if (leagueId === 'f1') throw new Error('timing feed unavailable');
      return { ok: true, json: async () => leagueId === 'nascar' ? feed('indycar') : feed(leagueId) };
    },
  });
  feedView.start('nba');
  await completed;
  const result = feedView.result();
  assert.equal(result.unavailable, 2);
  assert.equal(result.games.length, LEAGUES.length - 3);
  assert.ok(result.games.every(game => game.leagueId !== 'nba'));
  feedView.stop();
});

test('stopping the expanded feed aborts requests and ignores late responses', async () => {
  const pending = [];
  const feedView = createAllLeagueLiveFeed({
    baseURL: 'https://scorebug.test/', concurrency: 2,
    fetcher: (url, { signal }) => new Promise(resolve => pending.push({ url, signal, resolve })),
  });
  feedView.start('nba');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(pending.length, 2);
  feedView.stop();
  assert.ok(pending.every(item => item.signal.aborted));
  for (const item of pending) {
    const leagueId = new URL(item.url).searchParams.get('league') || 'nfl';
    item.resolve({ ok: true, json: async () => feed(leagueId) });
  }
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(feedView.result().games, []);
});

test('late work from a stopped feed cannot clear the new generation’s in-flight guard', async () => {
  const pending = [];
  const feedView = createAllLeagueLiveFeed({
    baseURL: 'https://scorebug.test/', concurrency: 2, refreshInterval: 60000,
    fetcher: (url, { signal }) => new Promise(resolve => pending.push({ url, signal, resolve })),
  });
  const resolveBatch = batch => {
    for (const item of batch) {
      const leagueId = new URL(item.url).searchParams.get('league') || 'nfl';
      item.resolve({ ok: true, json: async () => feed(leagueId) });
    }
  };
  feedView.start('nba');
  await new Promise(resolve => setTimeout(resolve, 0));
  const oldBatch = pending.slice(0, 2);
  feedView.stop();feedView.start('nba');
  await new Promise(resolve => setTimeout(resolve, 0));
  const currentBatch = pending.slice(2, 4);
  assert.equal(currentBatch.length, 2);
  resolveBatch(oldBatch);
  await new Promise(resolve => setTimeout(resolve, 0));
  feedView.refresh();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(pending.length, 4, 'refresh is queued until the current generation finishes');
  resolveBatch(currentBatch);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(pending.length, 6, 'the queued refresh starts after the active generation batch settles');
  feedView.stop();
  resolveBatch(pending.slice(4, 6));
});
