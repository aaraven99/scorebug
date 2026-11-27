import { renderScorebug } from './scorebug.js';
import { getLeague, leagueGroups, sportFor } from './sports.js';
import { styleDescription } from './scorebug-styles.js';
import { styleOptionGroups } from './style-favorites.js';
import { selectGame, activeGames, feedIsStale, checkedAgo, gameLabel } from './score-client.js';
import { normalizeStandbyState, normalizeStandbySlot, readStandbyState, saveStandbyState, seedStandbyFromURL, standbySelectionKey, standbyFeedKey, standbyGameURL, MAX_STANDBY_SLOTS } from './standby-model.js';
import { createStandbyFeedPool } from './standby-feeds.js';
import { createStandbyWakeLock } from './standby-screen.js';

const $ = id => document.getElementById(id);
let storage; try { storage = localStorage; } catch { /* Session-only display still works. */ }
let initialState = readStandbyState(storage), hasSavedBoard = false;
try { hasSavedBoard = Array.isArray(JSON.parse(storage?.getItem('scorebug.standby.v1') || 'null')?.slots); } catch { /* Restore from the current game instead. */ }
if (!hasSavedBoard && typeof window.scorebugDesktop?.getPreferences === 'function') {
  try { initialState = normalizeStandbyState({ slots: [await window.scorebugDesktop.getPreferences()] }); } catch { /* Local defaults remain usable. */ }
}
let state = seedStandbyFromURL(initialState, location.href);
let editingId = null, returnFocus = null, controlsHidden = false, disposed = false, ageTimer = null;
let gameOptionsKey = '', lifecycleActive = false;
const cards = new Map(), remembered = new Map();
const pool = createStandbyFeedPool({ onUpdate: key => {
  for (const slot of state.slots) if (standbyFeedKey(slot) === key) renderCard(slot);
  if (editingId) renderDialogGames();
} });
const wake = createStandbyWakeLock({ onChange: renderWake });
const text = (element, value) => { const next = String(value ?? ''); if (element.textContent !== next) element.textContent = next; };
const currentSlot = () => state.slots.find(slot => slot.id === editingId);
const announce = message => text($('standby-announcement'), message);
const gameName = game => ['race', 'leaderboard'].includes(game?.kind) ? game.name || game.sessionName || 'Event' : `${game?.away?.name || 'Away'} · ${game?.home?.name || 'Home'}`;
const phaseName = game => game?.isLive ? 'LIVE' : ({ final: 'FINAL', scheduled: 'UPCOMING', halftime: 'HALFTIME', intermission: 'BREAK', delayed: 'DELAYED', postponed: 'POSTPONED', suspended: 'SUSPENDED', canceled: 'CANCELED' }[game?.phase] || 'SCHEDULE');

function save() {
  const saved = saveStandbyState(storage, state);
  $('standby-storage-status').hidden = saved;
  if (!saved) text($('standby-storage-status'), 'Your layout could not be saved on this device. It will work while this page stays open.');
}
function consumeSeedURL() {
  const url = new URL(location.href);
  for (const key of ['league', 'game', 'style', 'date', 'rows']) url.searchParams.delete(key);
  try { history.replaceState(null, '', url); } catch { /* Saved layout still applies. */ }
}
function buildCard(slot) {
  const article = document.createElement('article'); article.className = 'standby-card'; article.dataset.slotId = slot.id;
  article.innerHTML = '<div class="slot-heading"><div class="slot-heading-copy"><div class="slot-eyebrow"><span class="slot-league-name"></span><span class="slot-phase"></span></div><h2></h2></div><button type="button" class="slot-configure">Change</button></div><div class="standby-scorebug"></div><div class="slot-footer"><div class="slot-footer-copy"><p class="slot-play"></p><p class="slot-feed"></p></div><a class="slot-details">Game stats</a></div>';
  article.querySelector('.slot-configure').addEventListener('click', event => openDialog(slot.id, event.currentTarget));
  const entry = { element: article, svg: '', orientation: '', game: null, confirmedAt: null };
  cards.set(slot.id, entry); return entry;
}
function renderBoard() {
  const ids = new Set(state.slots.map(slot => slot.id));
  for (const [id, card] of cards) if (!ids.has(id)) { card.element.remove(); cards.delete(id); remembered.delete(id); }
  const grid = $('standby-grid'); grid.dataset.count = String(state.slots.length);
  for (const slot of state.slots) {
    const card = cards.get(slot.id) || buildCard(slot);
    grid.append(card.element); renderCard(slot);
  }
  $('standby-add').disabled = state.slots.length >= MAX_STANDBY_SLOTS;
  $('standby-add').title = state.slots.length >= MAX_STANDBY_SLOTS ? 'Your display has four games. Remove one to add another.' : 'Add an independent game';
  document.body.dataset.dimmed = String(state.dimmed);
  $('standby-dim').setAttribute('aria-pressed', String(state.dimmed));
}
function renderCard(slot) {
  const card = cards.get(slot.id); if (!card) return;
  const snapshot = pool.snapshot(slot), selection = standbySelectionKey(slot);
  let last = remembered.get(slot.id);
  if (last?.selection !== selection) { remembered.delete(slot.id); last = null; }
  const found = selectGame(snapshot.data?.games, { gameId: slot.gameId });
  if (found) {
    last = { selection, game: found, fetchedAt: snapshot.data?.fetchedAt };
    remembered.set(slot.id, last);
  }
  const game = found || last?.game || null, missing = Boolean(game && !found);
  const delayed = Boolean(game && (missing || game.timingStale || feedIsStale(snapshot.data, Boolean(snapshot.error))));
  card.game = game; card.confirmedAt = last?.fetchedAt || null;
  const root = card.element, league = getLeague(slot.leagueId);
  text(root.querySelector('.slot-league-name'), league.name);
  text(root.querySelector('.slot-phase'), game ? delayed ? 'DELAYED' : phaseName(game) : snapshot.loading ? 'CONNECTING' : snapshot.error ? 'UNAVAILABLE' : 'NO GAME');
  root.querySelector('.slot-phase').dataset.live = String(Boolean(game?.isLive && !delayed));
  text(root.querySelector('h2'), game ? gameName(game) : slot.gameId ? 'Waiting for your selected game' : 'Automatic · a live game first');
  root.querySelector('h2').title = game ? gameName(game) : '';
  root.querySelector('.slot-configure').setAttribute('aria-label', `Change game ${state.slots.indexOf(slot) + 1} · ${league.name}`);
  const board = root.querySelector('.standby-scorebug');
  if (game) {
    const portrait = matchMedia('(orientation: portrait)').matches;
    const orientation = sportFor(game) === 'racing' && portrait && state.slots.length <= 2 ? 'vertical' : 'horizontal';
    const svg = renderScorebug(game, { styleId: slot.styleId, racingRows: slot.racingRows, orientation, interactive: false, stale: delayed, idPrefix: `standby-${slot.id}` });
    if (svg !== card.svg) { board.innerHTML = svg; card.svg = svg; }
    card.orientation = orientation; board.dataset.orientation = orientation;
    text(root.querySelector('.slot-play'), game.lastPlay || game.status || '');
  } else {
    card.svg = ''; board.dataset.orientation = 'horizontal';
    const heading = snapshot.error ? 'Scores are unavailable' : snapshot.loading ? 'Finding your game…' : slot.gameId ? 'Game not in this schedule' : 'No games in this schedule';
    const copy = snapshot.error ? 'Reconnecting automatically. You can also tap Refresh.' : snapshot.loading ? 'Waiting for the latest confirmed score.' : slot.gameId ? 'Choose another date or game. This card will keep watching your selection.' : 'Choose a different sport or date to find a game.';
    if (!board.querySelector('.slot-empty')) board.innerHTML = '<div class="slot-empty"><strong></strong><span></span></div>';
    text(board.querySelector('strong'), heading); text(board.querySelector('.slot-empty span'), copy);
    text(root.querySelector('.slot-play'), '');
  }
  const feed = root.querySelector('.slot-feed'); feed.dataset.delayed = String(delayed);
  const stamp = game && missing ? last.fetchedAt : snapshot.data?.fetchedAt;
  const age = stamp ? checkedAgo({ fetchedAt: stamp }) : snapshot.loading ? 'Connecting…' : 'Waiting for a confirmed update';
  text(feed, delayed ? `${missing ? 'Last confirmed score' : game?.timingStale ? 'Timing delayed' : 'Feed delayed'} · ${age}` : age);
  const details = root.querySelector('.slot-details'); details.hidden = !game;
  details.href = standbyGameURL(slot, game); details.setAttribute('aria-label', `Game stats for ${game ? gameName(game) : league.name}`);
}
function updateSlot(patch) {
  const index = state.slots.findIndex(slot => slot.id === editingId); if (index < 0) return;
  const old = state.slots[index];
  state.slots[index] = normalizeStandbySlot({ ...old, ...patch });
  if (standbySelectionKey(old) !== standbySelectionKey(state.slots[index])) remembered.delete(old.id);
  save(); pool.setSlots(state.slots); renderBoard(); renderDialog();
}
function openDialog(id, trigger) {
  editingId = id; returnFocus = trigger; gameOptionsKey = ''; renderDialog();
  const dialog = $('slot-dialog');
  if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
  $('slot-league').focus({ preventScroll: true });
}
function closeDialog() {
  const dialog = $('slot-dialog');
  if (typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open');
  editingId = null; (returnFocus?.isConnected ? returnFocus : $('standby-add')).focus({ preventScroll: true }); returnFocus = null;
}
function renderDialog() {
  const slot = currentSlot(); if (!slot) return;
  text($('slot-dialog-title'), `Game ${state.slots.indexOf(slot) + 1}`);
  $('slot-league').value = slot.leagueId; $('slot-style').value = slot.styleId;
  $('slot-date').value = slot.date ? `${slot.date.slice(0,4)}-${slot.date.slice(4,6)}-${slot.date.slice(6,8)}` : '';
  text($('slot-style-note'), styleDescription(slot.styleId, { sport: getLeague(slot.leagueId).sport }));
  $('slot-racing-controls').hidden = getLeague(slot.leagueId).sport !== 'racing';
  $('slot-racing-rows').value = String(slot.racingRows); text($('slot-racing-value'), slot.racingRows);
  $('slot-remove').disabled = state.slots.length === 1; $('slot-remove-note').hidden = state.slots.length > 1;
  renderDialogGames();
}
function renderDialogGames() {
  const slot = currentSlot(); if (!slot) return;
  const snapshot = pool.snapshot(slot), games = snapshot.data?.games || [], live = activeGames(games);
  // Do not rebuild an open native phone picker every time a score or clock
  // changes. Its schedule choices change only with identities or game phases.
  const key = JSON.stringify([standbyFeedKey(slot), slot.gameId, games.map(game => [game.id, game.isLive, game.phase, game.name, game.away?.name, game.home?.name])]);
  if (key !== gameOptionsKey) {
    gameOptionsKey = key; const select = $('slot-game'); select.replaceChildren(new Option('Automatic · a live game first', ''));
    const addGroup = (label, list) => {
      if (!list.length) return;
      const group = document.createElement('optgroup'); group.label = label;
      for (const game of list) group.append(new Option(`${gameName(game)} · ${gameLabel(game)}${game.isLive ? ' · LIVE' : ''}`, game.id));
      select.append(group);
    };
    addGroup('Live now', live); addGroup('Other games & sessions', games.filter(game => !live.includes(game)));
    if (slot.gameId && !games.some(game => game.id === slot.gameId)) {
      const alias = selectGame(games, { gameId: slot.gameId });
      select.append(new Option(alias ? `${gameName(alias)} · selected game` : 'Your selected game · waiting for the feed', slot.gameId));
    }
    select.value = slot.gameId || '';
  }
  text($('slot-game-status'), snapshot.error ? 'The feed is delayed. Saved scores stay visible while it reconnects.' : snapshot.loading && !games.length ? 'Loading this schedule…' : games.length ? `${live.length} live · ${games.length} games or sessions available` : 'No games returned for this schedule. Try another date.');
}
function renderWake(status) {
  const button = $('standby-awake'); if (!button) return;
  button.disabled = !status.supported || status.status === 'requesting'; button.setAttribute('aria-pressed', String(status.active));
  text(button, status.active ? 'Screen awake · On' : status.status === 'requesting' ? 'Requesting…' : ['released', 'error'].includes(status.status) ? 'Retry keep awake' : 'Keep screen awake');
  const message = { unsupported: 'Keep awake is not available in this browser.', off: 'Screen may sleep.', requesting: 'Asking the browser to keep the screen awake…', active: 'Keep awake is active while this page is visible.', paused: 'Keep awake paused while the page is hidden.', released: 'Keep awake was released. Tap to try again.', error: 'The browser could not keep the screen awake. Tap to retry.' }[status.status];
  text($('standby-awake-status'), message || 'Screen may sleep.');
}
function renderFullscreen() {
  const active = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
  $('standby-fullscreen').setAttribute('aria-pressed', String(active)); text($('standby-fullscreen'), active ? 'Exit full screen' : 'Full screen');
  if (active) text($('standby-screen-status'), 'Full screen is active.');
  else if (matchMedia('(display-mode: standalone)').matches || navigator.standalone) text($('standby-screen-status'), 'Home Screen app view.');
  else text($('standby-screen-status'), 'Keep this page open for live scores.');
}
async function toggleFullscreen() {
  try {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) await exit.call(document);
    } else {
      const request = document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen;
      if (typeof request !== 'function' || document.fullscreenEnabled === false) throw new Error('unsupported');
      await request.call(document.documentElement);
    }
    renderFullscreen();
  } catch {
    text($('standby-screen-status'), 'Full screen is unavailable here. On iPhone, use Share → Add to Home Screen.');
    $('standby-help').hidden = false; $('standby-help-toggle').setAttribute('aria-expanded', 'true');
  }
}
function showControls(value) {
  controlsHidden = !value; document.body.dataset.controls = value ? 'visible' : 'hidden';
  $('standby-controls-toggle').setAttribute('aria-pressed', String(controlsHidden)); $('standby-reveal').hidden = value;
  if (value) $('standby-controls-toggle').focus({ preventScroll: true }); else $('standby-reveal').focus({ preventScroll: true });
  renderBoard();
}
function setLifecycle(active) {
  if (disposed) return;
  lifecycleActive = Boolean(active); pool.setActive(lifecycleActive);
  clearInterval(ageTimer); ageTimer = null;
  if (lifecycleActive) {
    wake.resume(); renderBoard();
    ageTimer = setInterval(() => { for (const slot of state.slots) renderCard(slot); }, 5000);
  } else wake.pause();
}

for (const group of leagueGroups()) {
  const optgroup = document.createElement('optgroup'); optgroup.label = group.label;
  for (const league of group.leagues) optgroup.append(new Option(league.name, league.id)); $('slot-league').append(optgroup);
}
for (const group of styleOptionGroups([])) {
  const optgroup = document.createElement('optgroup'); optgroup.label = group.label;
  for (const style of group.styles) optgroup.append(new Option(style.name, style.id)); $('slot-style').append(optgroup);
}
$('standby-add').addEventListener('click', () => {
  if (state.slots.length >= MAX_STANDBY_SLOTS) return;
  const base = state.slots.at(-1), id = `slot-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,9)}`}`;
  state.slots.push(normalizeStandbySlot({ id, leagueId: base.leagueId, styleId: base.styleId }));
  save(); pool.setSlots(state.slots); renderBoard(); announce('Game added. Choose its league and matchup.'); openDialog(id, cards.get(id).element.querySelector('.slot-configure'));
});
$('slot-league').addEventListener('change', event => { const league = getLeague(event.target.value); if (league) updateSlot({ leagueId: league.id, gameId: null, date: null }); });
$('slot-game').addEventListener('change', event => updateSlot({ gameId: event.target.value || null }));
$('slot-style').addEventListener('change', event => updateSlot({ styleId: event.target.value }));
$('slot-date').addEventListener('change', event => updateSlot({ date: event.target.value.replaceAll('-', '') || null, gameId: null }));
$('slot-current').addEventListener('click', () => updateSlot({ date: null, gameId: null }));
$('slot-racing-rows').addEventListener('input', event => updateSlot({ racingRows: Number(event.target.value) }));
$('slot-done').addEventListener('click', closeDialog);
$('slot-dialog').addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
$('slot-remove').addEventListener('click', () => {
  if (state.slots.length <= 1 || !editingId) return;
  state.slots = state.slots.filter(slot => slot.id !== editingId); closeDialog(); save(); pool.setSlots(state.slots); renderBoard(); $('standby-add').focus({ preventScroll: true }); announce('Game removed. Your other games are unchanged.');
});
$('standby-awake').addEventListener('click', () => wake.state().active ? wake.disable() : wake.enable());
$('standby-fullscreen').addEventListener('click', toggleFullscreen);
$('standby-dim').addEventListener('click', () => { state.dimmed = !state.dimmed; save(); renderBoard(); });
$('standby-refresh').addEventListener('click', () => { pool.refresh(); announce('Checking your games for a new update.'); });
$('standby-controls-toggle').addEventListener('click', () => showControls(controlsHidden));
$('standby-reveal').addEventListener('click', () => showControls(true));
$('standby-help-toggle').addEventListener('click', () => { const open = $('standby-help').hidden; $('standby-help').hidden = !open; $('standby-help-toggle').setAttribute('aria-expanded', String(open)); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && controlsHidden && !$('slot-dialog').open) showControls(true); });
document.addEventListener('visibilitychange', () => setLifecycle(document.visibilityState !== 'hidden'));
document.addEventListener('fullscreenchange', renderFullscreen); document.addEventListener('webkitfullscreenchange', renderFullscreen);
window.addEventListener('pagehide', () => setLifecycle(false));
window.addEventListener('pageshow', () => setLifecycle(document.visibilityState !== 'hidden'));
window.addEventListener('resize', () => { if (!disposed) renderBoard(); });
window.addEventListener('storage', event => {
  if (event.key !== 'scorebug.standby.v1' || !event.newValue) return;
  try { state = normalizeStandbyState(JSON.parse(event.newValue)); if (editingId && !state.slots.some(slot => slot.id === editingId)) closeDialog(); pool.setSlots(state.slots); renderBoard(); if (editingId) renderDialog(); } catch { /* Ignore invalid cross-tab writes. */ }
});
// pagehide stops requests, timers and the wake lock. Keep lifecycle listeners
// for pageshow restoration; an unload listener would prevent some browsers
// from putting this page into their back/forward cache.
save(); consumeSeedURL(); pool.setSlots(state.slots); renderBoard(); renderWake(wake.state()); renderFullscreen(); setLifecycle(document.visibilityState !== 'hidden');
