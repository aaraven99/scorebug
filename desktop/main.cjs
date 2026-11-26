'use strict';

const { app, BrowserWindow, Menu, Tray, nativeImage, screen, ipcMain, globalShortcut, shell, dialog, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { ANCHORS, ANCHOR_LABELS, anchorBounds, clampBounds, nearestAnchor, displayForBounds, containsPoint, detailsBounds, scorebugHitBounds, hoverBridge } = require('./geometry.cjs');
const { HoverIntent } = require('./hover.cjs');

const BASE_SIZE = { width: 520, height: 144 };
const VERTICAL_SIZE = { width: 160, height: 340 };
const DEFAULTS = Object.freeze({
  gameId: null,
  team: 'CHI',
  date: null,
  scale: 1,
  anchor: 'bottom-center',
  snapEnabled: true,
  locked: false,
  orientation: 'horizontal',
  bounds: null,
  displayId: null
});
const EXTERNAL_HOSTS = new Set(['github.com', 'www.espn.com', 'espn.com', 'vercel.com', 'learn.microsoft.com']);
const SMOKE_TEST = !app.isPackaged && process.argv.includes('--smoke-test');

let widget = null;
let settings = null;
let details = null;
let detailsExplicit = false;
let detailsHoverTimer = null;
const hoverIntent = new HoverIntent();
let tray = null;
let httpServer = null;
let origin = null;
let preferences = { ...DEFAULTS };
let preferencesPath = '';
let applyingBounds = false;
let boundsGuardTimer = null;
let moveTimer = null;
let nativeMoveInProgress = false;
let quitting = false;
let smokeExitCode = 0;

app.setName('Scorebug');
if (SMOKE_TEST) {
  const temporaryUserData = process.env.SCOREBUG_SMOKE_USER_DATA || fs.mkdtempSync(path.join(os.tmpdir(), 'scorebug-smoke-'));
  app.setPath('userData', temporaryUserData);
}
if (process.platform === 'win32') app.setAppUserModelId('dev.aarav.scorebug');

function cleanPatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError('Preferences must be an object');
  const clean = {};
  if (Object.hasOwn(patch, 'gameId')) {
    if (patch.gameId !== null && (typeof patch.gameId !== 'string' || !/^\d{1,15}$/.test(patch.gameId))) {
      throw new TypeError('Invalid game ID');
    }
    clean.gameId = patch.gameId;
  }
  if (Object.hasOwn(patch, 'team')) {
    if (typeof patch.team !== 'string' || !/^[A-Z]{2,4}$/.test(patch.team)) throw new TypeError('Invalid team');
    clean.team = patch.team;
  }
  if (Object.hasOwn(patch, 'date')) {
    if (patch.date !== null && (typeof patch.date !== 'string' || !/^\d{8}$/.test(patch.date))) throw new TypeError('Invalid date');
    if (patch.date !== null) {
      const iso = `${patch.date.slice(0, 4)}-${patch.date.slice(4, 6)}-${patch.date.slice(6, 8)}`;
      const parsed = new Date(`${iso}T00:00:00Z`);
      if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== iso) throw new TypeError('Invalid date');
    }
    clean.date = patch.date;
  }
  if (Object.hasOwn(patch, 'scale')) {
    if (typeof patch.scale !== 'number' || !Number.isFinite(patch.scale)) throw new TypeError('Invalid size');
    clean.scale = Math.min(1.8, Math.max(0.65, patch.scale));
  }
  if (Object.hasOwn(patch, 'anchor')) {
    if (patch.anchor !== null && !ANCHORS.includes(patch.anchor)) throw new TypeError('Invalid position');
    clean.anchor = patch.anchor;
  }
  for (const key of ['snapEnabled', 'locked']) {
    if (Object.hasOwn(patch, key)) {
      if (typeof patch[key] !== 'boolean') throw new TypeError(`Invalid ${key}`);
      clean[key] = patch[key];
    }
  }
  return clean;
}

function publicPreferences() {
  const { gameId, team, date, scale, anchor, snapEnabled, locked, orientation } = preferences;
  return { gameId, team, date, scale, anchor, snapEnabled, locked, orientation };
}

function orientationForAnchor(anchor) {
  return anchor === 'middle-left' || anchor === 'middle-right' ? 'vertical' : 'horizontal';
}

function readPreferences() {
  preferencesPath = path.join(app.getPath('userData'), 'preferences.json');
  try {
    if (fs.statSync(preferencesPath).size > 64 * 1024) return;
    const saved = JSON.parse(fs.readFileSync(preferencesPath, 'utf8'));
    preferences = { ...DEFAULTS, ...cleanPatch(saved) };
    preferences.orientation = preferences.anchor ? orientationForAnchor(preferences.anchor) : saved.orientation === 'vertical' ? 'vertical' : 'horizontal';
    if (saved.bounds && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(saved.bounds[key]))) {
      preferences.bounds = saved.bounds;
    }
    if (Number.isFinite(saved.displayId)) preferences.displayId = saved.displayId;
  } catch {
    // A first launch or a damaged preference file starts with safe visible defaults.
    preferences = { ...DEFAULTS };
  }
}

function savePreferences() {
  try {
    fs.mkdirSync(path.dirname(preferencesPath), { recursive: true });
    const temporaryPath = `${preferencesPath}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(preferences, null, 2));
    fs.renameSync(temporaryPath, preferencesPath);
  } catch {
    console.warn('Scorebug could not save desktop preferences. The current session still works.');
  }
}

function publishPreferences() {
  const value = publicPreferences();
  for (const win of [widget, settings, details]) {
    if (win && !win.isDestroyed()) win.webContents.send('scorebug:preferences:changed', value);
  }
  updateTray();
}

function currentSize() {
  const size = preferences.orientation === 'vertical' ? VERTICAL_SIZE : BASE_SIZE;
  return { width: Math.round(size.width * preferences.scale), height: Math.round(size.height * preferences.scale) };
}

function preferredDisplay() {
  const displays = screen.getAllDisplays();
  return displays.find((display) => display.id === preferences.displayId) ||
    (preferences.bounds ? displayForBounds(preferences.bounds, displays, screen.getPrimaryDisplay().id) : screen.getPrimaryDisplay());
}

function placeWidget(forceDisplay) {
  if (!widget || widget.isDestroyed()) return;
  if (preferences.anchor) preferences.orientation = orientationForAnchor(preferences.anchor);
  const display = forceDisplay || preferredDisplay();
  const size = currentSize();
  const bounds = preferences.anchor
    ? anchorBounds(preferences.anchor, size, display.workArea)
    : clampBounds({ ...(preferences.bounds || widget.getBounds()), ...size }, display.workArea);
  applyingBounds = true;
  clearTimeout(boundsGuardTimer);
  widget.setBounds(bounds, false);
  placeDetails();
  preferences.bounds = bounds;
  preferences.displayId = display.id;
  boundsGuardTimer = setTimeout(() => { applyingBounds = false; }, 120);
  savePreferences();
}

function setPreferences(patch) {
  const clean = cleanPatch(patch);
  const needsPosition = Object.hasOwn(clean, 'scale') || Object.hasOwn(clean, 'anchor');
  preferences = { ...preferences, ...clean };
  if (widget && !widget.isDestroyed()) {
    widget.setMovable(!preferences.locked);
    if (needsPosition) placeWidget();
  }
  savePreferences();
  publishPreferences();
  return publicPreferences();
}

function finishMove({ snap = true } = {}) {
  if (!widget || widget.isDestroyed() || applyingBounds || nativeMoveInProgress || preferences.locked) return;
  clearTimeout(moveTimer);
  const bounds = widget.getBounds();
  const display = displayForBounds(bounds, screen.getAllDisplays(), screen.getPrimaryDisplay().id);
  const target = snap && preferences.snapEnabled ? nearestAnchor(bounds, display.workArea) : null;
  preferences.anchor = target ? target.anchor : null;
  preferences.displayId = display.id;
  preferences.bounds = target ? target.bounds : clampBounds(bounds, display.workArea);
  if (target || JSON.stringify(preferences.bounds) !== JSON.stringify(bounds)) placeWidget(display);
  savePreferences();
  publishPreferences();
}

function handleDisplayChange() {
  if (!widget || widget.isDestroyed()) return;
  placeWidget();
  publishPreferences();
  if (settings && !settings.isDestroyed()) {
    const display = screen.getDisplayMatching(settings.getBounds());
    settings.setBounds(clampBounds(settings.getBounds(), display.workArea));
  }
}

function detailsVisible() {
  return Boolean(details && !details.isDestroyed() && details.isVisible());
}

function publishDetailsVisibility() {
  if (widget && !widget.isDestroyed()) widget.webContents.send('scorebug:details:visibility', detailsVisible());
}

function placeDetails() {
  if (!widget || widget.isDestroyed() || !details || details.isDestroyed()) return;
  const bounds = widget.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  details.setBounds(detailsBounds(bounds, area), false);
}

function closeDetails({ dismissed = false } = {}) {
  if (dismissed) hoverIntent.dismiss();
  detailsExplicit = false;
  if (details && !details.isDestroyed()) {
    const closing = details;
    details = null;
    // Destroy the renderer rather than leaving background polls alive while hidden.
    closing.destroy();
  }
  publishDetailsVisibility();
}

function showDetails({ focus = false } = {}) {
  if (!widget || widget.isDestroyed() || nativeMoveInProgress || !widget.isVisible()) return;
  hoverIntent.opened();
  detailsExplicit = detailsExplicit || focus;
  if (details && !details.isDestroyed()) {
    placeDetails();
    if (focus && details.isVisible()) { details.show(); details.focus(); }
    return;
  }
  const area = screen.getDisplayMatching(widget.getBounds()).workArea;
  const win = new BrowserWindow({
    ...detailsBounds(widget.getBounds(), area),
    parent: widget,
    title: 'Scorebug game details',
    show: false,
    frame: false,
    thickFrame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    movable: false,
    hasShadow: false,
    roundedCorners: false,
    webPreferences: webPreferences()
  });
  details = win;
  win.setMenu(null);
  win.setAlwaysOnTop(true, 'floating');
  secureWindow(win);
  win.once('ready-to-show', () => {
    if (details !== win || win.isDestroyed() || !widget || widget.isDestroyed() || nativeMoveInProgress) return;
    if (detailsExplicit) { win.show(); win.focus(); }
    else win.showInactive();
    publishDetailsVisibility();
  });
  win.on('closed', () => {
    if (details === win) { details = null; detailsExplicit = false; }
    publishDetailsVisibility();
  });
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') { event.preventDefault(); closeDetails({ dismissed: true }); }
  });
  win.loadURL(`${origin}/details.html?desktop=1`).catch((error) => {
    if (details === win && !win.isDestroyed()) {
      console.warn(`Scorebug details could not open: ${error.message}`);
      closeDetails({ dismissed: true });
    }
  });
}

function monitorHoverDetails() {
  if (!widget || widget.isDestroyed() || quitting) return;
  const blocked = !widget.isVisible() || widget.isMinimized() || nativeMoveInProgress || applyingBounds;
  const pointer = screen.getCursorScreenPoint();
  const bounds = widget.getBounds();
  const panel = details && !details.isDestroyed() ? details.getBounds() : null;
  const open = Boolean(panel);
  const action = hoverIntent.update({
    now: Date.now(),
    overWidget: containsPoint(open ? bounds : scorebugHitBounds(bounds, preferences.orientation), pointer),
    overDetails: containsPoint(panel, pointer),
    inTransit: containsPoint(hoverBridge(bounds, panel), pointer),
    detailsOpen: open,
    blocked,
    keepOpen: detailsExplicit && details && !details.isDestroyed() && (!details.isVisible() || details.isFocused())
  });
  if (action === 'open') showDetails();
  else if (action === 'close') closeDetails();
}

function isLocalPage(url) {
  try {
    const parsed = new URL(url);
    return parsed.origin === origin && ['/', '/index.html', '/widget.html', '/details.html'].includes(parsed.pathname);
  } catch { return false; }
}

function openAllowedExternal(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' && !parsed.username && !parsed.password && EXTERNAL_HOSTS.has(parsed.hostname)) {
      shell.openExternal(parsed.href).catch(() => {});
    }
  } catch { /* Unknown links are ignored. */ }
}

function secureWindow(win) {
  win.webContents.on('will-navigate', (event) => {
    if (!isLocalPage(event.url)) { event.preventDefault(); openAllowedExternal(event.url); }
  });
  win.webContents.on('will-redirect', (event) => {
    if (!isLocalPage(event.url)) event.preventDefault();
  });
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isLocalPage(url)) {
      if (new URL(url).pathname === '/widget.html') showWidget();
      else if (new URL(url).pathname === '/details.html') showDetails({ focus: true });
      else openSettings();
    } else openAllowedExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('did-finish-load', () => {
    win.webContents.send('scorebug:preferences:changed', publicPreferences());
  });
}

function webPreferences() {
  return {
    preload: path.join(__dirname, 'preload.cjs'),
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    backgroundThrottling: false,
    partition: 'persist:scorebug'
  };
}

function showWidget() {
  if (!widget || widget.isDestroyed()) return;
  if (widget.isMinimized()) widget.restore();
  widget.showInactive();
  widget.setAlwaysOnTop(true, 'floating');
}

function createWidget() {
  const display = preferredDisplay();
  const size = currentSize();
  const initialBounds = preferences.anchor
    ? anchorBounds(preferences.anchor, size, display.workArea)
    : clampBounds({ ...(preferences.bounds || display.workArea), ...size }, display.workArea);
  widget = new BrowserWindow({
    ...initialBounds,
    title: 'Scorebug',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    show: false,
    frame: false,
    thickFrame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    roundedCorners: false,
    movable: !preferences.locked,
    webPreferences: webPreferences()
  });
  preferences.bounds = initialBounds;
  preferences.displayId = display.id;
  widget.setAlwaysOnTop(true, 'floating');
  if (process.platform === 'darwin') widget.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  widget.setMenu(null);
  secureWindow(widget);
  widget.once('ready-to-show', showWidget);
  widget.on('closed', () => { widget = null; if (!quitting) app.quit(); });
  widget.on('will-move', (event) => {
    if (preferences.locked) event.preventDefault();
    else closeDetails();
  });
  widget.on('move', () => {
    if (applyingBounds || nativeMoveInProgress) return;
    closeDetails();
    clearTimeout(moveTimer);
    // Save free placement on other platforms. Windows snapping is deferred until
    // WM_EXITSIZEMOVE, rather than a debounce that could fire while dragging.
    moveTimer = setTimeout(() => finishMove({ snap: false }), 350);
  });
  if (process.platform === 'win32') {
    widget.hookWindowMessage(0x0231, () => { // WM_ENTERSIZEMOVE
      nativeMoveInProgress = true;
      closeDetails();
      clearTimeout(moveTimer);
    });
    widget.hookWindowMessage(0x0232, () => { // WM_EXITSIZEMOVE: the mouse has been released.
      nativeMoveInProgress = false;
      clearTimeout(moveTimer);
      moveTimer = setTimeout(() => finishMove(), 20);
    });
  }
  const contextMenu = () => buildMenu().popup({ window: widget });
  widget.on('system-context-menu', (event) => { event.preventDefault(); contextMenu(); });
  widget.webContents.on('context-menu', contextMenu);
  widget.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') { event.preventDefault(); openSettings(); }
  });
  widget.loadURL(`${origin}/widget.html?desktop=1`).catch(showStartupError);
}

function openSettings() {
  if (!origin) return;
  if (settings && !settings.isDestroyed()) {
    if (settings.isMinimized()) settings.restore();
    settings.show();
    settings.focus();
    return;
  }
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  settings = new BrowserWindow({
    width: Math.min(1060, area.width),
    height: Math.min(800, area.height),
    minWidth: Math.min(620, area.width),
    minHeight: Math.min(500, area.height),
    title: 'Scorebug settings',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#101113',
    autoHideMenuBar: true,
    show: false,
    webPreferences: webPreferences()
  });
  settings.setMenu(null);
  secureWindow(settings);
  settings.once('ready-to-show', () => { if (settings && !settings.isDestroyed()) settings.show(); });
  settings.on('closed', () => { settings = null; });
  settings.loadURL(`${origin}/`).catch(showStartupError);
}

function buildMenu() {
  const displays = screen.getAllDisplays();
  return Menu.buildFromTemplate([
    { label: 'Scorebug', enabled: false },
    { label: 'Choose game & settings', click: openSettings, accelerator: 'CommandOrControl+Alt+Shift+S' },
    { label: 'Show scorebug', click: showWidget },
    { label: 'Current game details', click: () => showDetails({ focus: true }) },
    { type: 'separator' },
    {
      label: 'Position',
      submenu: ANCHORS.map((anchor) => ({
        label: ANCHOR_LABELS[anchor],
        type: 'radio',
        checked: preferences.anchor === anchor,
        click: () => setPreferences({ anchor })
      }))
    },
    {
      label: 'Monitor',
      submenu: displays.map((display, index) => ({
        label: `${display.label || `Display ${index + 1}`} (${display.workArea.width} × ${display.workArea.height})`,
        type: 'radio',
        checked: display.id === preferences.displayId,
        click: () => {
          preferences.displayId = display.id;
          if (!preferences.anchor) preferences.anchor = 'bottom-center';
          placeWidget(display);
          publishPreferences();
        }
      }))
    },
    {
      label: 'Size',
      submenu: [0.65, 0.8, 1, 1.25, 1.5, 1.8].map((scale) => ({
        label: `${Math.round(scale * 100)}%`,
        type: 'radio',
        checked: Math.abs(scale - preferences.scale) < 0.001,
        click: () => setPreferences({ scale })
      }))
    },
    {
      label: 'Snap near corners, sides & center',
      type: 'checkbox',
      checked: preferences.snapEnabled,
      enabled: process.platform === 'win32',
      click: (item) => setPreferences({ snapEnabled: item.checked })
    },
    { label: 'Lock position', type: 'checkbox', checked: preferences.locked, click: (item) => setPreferences({ locked: item.checked }) },
    { type: 'separator' },
    {
      label: 'Reset to bottom center',
      click: () => {
        preferences.displayId = screen.getPrimaryDisplay().id;
        setPreferences({ anchor: 'bottom-center', scale: 1, locked: false });
        showWidget();
      }
    },
    { label: 'Quit Scorebug', click: () => app.quit(), accelerator: 'CommandOrControl+Alt+Shift+Q' }
  ]);
}

function updateTray() {
  if (tray && !tray.isDestroyed()) tray.setContextMenu(buildMenu());
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
  tray = new Tray(icon);
  tray.setToolTip('Scorebug — right-click for position, size and settings');
  tray.on('double-click', openSettings);
  updateTray();
}

function trustedEvent(event) {
  const frame = event.senderFrame;
  const mainFrame = event.sender.mainFrame;
  if (!frame || frame.routingId !== mainFrame.routingId || frame.processId !== mainFrame.processId || !isLocalPage(frame.url)) return false;
  return [widget, settings, details].some((win) => win && !win.isDestroyed() && win.webContents === event.sender);
}

function addHandler(channel, callback) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!trustedEvent(event)) throw new Error('Request denied');
    return callback(...args);
  });
}

function installIpc() {
  addHandler('scorebug:preferences:get', publicPreferences);
  addHandler('scorebug:preferences:set', setPreferences);
  addHandler('scorebug:state', () => ({
    preferences: publicPreferences(),
    anchor: preferences.anchor,
    locked: preferences.locked,
    snapEnabled: preferences.snapEnabled,
    scale: preferences.scale,
    bounds: widget && !widget.isDestroyed() ? widget.getBounds() : preferences.bounds,
    detailsVisible: detailsVisible(),
    platform: process.platform
  }));
  addHandler('scorebug:settings', openSettings);
  addHandler('scorebug:details:show', () => showDetails({ focus: true }));
  addHandler('scorebug:details:hide', () => { setTimeout(() => closeDetails({ dismissed: true }), 0); });
  addHandler('scorebug:quit', () => { setTimeout(() => app.quit(), 0); });
}

function showStartupError(error) {
  if (SMOKE_TEST) {
    smokeExitCode = 1;
    console.error(`[native smoke] FAIL: ${error?.stack || error}`);
    app.quit();
    return;
  }
  dialog.showErrorBox('Scorebug could not start', `${error?.message || 'The local score service could not start.'}\n\nTry reopening Scorebug.`);
  app.quit();
}

async function start() {
  readPreferences();
  const appRoot = app.isPackaged ? path.join(process.resourcesPath, 'scorebug') : path.resolve(__dirname, '..');
  const { createScorebugServer } = await import(pathToFileURL(path.join(appRoot, 'server.mjs')).href);
  httpServer = createScorebugServer();
  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', () => {
      httpServer.removeListener('error', reject);
      resolve();
    });
  });
  origin = `http://127.0.0.1:${httpServer.address().port}`;
  const appSession = session.fromPartition('persist:scorebug');
  appSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  appSession.setPermissionCheckHandler(() => false);
  installIpc();
  createWidget();
  createTray();
  detailsHoverTimer = setInterval(monitorHoverDetails, 100);
  screen.on('display-added', handleDisplayChange);
  screen.on('display-removed', handleDisplayChange);
  screen.on('display-metrics-changed', handleDisplayChange);
  globalShortcut.register('CommandOrControl+Alt+Shift+S', openSettings);
  globalShortcut.register('CommandOrControl+Alt+Shift+Q', () => app.quit());
  savePreferences();
  if (SMOKE_TEST) {
    const { runNativeSmoke } = require('./smoke.cjs');
    await runNativeSmoke({ widget, screen, origin, getSettings: () => settings, getDetails: () => details, preferencesPath });
    app.quit();
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { showWidget(); openSettings(); });
  app.on('activate', () => { showWidget(); openSettings(); });
  app.on('before-quit', () => {
    quitting = true;
    clearTimeout(moveTimer);
    clearTimeout(boundsGuardTimer);
    clearInterval(detailsHoverTimer);
    closeDetails();
    if (preferencesPath) savePreferences();
    globalShortcut.unregisterAll();
    if (httpServer) { httpServer.close(); httpServer.closeAllConnections?.(); }
    if (tray && !tray.isDestroyed()) tray.destroy();
  });
  app.on('window-all-closed', () => app.quit());
  if (SMOKE_TEST) app.on('will-quit', (event) => { event.preventDefault(); app.exit(smokeExitCode); });
  app.whenReady().then(start).catch(showStartupError);
}
