'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DetailsLifecycle, DETAILS_OPEN_MS, DETAILS_EXIT_MS } = require('./details-lifecycle.cjs');

function fixture() {
  const events = [];
  const destroyed = [];
  const tasks = [];
  const lifecycle = new DetailsLifecycle({
    onPhase: (owner, phase) => events.push({ owner, phase }),
    onClosed: (owner) => destroyed.push(owner),
    timers: {
      setTimeout(callback, delay) {
        const task = { callback, delay, cancelled: false, unref() {} };
        tasks.push(task);
        return task;
      },
      clearTimeout(task) { task.cancelled = true; }
    }
  });
  return { lifecycle, events, destroyed, tasks };
}

test('the native panel stays alive through opening and the complete exit animation', () => {
  const { lifecycle, tasks, events, destroyed } = fixture();
  const panel = {};
  lifecycle.open(panel);
  assert.equal(lifecycle.phaseFor(panel), 'opening');
  assert.equal(tasks[0].delay, DETAILS_OPEN_MS);
  tasks[0].callback();
  assert.equal(lifecycle.phaseFor(panel), 'open');
  lifecycle.close(panel);
  assert.equal(lifecycle.phaseFor(panel), 'closing');
  assert.deepEqual(destroyed, []);
  assert.equal(tasks[1].delay, DETAILS_EXIT_MS);
  tasks[1].callback();
  assert.deepEqual(events.map(({ phase }) => phase), ['opening', 'open', 'closing', 'closed']);
  assert.deepEqual(destroyed, [panel]);
});

test('fast rehover reverses the same window and an already queued close cannot destroy it', () => {
  const { lifecycle, tasks, destroyed } = fixture();
  const panel = {};
  lifecycle.open(panel);
  lifecycle.close(panel);
  const oldClose = tasks.at(-1);
  lifecycle.open(panel);
  assert.equal(oldClose.cancelled, true);
  oldClose.callback();
  assert.equal(lifecycle.phaseFor(panel), 'opening');
  assert.deepEqual(destroyed, []);
  tasks.at(-1).callback();
  assert.equal(lifecycle.phaseFor(panel), 'open');
});

test('repeated pointer-leave ticks do not postpone destruction indefinitely', () => {
  const { lifecycle, tasks, destroyed } = fixture();
  const panel = {};
  lifecycle.open(panel);
  lifecycle.close(panel);
  const close = tasks.at(-1);
  lifecycle.close(panel);
  lifecycle.close(panel);
  assert.equal(tasks.at(-1), close);
  close.callback();
  assert.deepEqual(destroyed, [panel]);
});

test('drag, hide and shutdown can tear down immediately, cancelling all older callbacks', () => {
  const { lifecycle, tasks, destroyed } = fixture();
  const panel = {};
  lifecycle.open(panel);
  const oldOpen = tasks.at(-1);
  lifecycle.close(panel, { immediate: true });
  assert.equal(lifecycle.phaseFor(panel), 'closed');
  assert.deepEqual(destroyed, [panel]);
  oldOpen.callback();
  assert.deepEqual(destroyed, [panel]);
  assert.equal(lifecycle.phaseFor(panel), 'closed');
});

test('a stale previous-window timer cannot close the replacement window', () => {
  const { lifecycle, tasks, destroyed } = fixture();
  const oldPanel = {}, newPanel = {};
  lifecycle.open(oldPanel);
  lifecycle.close(oldPanel);
  const oldClose = tasks.at(-1);
  lifecycle.forget(oldPanel);
  lifecycle.open(newPanel);
  oldClose.callback();
  assert.equal(lifecycle.phaseFor(newPanel), 'opening');
  assert.deepEqual(destroyed, []);
});

test('a panel dismissed before ready-to-show is destroyed without an entrance flash', () => {
  const { lifecycle, events, destroyed, tasks } = fixture();
  const notReady = {};
  lifecycle.close(notReady, { immediate: true });
  assert.deepEqual(destroyed, [notReady]);
  assert.deepEqual(events, []);
  assert.deepEqual(tasks, []);
});
