'use strict';

const INITIAL_CHECK_DELAY = 15_000;
const CHECK_INTERVAL = 60 * 60 * 1000;

function updateMode({ isPackaged, platform, portable }) {
  if (!isPackaged) return 'development';
  if (platform === 'darwin') return 'manual-mac';
  if (platform !== 'win32') return 'unsupported';
  return portable ? 'portable' : 'installed';
}

function modeMessage(mode, automatic) {
  if (mode === 'manual-mac') return 'Download the latest Mac version to update. Your saved teams, style and position carry over.';
  if (mode === 'portable') return 'Install Scorebug to receive automatic updates.';
  if (mode !== 'installed') return 'Updates are available in the installed Windows app.';
  return automatic ? 'Scorebug checks for updates automatically.' : 'Automatic checks are off. You can check for updates here.';
}

/**
 * Coordinates the standard NSIS updater. Electron and electron-updater are
 * injected so a test can exercise the lifecycle without downloading or running
 * an installer. The renderer can request actions, never supply a feed URL.
 */
class UpdateController {
  constructor({
    currentVersion,
    isPackaged,
    platform,
    arch = process.arch,
    portable = false,
    automatic = true,
    createUpdater,
    onStateChanged = () => {},
    onAutomaticChanged = () => {},
    onBeforeRestart = () => {},
    onRestartCancelled = () => {},
    timers = { setTimeout, clearTimeout, setInterval, clearInterval },
    initialDelay = INITIAL_CHECK_DELAY,
    checkInterval = CHECK_INTERVAL
  }) {
    this.mode = updateMode({ isPackaged, platform, portable });
    this.state = {
      mode: this.mode,
      currentVersion: String(currentVersion),
      status: 'idle',
      availableVersion: null,
      percent: null,
      automatic: Boolean(automatic),
      message: modeMessage(this.mode, automatic)
    };
    if (this.mode === 'manual-mac') this.state.downloadURL = `https://github.com/aaraven99/scorebug/releases/latest/download/Scorebug-Mac-${arch === 'arm64' ? 'Apple-Silicon' : 'Intel'}.dmg`;
    this.createUpdater = createUpdater;
    this.onStateChanged = onStateChanged;
    this.onAutomaticChanged = onAutomaticChanged;
    this.onBeforeRestart = onBeforeRestart;
    this.onRestartCancelled = onRestartCancelled;
    this.timers = timers;
    this.initialDelay = initialDelay;
    this.checkInterval = checkInterval;
    this.updater = null;
    this.initialTimer = null;
    this.periodicTimer = null;
    this.inFlight = null;
    this.started = false;
    this.stopped = false;
    this.restarting = false;
  }

  getState() {
    return { ...this.state };
  }

  publish(patch) {
    if (this.stopped) return this.getState();
    const next = { ...this.state, ...patch };
    if (JSON.stringify(next) !== JSON.stringify(this.state)) {
      this.state = next;
      try { this.onStateChanged(this.getState()); } catch {
        // A settings window can close while it receives a progress event.
        // Update observers must not interrupt the scorebug or its downloader.
      }
    }
    return this.getState();
  }

  fail() {
    if (this.stopped) return;
    if (this.restarting) {
      this.restarting = false;
      this.onRestartCancelled();
    }
    this.publish({
      status: 'error',
      percent: null,
      message: 'The update could not finish. Scorebug will keep working; try again later.'
    });
  }

  ensureUpdater() {
    if (this.updater) return this.updater;
    const updater = this.createUpdater();
    // The package verifies the downloaded file against the release manifest.
    // Keep its Authenticode verification defaults: no signature bypass hooks.
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    updater.autoDownload = true;
    // The preference controls background CHECKS. A manually requested, verified
    // download also installs on normal quit, as the ready state explains.
    updater.autoInstallOnAppQuit = true;
    updater.on('checking-for-update', () => {
      if (this.state.status !== 'ready') this.publish({ status: 'checking', percent: null, message: 'Checking for updates…' });
    });
    updater.on('update-available', (info) => {
      if (this.state.status === 'ready') return;
      this.publish({
        status: 'downloading',
        availableVersion: typeof info?.version === 'string' ? info.version.slice(0, 100) : null,
        percent: 0,
        message: 'Downloading an update. Your scorebug will keep running.'
      });
    });
    updater.on('download-progress', (progress) => {
      if (this.state.status === 'ready') return;
      this.publish({
        status: 'downloading',
        percent: Number.isFinite(progress?.percent) ? Math.max(0, Math.min(100, Math.floor(progress.percent))) : null,
        message: 'Downloading an update. Your scorebug will keep running.'
      });
    });
    updater.on('update-downloaded', (info) => {
      this.publish({
        status: 'ready',
        availableVersion: typeof info?.version === 'string' ? info.version.slice(0, 100) : this.state.availableVersion,
        percent: 100,
        message: 'The update is ready. It will install when you quit, or you can restart now.'
      });
    });
    updater.on('update-not-available', () => {
      if (this.state.status === 'ready') return;
      this.publish({ status: 'up-to-date', availableVersion: null, percent: null, message: 'You have the latest version.' });
    });
    // Keep this listener even during shutdown so a late network failure never
    // becomes an unhandled EventEmitter error while the app is closing.
    updater.on('error', () => this.fail());
    this.updater = updater;
    return updater;
  }

  start() {
    if (this.started || this.stopped) return this.getState();
    this.started = true;
    this.schedule();
    return this.getState();
  }

  clearSchedule() {
    if (this.initialTimer !== null) this.timers.clearTimeout(this.initialTimer);
    if (this.periodicTimer !== null) this.timers.clearInterval(this.periodicTimer);
    this.initialTimer = null;
    this.periodicTimer = null;
  }

  schedule() {
    this.clearSchedule();
    if (!this.started || this.stopped || this.mode !== 'installed' || !this.state.automatic) return;
    this.initialTimer = this.timers.setTimeout(() => {
      this.initialTimer = null;
      void this.checkForUpdates({ manual: false });
    }, this.initialDelay);
    this.periodicTimer = this.timers.setInterval(() => { void this.checkForUpdates({ manual: false }); }, this.checkInterval);
    this.initialTimer?.unref?.();
    this.periodicTimer?.unref?.();
  }

  checkForUpdates({ manual = true } = {}) {
    if (this.stopped || this.mode !== 'installed' || this.restarting || this.state.status === 'ready' || (!manual && !this.state.automatic)) {
      return Promise.resolve(this.getState());
    }
    if (this.inFlight) return this.inFlight;
    // Start in a microtask so inFlight is assigned before an updater can emit
    // events or an event subscriber can request another check.
    const operation = Promise.resolve().then(async () => {
      if (this.stopped || (!manual && !this.state.automatic)) return this.getState();
      this.publish({ status: 'checking', availableVersion: null, percent: null, message: 'Checking for updates…' });
      try {
        const updater = this.ensureUpdater();
        const result = await updater.checkForUpdates();
        // Keep one operation in flight through the download, not only through
        // the metadata request. Errors are handled here and in the error event.
        if (result?.downloadPromise) await result.downloadPromise;
      } catch {
        this.fail();
      }
      return this.getState();
    });
    this.inFlight = operation.finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  setAutomaticUpdates(automatic) {
    if (typeof automatic !== 'boolean') throw new TypeError('Automatic updates must be true or false');
    if (this.stopped) return this.getState();
    if (automatic === this.state.automatic) return this.getState();
    this.onAutomaticChanged(automatic);
    const patch = { automatic };
    if (this.state.status === 'idle') patch.message = modeMessage(this.mode, automatic);
    this.publish(patch);
    this.schedule();
    return this.getState();
  }

  restartToUpdate() {
    if (this.stopped || this.mode !== 'installed' || this.state.status !== 'ready' || this.restarting) return this.getState();
    this.restarting = true;
    try {
      // Set the main process's quitting guard before the installer closes any
      // BrowserWindows. Their closed handlers must not start a competing quit.
      this.onBeforeRestart();
      this.updater.quitAndInstall(true, true);
    } catch {
      this.fail();
    }
    return this.getState();
  }

  stop() {
    this.stopped = true;
    this.clearSchedule();
    // Do not turn off autoInstallOnAppQuit here. electron-updater owns that
    // normal-quit hook and still needs to apply a completed update.
  }
}

module.exports = { UpdateController, updateMode, INITIAL_CHECK_DELAY, CHECK_INTERVAL };
