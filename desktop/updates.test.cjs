'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { UpdateController, updateMode, INITIAL_CHECK_DELAY, CHECK_INTERVAL } = require('./updates.cjs');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fakeTimers() {
  const timeouts = new Map();
  const intervals = new Map();
  const add = (collection, callback, delay) => {
    const handle = { unref() {} };
    collection.set(handle, { callback, delay });
    return handle;
  };
  return {
    timeouts,
    intervals,
    setTimeout: (callback, delay) => add(timeouts, callback, delay),
    clearTimeout: (handle) => timeouts.delete(handle),
    setInterval: (callback, delay) => add(intervals, callback, delay),
    clearInterval: (handle) => intervals.delete(handle),
    runInitial() {
      for (const [handle, timer] of [...timeouts]) {
        timeouts.delete(handle);
        timer.callback();
      }
    },
    runPeriodic() {
      for (const timer of [...intervals.values()]) timer.callback();
    }
  };
}

class FakeUpdater extends EventEmitter {
  constructor() {
    super();
    this.calls = 0;
    this.installs = [];
    this.verifyUpdateCodeSignature = Symbol('original signature verifier');
    this.performCheck = async () => {
      this.emit('checking-for-update');
      this.emit('update-not-available', { version: '1.2.2' });
      return {};
    };
  }
  checkForUpdates() {
    this.calls += 1;
    return this.performCheck();
  }
  quitAndInstall(...args) {
    this.installs.push(args);
    this.onInstall?.();
  }
}

function fixture(options = {}) {
  const updater = new FakeUpdater();
  const timers = fakeTimers();
  const states = [];
  const savedAutomatic = [];
  let factoryCalls = 0;
  const controller = new UpdateController({
    currentVersion: '1.2.2',
    isPackaged: true,
    platform: 'win32',
    createUpdater: () => { factoryCalls += 1; return updater; },
    onStateChanged: (state) => states.push(state),
    onAutomaticChanged: (value) => savedAutomatic.push(value),
    timers,
    ...options
  });
  return { controller, updater, timers, states, savedAutomatic, factoryCalls: () => factoryCalls };
}

test('development, portable and other platforms never load or check the updater', async () => {
  for (const [options, expected] of [
    [{ isPackaged: false, platform: 'win32', portable: true }, 'development'],
    [{ portable: true }, 'portable'],
    [{ platform: 'linux' }, 'unsupported'],
    [{ platform: 'darwin' }, 'manual-mac']
  ]) {
    const { controller, timers, factoryCalls } = fixture(options);
    controller.start();
    await controller.checkForUpdates();
    controller.restartToUpdate();
    controller.setAutomaticUpdates(false);
    controller.setAutomaticUpdates(true);
    assert.equal(controller.getState().mode, expected);
    assert.equal(factoryCalls(), 0);
    assert.equal(timers.timeouts.size, 0);
    assert.equal(timers.intervals.size, 0);
    assert.equal(controller.getState().status, 'idle');
  }
  assert.equal(updateMode({ isPackaged: true, platform: 'win32', portable: false }), 'installed');
});

test('Mac development builds provide architecture-correct manual downloads without pretending to auto-update', async () => {
  for (const [arch, name] of [['arm64', 'Apple-Silicon'], ['x64', 'Intel']]) {
    const { controller, factoryCalls, timers } = fixture({ platform: 'darwin', arch });
    controller.start();
    const state = await controller.checkForUpdates();
    assert.equal(state.mode, 'manual-mac');
    assert.equal(state.downloadURL, `https://github.com/aaraven99/scorebug/releases/latest/download/Scorebug-Mac-${name}.dmg`);
    assert.match(state.message, /Download the latest Mac version/);
    assert.equal(factoryCalls(), 0);
    assert.equal(timers.timeouts.size, 0);
    assert.equal(timers.intervals.size, 0);
  }
});

test('installed app checks after startup and hourly without changing signature defaults', async () => {
  const { controller, updater, timers } = fixture();
  const originalVerifier = updater.verifyUpdateCodeSignature;
  controller.start();
  controller.start();
  assert.equal(updater.calls, 0);
  assert.equal(timers.timeouts.size, 1);
  assert.equal(timers.intervals.size, 1);
  assert.equal([...timers.timeouts.values()][0].delay, INITIAL_CHECK_DELAY);
  assert.equal([...timers.intervals.values()][0].delay, CHECK_INTERVAL);
  timers.runInitial();
  await controller.inFlight;
  assert.equal(updater.calls, 1);
  assert.equal(controller.getState().status, 'up-to-date');
  assert.equal(updater.allowPrerelease, false);
  assert.equal(updater.allowDowngrade, false);
  assert.equal(updater.autoDownload, true);
  assert.equal(updater.autoInstallOnAppQuit, true);
  assert.equal(updater.verifyUpdateCodeSignature, originalVerifier);
  timers.runPeriodic();
  await controller.inFlight;
  assert.equal(updater.calls, 2);
  controller.stop();
});

test('one check remains in flight through download and reports a verified ready update', async () => {
  const { controller, updater, states } = fixture();
  const metadata = deferred();
  const download = deferred();
  updater.performCheck = () => metadata.promise;
  const first = controller.checkForUpdates();
  assert.equal(controller.checkForUpdates(), first);
  await Promise.resolve();
  assert.equal(updater.calls, 1);
  assert.equal(controller.getState().status, 'checking');
  updater.emit('update-available', { version: '1.2.3' });
  metadata.resolve({ downloadPromise: download.promise });
  await Promise.resolve();
  updater.emit('download-progress', { percent: 42.7 });
  assert.equal(controller.getState().percent, 42);
  assert.equal(controller.checkForUpdates(), first);
  updater.emit('update-downloaded', { version: '1.2.3' });
  download.resolve([]);
  assert.deepEqual(await first, {
    mode: 'installed', currentVersion: '1.2.2', status: 'ready', availableVersion: '1.2.3', percent: 100, automatic: true,
    message: 'The update is ready. It will install when you quit, or you can restart now.'
  });
  assert.equal(controller.inFlight, null);
  await controller.checkForUpdates();
  assert.equal(updater.calls, 1, 'a staged update is not downloaded again');
  assert.equal(updater.installs.length, 0, 'downloading never interrupts the game with a restart');
  assert.ok(states.some((state) => state.status === 'downloading'));
});

test('a state listener cannot start a competing check', async () => {
  let controller;
  let reentrantCheck;
  const f = fixture({ onStateChanged: (state) => {
    if (state.status === 'checking') reentrantCheck = controller.checkForUpdates();
  } });
  controller = f.controller;
  const first = controller.checkForUpdates();
  await first;
  assert.equal(reentrantCheck, first);
  assert.equal(f.updater.calls, 1);
});

test('offline metadata and failed downloads remain retryable without throwing into the UI', async () => {
  const { controller, updater } = fixture();
  updater.performCheck = async () => { throw new Error('offline'); };
  assert.equal((await controller.checkForUpdates()).status, 'error');
  assert.equal(controller.inFlight, null);
  updater.performCheck = async () => {
    updater.emit('update-available', { version: '1.2.3' });
    return { downloadPromise: Promise.reject(new Error('connection interrupted')) };
  };
  assert.equal((await controller.checkForUpdates()).status, 'error');
  updater.performCheck = async () => {
    updater.emit('update-downloaded', { version: '1.2.3' });
    return {};
  };
  assert.equal((await controller.checkForUpdates()).status, 'ready');
  assert.equal(updater.calls, 3);
});

test('a failed updater initialization does not prevent a later check', async () => {
  const updater = new FakeUpdater();
  let attempts = 0;
  const { controller } = fixture({ createUpdater: () => {
    if (++attempts === 1) throw new Error('temporarily unavailable');
    return updater;
  } });
  assert.equal((await controller.checkForUpdates()).status, 'error');
  assert.equal((await controller.checkForUpdates()).status, 'up-to-date');
  assert.equal(attempts, 2);
});

test('automatic preference controls scheduling, while manual checks still download and install on quit', async () => {
  const { controller, updater, timers, savedAutomatic } = fixture({ automatic: false });
  controller.start();
  assert.equal(timers.timeouts.size, 0);
  assert.equal(timers.intervals.size, 0);
  await controller.checkForUpdates({ manual: false });
  assert.equal(updater.calls, 0);
  updater.performCheck = async () => {
    updater.emit('update-available', { version: '1.2.3' });
    updater.emit('update-downloaded', { version: '1.2.3' });
    return {};
  };
  const state = await controller.checkForUpdates();
  assert.equal(updater.autoDownload, true);
  assert.equal(updater.autoInstallOnAppQuit, true);
  assert.equal(state.automatic, false);
  assert.match(state.message, /install when you quit/);
  controller.setAutomaticUpdates(true);
  assert.equal(timers.timeouts.size, 1);
  assert.equal(timers.intervals.size, 1);
  controller.setAutomaticUpdates(false);
  assert.equal(timers.timeouts.size, 0);
  assert.equal(timers.intervals.size, 0);
  assert.equal(updater.autoInstallOnAppQuit, true);
  assert.deepEqual(savedAutomatic, [true, false]);
  assert.throws(() => controller.setAutomaticUpdates('false'), TypeError);
  const copy = controller.getState();
  copy.automatic = true;
  assert.equal(controller.getState().automatic, false);
});

test('manual restart requires a downloaded update and sets the quit guard before installation', async () => {
  let quitting = false;
  const { controller, updater } = fixture({ onBeforeRestart: () => { quitting = true; } });
  controller.restartToUpdate();
  assert.equal(updater.installs.length, 0);
  updater.performCheck = async () => {
    updater.emit('update-downloaded', { version: '1.2.3' });
    return {};
  };
  await controller.checkForUpdates();
  updater.onInstall = () => assert.equal(quitting, true, 'closed handlers see the quit guard first');
  controller.restartToUpdate();
  controller.restartToUpdate();
  assert.deepEqual(updater.installs, [[true, true]]);
});

test('disabling automatic checks also cancels a scheduled check queued for this turn', async () => {
  const { controller, updater, timers } = fixture();
  controller.start();
  timers.runInitial();
  controller.setAutomaticUpdates(false);
  await controller.inFlight;
  assert.equal(updater.calls, 0);
  assert.equal(controller.getState().status, 'idle');
  await controller.checkForUpdates();
  assert.equal(updater.calls, 1, 'explicit manual checks still work');
});

test('failed restart clears the pending quit guard and allows a later retry', async () => {
  let quitting = false;
  const { controller, updater } = fixture({
    onBeforeRestart: () => { quitting = true; },
    onRestartCancelled: () => { quitting = false; }
  });
  updater.performCheck = async () => {
    updater.emit('update-downloaded', { version: '1.2.3' });
    return {};
  };
  await controller.checkForUpdates();
  updater.onInstall = () => updater.emit('error', new Error('installer could not start'));
  assert.equal(controller.restartToUpdate().status, 'error');
  assert.equal(quitting, false);
  assert.equal(controller.restarting, false);
  await controller.checkForUpdates();
  updater.onInstall = null;
  controller.restartToUpdate();
  assert.equal(quitting, true);
  assert.equal(updater.installs.length, 2);
});

test('normal shutdown clears timers, keeps verified install-on-quit enabled and absorbs late errors', async () => {
  const { controller, updater, timers, states } = fixture();
  controller.start();
  await controller.checkForUpdates();
  const count = states.length;
  controller.stop();
  assert.equal(timers.timeouts.size, 0);
  assert.equal(timers.intervals.size, 0);
  assert.equal(updater.autoInstallOnAppQuit, true);
  updater.emit('error', new Error('late network response'));
  updater.emit('download-progress', { percent: 80 });
  await controller.checkForUpdates();
  assert.equal(updater.calls, 1);
  assert.equal(states.length, count);
});
