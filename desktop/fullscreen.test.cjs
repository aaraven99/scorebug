'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FullscreenTransitions } = require('./fullscreen.cjs');

test('Escape during Mac entry queues an exit until the native entry finishes', () => {
  const calls = [], state = new FullscreenTransitions(value => calls.push(value));
  state.request(true);
  assert.equal(state.value, false, 'requesting fullscreen must not report a completed native transition');
  state.request(true);
  state.request(false);
  assert.deepEqual(calls, [true]);
  state.settled(true);
  assert.deepEqual(calls, [true, false]);
  assert.equal(state.value, true);
  state.settled(false);
  assert.equal(state.value, false);
  assert.equal(state.pending, null);
});

test('rapid toggles keep the last choice and repeated opens do not re-enter fullscreen', () => {
  const calls = [], state = new FullscreenTransitions(value => calls.push(value));
  state.request(true); state.request(false); state.request(true); state.settled(true);
  state.request(true);
  assert.deepEqual(calls, [true]);
  state.request(false); state.request(true); state.settled(false); state.settled(true);
  assert.deepEqual(calls, [true, false, true]);
  assert.equal(state.value, true);
  assert.equal(state.pending, null);
});

test('native title-bar changes and synchronous platform events keep state accurate', () => {
  const calls = [], state = new FullscreenTransitions(value => calls.push(value));
  state.settled(true);
  assert.equal(state.target, true);
  state.request(false);
  assert.deepEqual(calls, [false]);
  state.settled(false);
  let synchronous;
  synchronous = new FullscreenTransitions(value => synchronous.settled(value));
  synchronous.request(true);
  assert.equal(synchronous.value, true);
  assert.equal(synchronous.pending, null);
  assert.throws(() => synchronous.request('yes'), /true or false/);
});
