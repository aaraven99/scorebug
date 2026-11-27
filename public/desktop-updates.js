/** Small settings panel for the native updater. Feed data never enters this UI. */
const MODES = new Set(['installed', 'portable', 'manual-mac', 'development', 'unsupported']);
const STATUSES = new Set(['idle', 'checking', 'downloading', 'ready', 'up-to-date', 'error']);

function updateState(value) {
  if (!value || typeof value !== 'object' || !MODES.has(value.mode) || !STATUSES.has(value.status)
      || typeof value.currentVersion !== 'string' || typeof value.automatic !== 'boolean') return null;
  const version = (candidate) => typeof candidate === 'string' && /^\d+\.\d+\.\d+(?:[-+][\w.+-]+)?$/.test(candidate) && candidate.length <= 64 ? candidate : null;
  return {
    mode: value.mode, status: value.status, automatic: value.automatic,
    currentVersion: version(value.currentVersion), availableVersion: version(value.availableVersion),
    percent: Number.isFinite(value.percent) ? Math.round(Math.min(100, Math.max(0, value.percent))) : null,
    message: typeof value.message === 'string' ? value.message.trim().slice(0, 240) : '',
    downloadURL: /^https:\/\/github\.com\/aaraven99\/scorebug\/releases\/latest\/download\/Scorebug-Mac-(?:Apple-Silicon|Intel)\.dmg$/.test(value.downloadURL || '') ? value.downloadURL : null,
  };
}

function statusText(state) {
  if (state.mode === 'manual-mac') return 'Download the latest Mac version, quit Scorebug, then replace it in Applications. Your favorites, style and position stay saved. Automatic Mac updates need an Apple-signed release.';
  if (state.mode === 'portable') return 'Install the Windows version once for automatic updates. Your saved game and position will carry over.';
  if (state.mode === 'development') return 'Updates are disabled while running from source.';
  if (state.mode !== 'installed') return 'Automatic updates are available in the installed Windows app.';
  const release = state.availableVersion ? `Version ${state.availableVersion}` : 'The update';
  switch (state.status) {
    case 'checking': return 'Checking for updates…';
    case 'downloading': return `Downloading${state.availableVersion ? ` version ${state.availableVersion}` : ' the update'}${state.percent === null ? '…' : ` · ${state.percent}%.`} You can keep watching.`;
    case 'ready': return `${release} is ready. Restart now or quit when you’re done to finish updating.`;
    case 'up-to-date': return 'You have the latest version.';
    case 'error': return state.message || 'Couldn’t finish the update. Try again.';
    default: return state.automatic ? 'Updates download in the background and install when you quit. Scorebug won’t restart in the middle of a game.' : 'Automatic checks are off. Use Check for updates whenever you want.';
  }
}

export function mountDesktopUpdates(root, bridge = window.scorebugDesktop) {
  if (!root) return () => {};
  root.hidden = !bridge;
  if (!bridge) return () => {};
  const find = (id) => root.querySelector(`#${id}`);
  const version = find('update-version'), status = find('update-status'), controls = find('update-controls');
  const automatic = find('update-automatic'), check = find('update-check'), restart = find('update-restart');
  const install = find('update-install'), error = find('update-error');
  if (![version, status, controls, automatic, check, restart, install, error].every(Boolean)) return () => {};

  const supported = ['getUpdateState', 'checkForUpdates', 'restartToUpdate', 'setAutomaticUpdates', 'onUpdateStateChanged']
    .every((name) => typeof bridge[name] === 'function');
  let state = null, failure = '', busy = false, disposed = false, revision = 0, unsubscribe;
  function render() {
    if (disposed) return;
    version.textContent = state?.currentVersion ? `Version ${state.currentVersion}` : 'Version unavailable';
    status.textContent = !supported ? 'Install the Windows version once for automatic updates. Your saved game and position will carry over.'
      : state ? statusText(state) : busy ? 'Loading update status…' : 'Update status is unavailable. Try again.';
    const installed = supported && (!state || state.mode === 'installed');
    controls.hidden = !installed;
    install.hidden = supported && (!state || !['portable', 'manual-mac', 'unsupported'].includes(state.mode));
    const mac = state?.mode === 'manual-mac';
    const download = install.matches('a') ? install : install.querySelector('a');
    if (download) {
      download.textContent = mac ? 'Download the latest Mac version' : 'Download the Windows installer';
      download.href = mac ? state.downloadURL || 'https://github.com/aaraven99/scorebug/releases/latest' : 'https://github.com/aaraven99/scorebug/releases/latest/download/Scorebug-Setup-Windows.exe';
    }
    automatic.checked = state?.automatic === true;
    automatic.disabled = !installed || !state || busy;
    check.disabled = !installed || busy || ['checking', 'downloading'].includes(state?.status);
    restart.hidden = state?.mode !== 'installed' || state.status !== 'ready';
    restart.disabled = busy;
    error.textContent = failure;
    error.hidden = !failure;
  }
  function accept(value) {
    const next = updateState(value);
    if (!next) return false;
    state = next; failure = ''; render(); return true;
  }
  async function readState() {
    const startedAt = revision;
    const next = await bridge.getUpdateState();
    if (!disposed && revision === startedAt && !accept(next)) throw new Error('Invalid update status');
  }
  async function run(action, args = []) {
    if (busy || disposed || !supported) return;
    busy = true; failure = ''; render();
    const startedAt = revision;
    try {
      const next = await bridge[action](...args);
      if (!disposed && revision === startedAt && !accept(next)) await readState();
    } catch {
      if (!disposed && revision === startedAt) failure = action === 'setAutomaticUpdates'
        ? 'Couldn’t save that setting. Try again.' : action === 'restartToUpdate'
          ? 'Couldn’t restart for the update. Try again when you’re ready.' : 'Couldn’t check for updates. Try again.';
    } finally { busy = false; render(); }
  }
  const onCheck = () => run(state ? 'checkForUpdates' : 'getUpdateState');
  const onRestart = () => { if (state?.status === 'ready') run('restartToUpdate'); };
  const onAutomatic = () => run('setAutomaticUpdates', [automatic.checked]);
  check.addEventListener('click', onCheck);
  restart.addEventListener('click', onRestart);
  automatic.addEventListener('change', onAutomatic);
  if (supported) {
    try {
      unsubscribe = bridge.onUpdateStateChanged((value) => {
        if (disposed) return;
        if (accept(value)) revision += 1;
        else { failure = 'Update status is unavailable. Try again.'; render(); }
      });
    } catch { failure = 'Update status may not refresh automatically. Use Check for updates to refresh it.'; }
    void run('getUpdateState');
  } else render();
  return () => {
    disposed = true;
    check.removeEventListener('click', onCheck);
    restart.removeEventListener('click', onRestart);
    automatic.removeEventListener('change', onAutomatic);
    if (typeof unsubscribe === 'function') { try { unsubscribe(); } catch { /* The settings window is already closing. */ } }
  };
}
