'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FullscreenTransitions } = require('./fullscreen.cjs');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

// Exercise the actual main-process move handlers without starting Electron or
// a network server. Native CI separately verifies these same handlers in AppKit.
function macMovementHarness({ helperAvailable = true } = {}) {
  let now = 0, nextTimer = 0;
  const timers = new Map(), helpers = [];
  const display = { id: 1, workArea: { x: 0, y: 25, width: 1024, height: 681 } };
  class Window extends EventEmitter {
    constructor(options) { super(); this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height }; this.webContents = new EventEmitter(); }
    getBounds() { return { ...this.bounds }; }
    setBounds(bounds) { this.bounds = { ...bounds }; this.emit('move'); }
    isDestroyed() { return false; }
    setAlwaysOnTop() {}
    setVisibleOnAllWorkspaces() {}
    setMenu() {}
    setMovable() {}
    loadURL() { return Promise.resolve(); }
  }
  const electron = {
    app: { setName() {}, requestSingleInstanceLock: () => false, quit() {}, isPackaged: false },
    BrowserWindow: Window,
    screen: { getAllDisplays: () => [display], getPrimaryDisplay: () => display, getDisplayMatching: () => display }
  };
  const context = {
    require: (name) => {
      if (name === 'electron') return electron;
      if (name === 'node:fs') return { ...fs, existsSync: () => helperAvailable };
      if (name === 'node:child_process') return { spawn: () => { const helper = new EventEmitter(); helpers.push(helper); return helper; } };
      return require(name);
    },
    __dirname,
    process: { platform: 'darwin', argv: [], env: {}, resourcesPath: '/test-resources' },
    console,
    setTimeout: (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout: (id) => timers.delete(id)
  };
  vm.runInNewContext(`${fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8')}
    savePreferences = () => {};
    publishPreferences = () => {};
    secureWindow = () => {};
    closeDetails = () => {};
    placeDetails = () => {};
    createWidget();
    globalThis.harness = {
      widget, setPreferences, handleDisplayChange,
      preferences: () => JSON.parse(JSON.stringify(publicPreferences()))
    };
  `, context);
  return {
    ...context.harness, display, helpers,
    advance(milliseconds) {
      const end = now + milliseconds;
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [id, timer] = next;
        timers.delete(id); now = timer.at; timer.callback();
      }
      now = end;
    }
  };
}

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

test('Mac Dock and Spaces moves preserve the anchor after native positioning has settled', () => {
  const app = macMovementHarness();
  const original = app.widget.getBounds();
  app.widget.emit('move');
  app.advance(1000);
  assert.equal(app.preferences().anchor, 'bottom-center');
  app.display.workArea.height += 85;
  app.handleDisplayChange();
  app.advance(200);
  app.widget.emit('move'); // The late notification arrives beyond the 120 ms setBounds guard.
  app.advance(1000);
  assert.equal(app.preferences().anchor, 'bottom-center');
  app.display.workArea.height -= 85;
  app.handleDisplayChange();
  app.advance(200);
  app.widget.emit('move');
  app.advance(1000);
  assert.equal(app.preferences().anchor, 'bottom-center');
  assert.deepEqual(app.widget.getBounds(), original);
  assert.equal(app.helpers.length, 0, 'Passive moves must not start a manual-drag watcher');
});

test('a real Mac manual drag waits for physical release and still snaps after a passive move', () => {
  const app = macMovementHarness();
  app.widget.emit('move'); app.advance(1000);
  app.widget.emit('will-move', { preventDefault() { assert.fail('An unlocked drag was prevented'); } });
  assert.equal(app.helpers.length, 1);
  app.widget.setBounds({ ...app.widget.getBounds(), x: 8, y: 200 });
  app.advance(1000);
  assert.equal(app.preferences().anchor, 'bottom-center', 'A held drag must not snap early');
  app.helpers[0].emit('exit', 0);
  app.advance(500);
  assert.equal(app.preferences().anchor, 'middle-left');
  assert.equal(app.preferences().orientation, 'vertical');
  app.widget.emit('move'); app.advance(1000);
  assert.equal(app.preferences().anchor, 'middle-left', 'Late post-release notifications must preserve the new anchor');
});

for (const helperAvailable of [false, true]) {
  test(`a real Mac drag keeps free placement when the release helper ${helperAvailable ? 'fails' : 'is absent'}`, () => {
    const app = macMovementHarness({ helperAvailable });
    app.widget.emit('will-move', { preventDefault() {} });
    const moved = { ...app.widget.getBounds(), x: 200, y: 200 };
    app.widget.setBounds(moved);
    if (helperAvailable) app.helpers[0].emit('error', new Error('Helper unavailable'));
    app.advance(1000);
    assert.equal(app.preferences().anchor, null);
    assert.deepEqual(app.widget.getBounds(), moved);
    app.setPreferences({ anchor: 'bottom-center' });
    app.advance(200);
    app.widget.emit('move'); app.advance(1000);
    assert.equal(app.preferences().anchor, 'bottom-center', 'Completed fallback must not turn later passive moves into user drags');
  });
}
