'use strict';

const { app, BrowserWindow, Menu, Tray, nativeImage, screen, ipcMain, globalShortcut, shell, dialog, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const { ANCHORS, ANCHOR_LABELS, anchorBounds, clampBounds, nearestAnchor, displayForBounds, contentAlignmentForAnchor, widgetSize, containsPoint, detailsPlacement, detailsWindowShape, teamAtPoint, hoverBridge } = require('./geometry.cjs');
const { HoverIntent } = require('./hover.cjs');
const { UpdateController } = require('./updates.cjs');
const { DetailsLifecycle } = require('./details-lifecycle.cjs');
const { FullscreenTransitions } = require('./fullscreen.cjs');
const { cleanPatch, cleanSavedPreferences, cleanDetailsContext, cleanDetailsRegions, setFavoriteStyleCatalog } = require('./preferences.cjs');

const DEFAULTS = Object.freeze({
  gameId: null,
  leagueId: 'nfl',
  styleId: 'nfl-blades',
  styleAuto: true,
  racingRows: 6,
  favorites: [],
  favoriteStyleIds: [],
  team: null,
  date: null,
  scale: 1,
  anchor: 'bottom-center',
  snapEnabled: true,
  locked: false,
  autoUpdates: true,
  orientation: 'horizontal',
  contentAlignment: 'bottom',
  bounds: null,
  displayId: null
});
const EXTERNAL_HOSTS = new Set(['github.com', 'www.espn.com', 'espn.com', 'vercel.com', 'learn.microsoft.com', 'support.apple.com']);
const SMOKE_TEST = process.argv.includes('--smoke-test') && (!app.isPackaged || process.env.SCOREBUG_VERIFY_PACKAGE === '1');

let widget = null;
let settings = null;
let gameCenter = null;
let gameCenterFullscreen = null;
let restoreWidgetAfterGameCenter = false;
let details = null;
let detailsSide = null;
let detailsPresentation = null;
// The visible widget owns hover context independently of Automatic preferences.
let detailsGameId = null;
let detailsLeagueId = 'nfl';
let renderedDetailsLayout = null;
let macMoveWatcher = null;
let pendingDetails = null;
let defaultDetailsSide = 'home';
let detailsExplicit = false;
let detailsHoverTimer = null;
const detailsInput = new WeakMap();
const hoverIntent = new HoverIntent();
const detailsLifecycle = new DetailsLifecycle({
  onPhase: (win) => { if (details === win) publishDetailsPresentation(); },
  onClosed: finishDetailsExit
});
let tray = null;
let httpServer = null;
let origin = null;
let preferences = { ...DEFAULTS };
let preferencesPath = '';
let applyingBounds = false;
let boundsGuardTimer = null;
let moveTimer = null;
let nativeMoveInProgress = false;
let moveReleasePending = false;
let macManualMove = false;
let quitting = false;
let quitCleanupDone = false;
let updates = null;
let smokeExitCode = 0;
let scorebugDimensions, getLeague, normalizePreferencePatch, leagueOfId, isScorebugStyle;

app.setName('Scorebug');
if (SMOKE_TEST) {
  // Hosted Intel Mac runners have no usable GPU. Keep real native windows and
  // sandboxing, but use CPU compositing for their screenshot-based smoke run.
  if (process.env.SCOREBUG_SMOKE_SOFTWARE_RENDERING === '1') app.disableHardwareAcceleration();
  const temporaryUserData = process.env.SCOREBUG_SMOKE_USER_DATA || fs.mkdtempSync(path.join(os.tmpdir(), 'scorebug-smoke-'));
  app.setPath('userData', temporaryUserData);
}
if (process.platform === 'win32') app.setAppUserModelId('dev.aarav.scorebug');

function publicPreferences() {
  const { gameId, leagueId, styleId, styleAuto, racingRows, favorites, favoriteStyleIds, team, date, scale, anchor, snapEnabled, locked, orientation, contentAlignment, autoUpdates } = preferences;
  return { gameId, leagueId, styleId, styleAuto, racingRows, favorites: favorites.map((item) => ({ ...item })), favoriteStyleIds: [...favoriteStyleIds], team, date, scale, anchor, snapEnabled, locked, orientation, contentAlignment, autoUpdates };
}

function orientationForAnchor(anchor) {
  return anchor === 'middle-left' || anchor === 'middle-right' ? 'vertical' : 'horizontal';
}

function readPreferences() {
  preferencesPath = path.join(app.getPath('userData'), 'preferences.json');
  try {
    if (fs.statSync(preferencesPath).size > 64 * 1024) return;
    const saved = JSON.parse(fs.readFileSync(preferencesPath, 'utf8'));
    preferences = { ...DEFAULTS, ...cleanSavedPreferences(saved) };
    preferences.orientation = preferences.anchor ? orientationForAnchor(preferences.anchor) : saved.orientation === 'vertical' ? 'vertical' : 'horizontal';
    preferences.contentAlignment = contentAlignmentForAnchor(preferences.anchor, saved.contentAlignment);
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
  for (const win of [widget, settings, details, gameCenter]) {
    if (win && !win.isDestroyed()) win.webContents.send('scorebug:preferences:changed', value);
  }
  updateTray();
}

function publishUpdateState(value) {
  for (const win of [widget, settings, details, gameCenter]) {
    if (win && !win.isDestroyed()) win.webContents.send('scorebug:updates:changed', value);
  }
  updateTray();
}

function currentSize(workArea) {
  const league = getLeague?.(preferences.leagueId);
  const dimensions = scorebugDimensions?.({ leagueId: preferences.leagueId, sport: league?.sport, kind: league?.kind }, preferences);
  return widgetSize(preferences.scale, preferences.orientation, workArea, dimensions);
}

function preferredDisplay() {
  const displays = screen.getAllDisplays();
  return displays.find((display) => display.id === preferences.displayId) ||
    (preferences.bounds ? displayForBounds(preferences.bounds, displays, screen.getPrimaryDisplay().id) : screen.getPrimaryDisplay());
}

function placeWidget(forceDisplay) {
  if (!widget || widget.isDestroyed()) return;
  if (preferences.anchor) preferences.orientation = orientationForAnchor(preferences.anchor);
  preferences.contentAlignment = contentAlignmentForAnchor(preferences.anchor, preferences.contentAlignment);
  const display = forceDisplay || preferredDisplay();
  const size = currentSize(display.workArea);
  const bounds = preferences.anchor
    ? anchorBounds(preferences.anchor, size, display.workArea)
    : clampBounds({ ...(preferences.bounds || widget.getBounds()), ...size }, display.workArea);
  applyingBounds = true;
  clearTimeout(boundsGuardTimer);
  if (bounds.width !== widget.getBounds().width || bounds.height !== widget.getBounds().height) renderedDetailsLayout = { targets: [], panels: {}, styleId: preferences.styleId };
  widget.setBounds(bounds, false);
  placeDetails();
  preferences.bounds = bounds;
  preferences.displayId = display.id;
  boundsGuardTimer = setTimeout(() => { applyingBounds = false; }, 120);
  savePreferences();
}

function setPreferences(patch) {
  const clean = cleanPatch(patch);
  const needsPosition = ['scale', 'anchor', 'racingRows', 'leagueId', 'styleId'].some(key => Object.hasOwn(clean, key));
  const leagueChanged = clean.leagueId !== undefined && clean.leagueId !== preferences.leagueId;
  const styleChanged = clean.styleId !== undefined && clean.styleId !== preferences.styleId;
  preferences = { ...preferences, ...clean };
  if (leagueChanged) {
    if (!Object.hasOwn(clean, 'gameId')) preferences.gameId = null;
    if (!Object.hasOwn(clean, 'team')) preferences.team = null;
    detailsGameId = null;
    detailsLeagueId = preferences.leagueId;
    closeDetails({ immediate: true });
  }
  if (leagueChanged || styleChanged) renderedDetailsLayout = { targets: [], panels: {}, styleId: preferences.styleId };
  if (Object.hasOwn(clean, 'autoUpdates')) updates?.setAutomaticUpdates(clean.autoUpdates);
  if (widget && !widget.isDestroyed()) {
    widget.setMovable(!preferences.locked);
    if (needsPosition) placeWidget();
  }
  savePreferences();
  publishPreferences();
  return publicPreferences();
}

function finishMove({ snap = true } = {}) {
  macManualMove = false;
  if (!widget || widget.isDestroyed() || applyingBounds || nativeMoveInProgress || preferences.locked) return;
  clearTimeout(moveTimer);
  moveReleasePending = false;
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

function macDownloadURL() {
  return `https://github.com/aaraven99/scorebug/releases/latest/download/Scorebug-Mac-${process.arch === 'arm64' ? 'Apple-Silicon' : 'Intel'}.dmg`;
}

function watchMacDragRelease() {
  if (macMoveWatcher || process.platform !== 'darwin' || applyingBounds) return;
  const helper = app.isPackaged ? path.join(process.resourcesPath, 'mac-mouse-release') : path.join(__dirname, 'native', 'bin', 'mac-mouse-release');
  if (!fs.existsSync(helper)) return;
  nativeMoveInProgress = true;
  clearTimeout(moveTimer);
  const watcher = spawn(helper, [], { stdio: 'ignore', timeout: 120_000 });
  macMoveWatcher = watcher;
  let handled = false;
  const finish = (success) => {
    if (handled) return;
    handled = true;
    if (macMoveWatcher === watcher) macMoveWatcher = null;
    if (quitting || !widget || widget.isDestroyed()) return;
    nativeMoveInProgress = false;
    macManualMove = false;
    // If the OS query fails, retain free placement. Never snap while a held
    // drag might still be in progress. The menu's explicit positions still work.
    if (success) finishNativeMove();
    else finishMove({ snap: false });
  };
  watcher.once('error', () => finish(false));
  watcher.once('exit', (code) => finish(code === 0));
}

function finishNativeMove() {
  nativeMoveInProgress = false;
  macManualMove = false;
  if (applyingBounds || !widget || widget.isDestroyed() || preferences.locked) return;
  moveReleasePending = true;
  clearTimeout(moveTimer);
  // Both Electron's completion event and WM_EXITSIZEMOVE can arrive for the
  // same drag. Coalesce them after the OS has committed its final bounds.
  moveTimer = setTimeout(() => finishMove(), 20);
}

function handleDisplayChange() {
  if (!widget || widget.isDestroyed()) return;
  placeWidget();
  publishPreferences();
  if (settings && !settings.isDestroyed()) {
    const display = screen.getDisplayMatching(settings.getBounds());
    settings.setBounds(clampBounds(settings.getBounds(), display.workArea));
  }
  if (gameCenter && !gameCenter.isDestroyed() && !gameCenter.isFullScreen()) {
    const display = screen.getDisplayMatching(gameCenter.getBounds());
    gameCenter.setBounds(clampBounds(gameCenter.getBounds(), display.workArea));
  }
}

function detailsVisible() {
  return Boolean(details && !details.isDestroyed() && details.isVisible());
}

function publishDetailsVisibility() {
  if (widget && !widget.isDestroyed()) widget.webContents.send('scorebug:details:visibility', detailsVisible());
}

function cleanDetailsSide(side) {
  if (!['home', 'away', 'comparison'].includes(side)) throw new TypeError('Invalid details panel');
  return side;
}

function publishDetailsSide() {
  if (!detailsSide) return;
  if (details && !details.isDestroyed()) details.setTitle(detailsSide === 'comparison' ? 'Scorebug game comparison' : 'Scorebug team stats');
  for (const win of [widget, details]) {
    if (win && !win.isDestroyed()) win.webContents.send('scorebug:details:side', detailsSide);
  }
}

function getDetailsPresentation() {
  if (!details || details.isDestroyed() || !detailsPresentation) return null;
  return { ...detailsPresentation, gameId: detailsGameId, leagueId: detailsLeagueId, styleId: preferences.styleId, phase: detailsLifecycle.phaseFor(details) };
}

function setDetailsContext(value) {
  const context = cleanDetailsContext(value);
  if (detailsGameId !== context.gameId || detailsLeagueId !== context.leagueId) {
    detailsGameId = context.gameId;
    detailsLeagueId = context.leagueId;
    publishDetailsPresentation();
  }
  return context;
}

function setDetailsGameId(gameId) {
  return setDetailsContext({ gameId, leagueId: typeof gameId === 'string' && gameId.includes(':') ? gameId.split(':')[0] : gameId === null ? preferences.leagueId : 'nfl' }).gameId;
}

function setDetailsRegions(value) {
  if (!widget || widget.isDestroyed()) return;
  const viewport = widget.getContentBounds();
  // A measured frame can arrive after the OS has already resized the window.
  // The next renderer resize frame replaces it; old dimensions are not trusted.
  if (value?.viewport && (value.viewport.width !== viewport.width || value.viewport.height !== viewport.height)) return;
  renderedDetailsLayout = cleanDetailsRegions(value, viewport);
  placeDetails();
}

function placementOptions(side) {
  return { side, orientation: preferences.orientation, contentAlignment: preferences.contentAlignment,
    measuredLayout: renderedDetailsLayout?.legacyBlades === true ? null : renderedDetailsLayout };
}

function publishDetailsPresentation() {
  const value = getDetailsPresentation();
  for (const win of [widget, details]) {
    if (win && !win.isDestroyed()) win.webContents.send('scorebug:details:presentation', value);
  }
}

function placeDetails() {
  if (!widget || widget.isDestroyed() || !details || details.isDestroyed()) return;
  const bounds = widget.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  const placement = detailsPlacement(bounds, area, placementOptions(detailsSide || defaultDetailsSide));
  detailsPresentation = placement.presentation;
  details.setBounds(placement.bounds, false);
  applyDetailsShape(details, placement.presentation);
  publishDetailsPresentation();
}

function applyDetailsShape(win, presentation) {
  const regions = detailsWindowShape(presentation);
  if (detailsInput.get(win)?.ignored) win.setIgnoreMouseEvents(false);
  const state = { regions, native: false, ignored: false };
  // Shaping also makes the transparent area around the long top connector
  // click-through, leaving the widget's controls usable underneath it.
  if (process.platform === 'win32' || process.platform === 'linux') {
    try { win.setShape(regions); state.native = true; }
    catch { /* The cursor-based fallback below covers unsupported compositors. */ }
  }
  detailsInput.set(win, state);
}

function updateDetailsInput(pointer, bounds) {
  const state = details && detailsInput.get(details);
  if (!state || state.native) return;
  const local = bounds && { x: pointer.x - bounds.x, y: pointer.y - bounds.y };
  const ignored = Boolean(local && state.regions.length && containsPoint(bounds, pointer) && !state.regions.some((region) => containsPoint(region, local)));
  if (ignored !== state.ignored) {
    details.setIgnoreMouseEvents(ignored, { forward: true });
    state.ignored = ignored;
  }
}

function finishDetailsExit(win) {
  if (details !== win) {
    if (!win.isDestroyed()) win.destroy();
    return;
  }
  const next = pendingDetails;
  pendingDetails = null;
  if (next && !quitting && !nativeMoveInProgress && widget && !widget.isDestroyed() && widget.isVisible() && !win.isDestroyed()) {
    // The old blade is fully collapsed before moving its native bounds. Reuse
    // the renderer and let only the latest requested team's blade unfold.
    detailsSide = next.side;
    detailsExplicit = next.focus;
    hoverIntent.opened();
    placeDetails();
    publishDetailsSide();
    detailsLifecycle.open(win);
    if (next.focus) { win.show(); win.focus(); }
    publishDetailsVisibility();
    return;
  }
  details = null;
  detailsSide = null;
  detailsPresentation = null;
  detailsExplicit = false;
  detailsLifecycle.forget(win);
  if (!win.isDestroyed()) win.destroy();
  publishDetailsVisibility();
  publishDetailsPresentation();
}

function closeDetails({ dismissed = false, immediate = false } = {}) {
  if (dismissed) hoverIntent.dismiss();
  detailsExplicit = false;
  pendingDetails = null;
  if (details && !details.isDestroyed()) {
    // Exit animation is bounded, so a dismissed renderer cannot keep polling
    // invisibly. Drag, hide, startup failure and shutdown bypass the animation.
    detailsLifecycle.close(details, { immediate: immediate || !details.isVisible() });
  } else {
    if (details) detailsLifecycle.forget(details);
    details = null;
    detailsSide = null;
    detailsPresentation = null;
    publishDetailsVisibility();
    publishDetailsPresentation();
  }
}

function showDetails({ focus = false, side = defaultDetailsSide } = {}) {
  cleanDetailsSide(side);
  if (quitting || !widget || widget.isDestroyed() || nativeMoveInProgress || !widget.isVisible()) return;
  hoverIntent.opened();
  if (details && !details.isDestroyed()) {
    const phase = detailsLifecycle.phaseFor(details);
    if (detailsSide !== side && details.isVisible() && phase !== 'closed') {
      pendingDetails = { side, focus: detailsExplicit || focus };
      detailsLifecycle.close(details);
      return;
    }
    pendingDetails = null;
    const changed = detailsSide !== side;
    detailsSide = side;
    detailsExplicit = detailsExplicit || focus;
    placeDetails();
    if (changed) publishDetailsSide();
    if (details.isVisible() && (phase === 'closing' || phase === 'closed' || changed)) detailsLifecycle.open(details);
    if (focus && details.isVisible()) { details.show(); details.focus(); }
    return;
  }
  pendingDetails = null;
  detailsSide = side;
  detailsExplicit = focus;
  const area = screen.getDisplayMatching(widget.getBounds()).workArea;
  const placement = detailsPlacement(widget.getBounds(), area, placementOptions(side));
  detailsPresentation = placement.presentation;
  const win = new BrowserWindow({
    ...placement.bounds,
    parent: widget,
    title: side === 'comparison' ? 'Scorebug game comparison' : 'Scorebug team stats',
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
  applyDetailsShape(win, placement.presentation);
  win.setMenu(null);
  win.setAlwaysOnTop(true, 'floating');
  if (process.platform === 'darwin') win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  secureWindow(win);
  win.once('ready-to-show', () => {
    if (details !== win || win.isDestroyed() || quitting || !widget || widget.isDestroyed() || nativeMoveInProgress) return;
    if (detailsExplicit) { win.show(); win.focus(); }
    else win.showInactive();
    detailsLifecycle.open(win);
    publishDetailsVisibility();
  });
  win.on('closed', () => {
    detailsLifecycle.forget(win);
    if (details === win) {
      details = null;
      detailsExplicit = false;
      detailsSide = null;
      detailsPresentation = null;
      pendingDetails = null;
    }
    publishDetailsVisibility();
    publishDetailsPresentation();
  });
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') { event.preventDefault(); closeDetails({ dismissed: true }); }
  });
  const query = new URLSearchParams({ desktop: '1', ...placement.presentation, phase: 'closed' });
  win.loadURL(`${origin}/details.html?${query}`).catch((error) => {
    if (details === win && !win.isDestroyed()) {
      console.warn(`Scorebug details could not open: ${error.message}`);
      closeDetails({ dismissed: true, immediate: true });
    }
  });
}

function monitorHoverDetails() {
  if (!widget || widget.isDestroyed() || quitting) return;
  const blocked = !widget.isVisible() || widget.isMinimized() || nativeMoveInProgress || applyingBounds;
  const pointer = screen.getCursorScreenPoint();
  const bounds = widget.getBounds();
  const panel = details && !details.isDestroyed() ? details.getBounds() : null;
  updateDetailsInput(pointer, panel);
  const open = Boolean(panel);
  const localPoint = { x: pointer.x - bounds.x, y: pointer.y - bounds.y };
  const side = renderedDetailsLayout ? renderedDetailsLayout.targets.find((region) => containsPoint(region, localPoint))?.side || null
    : teamAtPoint(bounds, pointer, preferences.orientation, preferences.contentAlignment);
  const overDetails = containsPoint(panel, pointer);
  if (open && detailsLifecycle.phaseFor(details) === 'closing' && !blocked && !hoverIntent.dismissed && (side || overDetails)) {
    // Returning to the old team reverses the same CSS transition immediately.
    // A different team only replaces the queued destination, not the exit timer.
    showDetails({ side: side || detailsSide });
    return;
  }
  const action = hoverIntent.update({
    now: Date.now(),
    overWidget: Boolean(side),
    overDetails,
    inTransit: containsPoint(hoverBridge(bounds, panel), pointer),
    detailsOpen: open,
    side,
    activeSide: detailsSide,
    blocked,
    keepOpen: detailsExplicit && details && !details.isDestroyed() && (!details.isVisible() || details.isFocused())
  });
  if (action === 'open' || action === 'switch') showDetails({ side: side || defaultDetailsSide });
  else if (action === 'close') closeDetails({ immediate: blocked });
}

function isLocalPage(url) {
  try {
    const parsed = new URL(url);
    return parsed.origin === origin && ['/', '/index.html', '/widget.html', '/details.html', '/game.html', '/standby.html'].includes(parsed.pathname);
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
    else if (new URL(event.url).pathname === '/game.html' && win !== gameCenter) {
      // Standby's per-game links must reach the real dashboard window. Loading
      // the dashboard inside Settings would fail its restricted fullscreen IPC.
      event.preventDefault();
      openGameCenter(event.url);
    }
    else if (new URL(event.url).pathname === '/game.html') applyGameCenterContext(gameCenterURL(event.url));
  });
  win.webContents.on('will-redirect', (event) => {
    if (!isLocalPage(event.url)) event.preventDefault();
  });
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isLocalPage(url)) {
      if (new URL(url).pathname === '/widget.html') showWidget();
      else if (new URL(url).pathname === '/details.html') {
        const side = new URL(url).searchParams.get('side');
        showDetails({ focus: true, side: ['home', 'away', 'comparison'].includes(side) ? side : defaultDetailsSide });
      }
      else if (new URL(url).pathname === '/standby.html') win.loadURL(url).catch(showStartupError);
      else if (new URL(url).pathname === '/game.html') openGameCenter(url);
      else openSettings();
    } else openAllowedExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('did-finish-load', () => {
    win.webContents.send('scorebug:preferences:changed', publicPreferences());
    if (updates) win.webContents.send('scorebug:updates:changed', updates.getState());
    if (win === details) { publishDetailsSide(); publishDetailsPresentation(); }
    if (win === gameCenter) publishGameCenterState();
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
  const size = currentSize(display.workArea);
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
  widget.on('hide', () => closeDetails({ immediate: true }));
  widget.on('minimize', () => closeDetails({ immediate: true }));
  widget.on('will-move', (event) => {
    if (preferences.locked) event.preventDefault();
    else {
      if (process.platform === 'win32') nativeMoveInProgress = true;
      if (process.platform === 'darwin') {
        // Electron emits will-move only for manual movement. Keep a fallback
        // for an unavailable helper, without treating Dock/Spaces moves as drags.
        macManualMove = true;
        watchMacDragRelease();
      }
      closeDetails({ immediate: true });
    }
  });
  widget.on('move', () => {
    // Passive HWND, Dock and Spaces notifications must preserve the anchor.
    // Mac manual drags normally finish through the physical-release helper;
    // only a real will-move may enable its free-placement fallback below.
    if (process.platform === 'win32' || (process.platform === 'darwin' && !macManualMove) || applyingBounds || nativeMoveInProgress || moveReleasePending) return;
    closeDetails({ immediate: true });
    clearTimeout(moveTimer);
    // Save free placement on other platforms. Windows snapping is deferred until
    // WM_EXITSIZEMOVE, rather than a debounce that could fire while dragging.
    moveTimer = setTimeout(() => finishMove({ snap: false }), 350);
  });
  if (process.platform === 'win32') {
    // Electron's completion event covers Windows move paths that do not reach
    // the raw hook. Unlike a move debounce, it cannot snap a held drag early.
    widget.on('moved', finishNativeMove);
    widget.hookWindowMessage(0x0231, () => { // WM_ENTERSIZEMOVE
      nativeMoveInProgress = true;
      moveReleasePending = false;
      closeDetails({ immediate: true });
      clearTimeout(moveTimer);
    });
    widget.hookWindowMessage(0x0232, finishNativeMove); // WM_EXITSIZEMOVE: the mouse has been released.
  }
  const contextMenu = () => buildMenu().popup({ window: widget });
  widget.on('system-context-menu', (event) => { event.preventDefault(); contextMenu(); });
  widget.webContents.on('context-menu', contextMenu);
  widget.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') { event.preventDefault(); openSettings(); }
  });
  widget.loadURL(`${origin}/widget.html?desktop=1`).catch(showStartupError);
}

function getGameCenterState() {
  const open = Boolean(gameCenter && !gameCenter.isDestroyed());
  return { open, fullscreen: open && Boolean(gameCenterFullscreen?.value) };
}

function publishGameCenterState() {
  const state = getGameCenterState();
  for (const win of [widget, settings, gameCenter]) {
    if (win && !win.isDestroyed()) win.webContents.send('scorebug:game-center:changed', state);
  }
}

function restoreFloatingWidget() {
  const restore = restoreWidgetAfterGameCenter;
  restoreWidgetAfterGameCenter = false;
  if (restore && !quitting) showWidget();
}

function setGameCenterFullscreen(fullscreen) {
  if (typeof fullscreen !== 'boolean') throw new TypeError('Fullscreen must be true or false');
  if (!gameCenter || gameCenter.isDestroyed()) return getGameCenterState();
  gameCenterFullscreen.request(fullscreen);
  return getGameCenterState();
}

function gameCenterURL(candidate) {
  const result = new URL('/game.html', origin);
  if (typeof candidate === 'string' && candidate.length <= 4096) {
    try {
      const requested = new URL(candidate);
      if (requested.origin === origin && requested.pathname === '/game.html' && !requested.username && !requested.password) {
        for (const key of ['league', 'game', 'style', 'date', 'rows']) {
          if (requested.searchParams.has(key)) result.searchParams.set(key, requested.searchParams.get(key));
        }
      }
    } catch { /* Invalid destinations keep the current native selection. */ }
  }
  result.searchParams.set('desktop', '1');
  return result.href;
}

function applyGameCenterContext(destination) {
  const params = new URL(destination).searchParams, raw = {};
  for (const [key, parameter] of [['leagueId', 'league'], ['gameId', 'game'], ['styleId', 'style'], ['date', 'date']]) {
    if (params.has(parameter)) raw[key] = params.get(parameter);
  }
  if (/^\d{1,2}$/.test(params.get('rows') || '')) raw.racingRows = Number(params.get('rows'));
  const patch = normalizePreferencePatch(raw);
  if (patch.styleId && !isScorebugStyle(patch.styleId)) delete patch.styleId;
  if (patch.styleId) patch.styleAuto = false;
  if (patch.gameId) {
    patch.leagueId ||= leagueOfId(patch.gameId);
    if (leagueOfId(patch.gameId) !== patch.leagueId) patch.gameId = null;
  }
  if (patch.leagueId && patch.leagueId !== preferences.leagueId && !Object.hasOwn(patch, 'gameId')) patch.gameId = null;
  if (['leagueId', 'gameId', 'date'].some(key => Object.hasOwn(patch, key))) patch.team = null;
  // The renderer and native window geometry must share one selection. Applying
  // only URL preferences in the renderer could be undone by a later native event.
  if (Object.keys(patch).length) setPreferences(patch);
}

function openGameCenter(contextURL) {
  if (!origin || quitting) return getGameCenterState();
  const destination = gameCenterURL(contextURL);
  applyGameCenterContext(destination);
  closeDetails({ immediate: true });
  if (gameCenter && !gameCenter.isDestroyed()) {
    if (contextURL || new URL(gameCenter.webContents.getURL() || origin).pathname !== '/game.html') {
      gameCenter.loadURL(destination).catch(showStartupError);
    }
    if (gameCenter.isMinimized()) gameCenter.restore();
    gameCenter.show();
    setGameCenterFullscreen(true);
    gameCenter.focus();
    return getGameCenterState();
  }
  const area = widget && !widget.isDestroyed()
    ? screen.getDisplayMatching(widget.getBounds()).workArea
    : screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const width = Math.min(1440, area.width), height = Math.min(960, area.height);
  const win = new BrowserWindow({
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    width, height,
    minWidth: Math.min(680, area.width),
    minHeight: Math.min(500, area.height),
    title: 'Scorebug — Game Center',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#101512',
    autoHideMenuBar: true,
    show: false,
    fullscreenable: true,
    webPreferences: webPreferences()
  });
  gameCenter = win;
  gameCenterFullscreen = new FullscreenTransitions((fullscreen) => {
    if (fullscreen && widget && !widget.isDestroyed() && widget.isVisible()) {
      restoreWidgetAfterGameCenter = true;
      widget.hide();
    }
    win.setFullScreen(fullscreen);
  });
  win.setMenu(null);
  secureWindow(win);
  win.once('ready-to-show', () => {
    if (gameCenter !== win || win.isDestroyed() || quitting) return;
    win.show();
    setGameCenterFullscreen(true);
    win.focus();
    publishGameCenterState();
  });
  win.on('enter-full-screen', () => {
    if (gameCenter !== win || win.isDestroyed()) return;
    gameCenterFullscreen.settled(true);
    if (widget && !widget.isDestroyed() && widget.isVisible()) {
      restoreWidgetAfterGameCenter = true;
      widget.hide();
    }
    closeDetails({ immediate: true });
    publishGameCenterState();
  });
  win.on('leave-full-screen', () => {
    if (gameCenter !== win || win.isDestroyed()) return;
    gameCenterFullscreen.settled(false);
    if (!gameCenterFullscreen.target) restoreFloatingWidget();
    publishGameCenterState();
  });
  win.on('closed', () => {
    if (gameCenter === win) { gameCenter = null; gameCenterFullscreen = null; }
    restoreFloatingWidget();
    publishGameCenterState();
  });
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'Escape' && (gameCenterFullscreen?.value || gameCenterFullscreen?.target)) {
      event.preventDefault();
      setGameCenterFullscreen(false);
    } else if (input.key === 'F11' && !input.isAutoRepeat) {
      event.preventDefault();
      setGameCenterFullscreen(!gameCenterFullscreen.target);
    }
  });
  win.loadURL(destination).catch((error) => {
    console.warn(`Scorebug Game Center could not open: ${error.message}`);
    if (!win.isDestroyed()) win.close();
  });
  return getGameCenterState();
}

function openSettings() {
  if (!origin) return;
  if (settings && !settings.isDestroyed()) {
    if (!['/', '/index.html'].includes(new URL(settings.webContents.getURL() || origin).pathname)) {
      settings.loadURL(`${origin}/?desktop=1`).catch(showStartupError);
    }
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
  const updateState = updates?.getState();
  let updateItem = { label: 'Updates', click: openSettings };
  if (updateState?.mode === 'installed') {
    if (updateState.status === 'ready') updateItem = { label: 'Restart to update', click: () => updates.restartToUpdate() };
    else if (updateState.status === 'checking') updateItem = { label: 'Checking for updates…', enabled: false };
    else if (updateState.status === 'downloading') updateItem = { label: `Downloading update${updateState.percent === null ? '…' : ` (${updateState.percent}%)`}`, enabled: false };
    else updateItem = { label: 'Check for updates', click: () => { void updates.checkForUpdates(); } };
  } else if (updateState?.mode === 'portable') {
    updateItem = { label: 'Get automatic updates', click: openSettings };
  } else if (updateState?.mode === 'manual-mac') {
    updateItem = { label: 'Download the latest Mac version', click: () => openAllowedExternal(macDownloadURL()) };
  }
  return Menu.buildFromTemplate([
    { label: `Scorebug ${app.getVersion()}`, enabled: false },
    { label: 'Choose game & settings', click: openSettings, accelerator: 'CommandOrControl+Alt+Shift+S' },
    { label: 'Full-screen game view', click: openGameCenter },
    { label: 'Show scorebug', click: showWidget },
    { label: 'Current team stats', click: () => showDetails({ focus: true }) },
    { label: 'Compare teams', click: () => showDetails({ focus: true, side: 'comparison' }) },
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
      enabled: process.platform === 'win32' || process.platform === 'darwin',
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
    updateItem,
    { label: 'Quit Scorebug', click: () => app.quit(), accelerator: 'CommandOrControl+Alt+Shift+Q' }
  ]);
}

function updateTray() {
  if (tray && !tray.isDestroyed()) tray.setContextMenu(buildMenu());
}

function createTray() {
  let icon = nativeImage.createFromPath(path.join(__dirname, 'assets', process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png'));
  if (process.platform === 'darwin') { icon = icon.resize({ width: 18, height: 18 }); icon.setTemplateImage(true); }
  tray = new Tray(icon);
  tray.setToolTip('Scorebug — right-click for position, size and settings');
  tray.on('double-click', openSettings);
  updateTray();
}

function trustedEvent(event) {
  const frame = event.senderFrame;
  const mainFrame = event.sender.mainFrame;
  if (!frame || frame.routingId !== mainFrame.routingId || frame.processId !== mainFrame.processId || !isLocalPage(frame.url)) return false;
  return [widget, settings, details, gameCenter].some((win) => win && !win.isDestroyed() && win.webContents === event.sender);
}

function addHandler(channel, callback, { widgetOnly = false, gameCenterOnly = false } = {}) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!trustedEvent(event)) throw new Error('Request denied');
    if (widgetOnly && (!widget || widget.isDestroyed() || event.sender !== widget.webContents)) throw new Error('Request denied');
    if (gameCenterOnly && (!gameCenter || gameCenter.isDestroyed() || event.sender !== gameCenter.webContents)) throw new Error('Request denied');
    return callback(...args);
  });
}

function installIpc() {
  addHandler('scorebug:preferences:get', publicPreferences);
  addHandler('scorebug:preferences:set', setPreferences);
  addHandler('scorebug:updates:get', () => updates.getState());
  addHandler('scorebug:updates:check', () => updates.checkForUpdates());
  addHandler('scorebug:updates:restart', () => quitting ? updates.getState() : updates.restartToUpdate());
  addHandler('scorebug:updates:automatic', (automatic) => updates.setAutomaticUpdates(automatic));
  addHandler('scorebug:state', () => ({
    preferences: publicPreferences(),
    anchor: preferences.anchor,
    locked: preferences.locked,
    snapEnabled: preferences.snapEnabled,
    scale: preferences.scale,
    bounds: widget && !widget.isDestroyed() ? widget.getBounds() : preferences.bounds,
    detailsVisible: detailsVisible(),
    detailsSide,
    detailsGameId,
    detailsLeagueId,
    detailsPresentation: getDetailsPresentation(),
    gameCenter: getGameCenterState(),
    platform: process.platform
  }));
  addHandler('scorebug:settings', openSettings);
  addHandler('scorebug:game-center:open', openGameCenter);
  addHandler('scorebug:game-center:get', getGameCenterState);
  addHandler('scorebug:game-center:fullscreen', setGameCenterFullscreen, { gameCenterOnly: true });
  addHandler('scorebug:game-center:close', () => { setTimeout(() => gameCenter?.close(), 0); }, { gameCenterOnly: true });
  addHandler('scorebug:details:presentation:get', getDetailsPresentation);
  addHandler('scorebug:details:show', (side) => showDetails({ focus: true, side: side === undefined ? defaultDetailsSide : cleanDetailsSide(side) }));
  addHandler('scorebug:details:default-side', (side) => { defaultDetailsSide = cleanDetailsSide(side); }, { widgetOnly: true });
  addHandler('scorebug:details:game-id', setDetailsGameId, { widgetOnly: true });
  addHandler('scorebug:details:context', setDetailsContext, { widgetOnly: true });
  addHandler('scorebug:details:regions', setDetailsRegions, { widgetOnly: true });
  addHandler('scorebug:details:hide', () => { setTimeout(() => {
    if (detailsExplicit && details?.isFocused() && widget && !widget.isDestroyed()) widget.focus();
    closeDetails({ dismissed: true });
  }, 0); });
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
  const appRoot = app.isPackaged ? path.join(process.resourcesPath, 'scorebug') : path.resolve(__dirname, '..');
  const { SCOREBUG_STYLES, isScorebugStyle: knownStyle } = await import(pathToFileURL(path.join(appRoot, 'public', 'scorebug-styles.js')).href);
  isScorebugStyle = knownStyle;
  ({ normalizePreferencePatch, leagueOfId } = await import(pathToFileURL(path.join(appRoot, 'public', 'preferences-model.js')).href));
  setFavoriteStyleCatalog(SCOREBUG_STYLES);
  readPreferences();
  updates = new UpdateController({
    currentVersion: app.getVersion(),
    isPackaged: app.isPackaged && !SMOKE_TEST,
    platform: process.platform,
    arch: process.arch,
    portable: Boolean(process.env.PORTABLE_EXECUTABLE_FILE || process.env.PORTABLE_EXECUTABLE_DIR),
    automatic: preferences.autoUpdates,
    createUpdater: () => require('electron-updater').autoUpdater,
    onStateChanged: publishUpdateState,
    onAutomaticChanged: (automatic) => {
      preferences.autoUpdates = automatic;
      savePreferences();
      publishPreferences();
    },
    onBeforeRestart: () => { quitting = true; },
    onRestartCancelled: () => { if (!quitCleanupDone) quitting = false; }
  });
  ({ scorebugDimensions } = await import(pathToFileURL(path.join(appRoot, 'public', 'scorebug-layout.js')).href));
  ({ getLeague } = await import(pathToFileURL(path.join(appRoot, 'public', 'sports.js')).href));
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
  if (process.platform === 'darwin') Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Scorebug', submenu: [{ role: 'about' }, { label: 'Settings…', accelerator: 'Command+,', click: openSettings }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ label: 'Show Scorebug', click: showWidget }, { label: 'Full-screen game view', click: openGameCenter }] },
    { role: 'windowMenu' }
  ]));
  updates.start();
  detailsHoverTimer = setInterval(monitorHoverDetails, 100);
  screen.on('display-added', handleDisplayChange);
  screen.on('display-removed', handleDisplayChange);
  screen.on('display-metrics-changed', handleDisplayChange);
  globalShortcut.register('CommandOrControl+Alt+Shift+S', openSettings);
  globalShortcut.register('CommandOrControl+Alt+Shift+Q', () => app.quit());
  savePreferences();
  if (SMOKE_TEST) {
    const { runNativeSmoke } = require('./smoke.cjs');
    await runNativeSmoke({ widget, screen, origin, getSettings: () => settings, getDetails: () => details, getGameCenter: () => gameCenter, preferencesPath, packaged: app.isPackaged });
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
    if (quitCleanupDone) return;
    quitCleanupDone = true;
    updates?.stop();
    macMoveWatcher?.kill();
    macMoveWatcher = null;
    clearTimeout(moveTimer);
    clearTimeout(boundsGuardTimer);
    clearInterval(detailsHoverTimer);
    closeDetails({ immediate: true });
    if (preferencesPath) savePreferences();
    globalShortcut.unregisterAll();
    if (httpServer) { httpServer.close(); httpServer.closeAllConnections?.(); }
    if (tray && !tray.isDestroyed()) tray.destroy();
  });
  app.on('window-all-closed', () => { if (!quitting) app.quit(); });
  if (SMOKE_TEST) app.on('will-quit', (event) => { event.preventDefault(); app.exit(smokeExitCode); });
  app.whenReady().then(start).catch(showStartupError);
}
