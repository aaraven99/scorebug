import test from 'node:test';
import assert from 'node:assert/strict';
import { GameDetailsPoller } from '../public/game-details-client.js';

const turn = () => new Promise((resolve) => setImmediate(resolve));
const payload = (id, value = '10') => ({ gameId: id, fetchedAt: new Date().toISOString(), teamStats: [{ key: 'totalYards', away: value, home: '20' }] });
const response = (data, ok = true) => ({ ok, json: async () => data });

test('changing games aborts an older request and rejects even a late response that ignores abort', async () => {
  const pending = [], states = [];
  const poller = new GameDetailsPoller({ onUpdate: (state) => states.push(state), fetcher: (url, options) => new Promise((resolve) => pending.push({ url, options, resolve })) });
  try {
    poller.setGame('11'); poller.start();
    poller.setGame('22');
    assert.equal(pending.length, 2);
    assert.equal(pending[0].options.signal.aborted, true);
    assert.equal(pending[1].url.searchParams.get('id'), '22');
    pending[1].resolve(response(payload('22'))); await turn();
    pending[0].resolve(response(payload('11'))); await turn();
    assert.equal(states.at(-1).data.gameId, '22');
    assert.equal(states.some((state) => state.data?.gameId === '11'), false);
  } finally { poller.stop(); }
});

test('stop and restart release an in-flight request without accepting its eventual response', async () => {
  const pending = [], states = [];
  const poller = new GameDetailsPoller({ onUpdate: (state) => states.push(state), fetcher: () => new Promise((resolve) => pending.push(resolve)) });
  try {
    poller.setGame('11'); poller.start(); poller.stop(); poller.start();
    assert.equal(pending.length, 2);
    pending[0](response(payload('11', 'old'))); await turn();
    assert.equal(states.some((state) => state.data), false);
    pending[1](response(payload('11', 'new'))); await turn();
    assert.equal(states.at(-1).data.teamStats[0].away, 'new');
  } finally { poller.stop(); }
});

test('a failed summary keeps the last known stats with an error and recovers independently', async () => {
  let fail = false;
  const states = [];
  const poller = new GameDetailsPoller({ onUpdate: (state) => states.push(state), fetcher: async () => { if (fail) throw new Error('offline'); return response(payload('11')); } });
  try {
    poller.setGame('11'); poller.start(); await turn();
    fail = true; await poller.refresh();
    assert.equal(states.at(-1).data.gameId, '11');
    assert.match(states.at(-1).error.message, /offline/);
    assert.equal(poller.failures, 1);
    fail = false; await poller.refresh();
    assert.equal(states.at(-1).error, null); assert.equal(poller.failures, 0);
  } finally { poller.stop(); }
});

test('mismatched or malformed summaries never become current game data', async () => {
  const states = [];
  const poller = new GameDetailsPoller({ onUpdate: (state) => states.push(state), fetcher: async () => response(payload('99')) });
  try {
    poller.setGame('11'); poller.start(); await turn();
    assert.equal(states.at(-1).data, null);
    assert.match(states.at(-1).error.message, /unavailable/);
    poller.setGame(null);
    assert.equal(states.at(-1).loading, false);
    assert.equal(poller.controller, null);
  } finally { poller.stop(); }
});
