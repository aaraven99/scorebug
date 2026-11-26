import { renderScorebug } from './scorebug.js';
import { initializePreferences, onPreferences, selectGame, ScoreboardPoller, feedIsStale } from './score-client.js';
import { attachDetailsHover } from './details-hover.js';
import { createGameActivity } from './game-activity.js';
import { createScoreAnimations } from './score-animation.js';

const desktop = Boolean(window.scorebugDesktop);
if (desktop) document.body.dataset.desktop = 'true';
let preferences = await initializePreferences();
let snapshot = { data: null, error: null, loading: true };
let rendered = '';
const root = document.getElementById('widget-root');
const toolbar = document.createElement('nav'); toolbar.className = 'widget-toolbar'; toolbar.setAttribute('aria-label', 'Scorebug controls');
const refresh = document.createElement('button'); refresh.type = 'button'; refresh.title = 'Refresh now'; refresh.setAttribute('aria-label', 'Refresh now'); refresh.textContent = '↻';
const settings = document.createElement('button'); settings.type = 'button'; settings.title = 'Settings'; settings.setAttribute('aria-label', 'Open scorebug settings'); settings.textContent = '⚙';
const close = document.createElement('button'); close.type = 'button'; close.title = desktop ? 'Quit Scorebug' : 'Close window'; close.setAttribute('aria-label', close.title); close.textContent = '×';
const detailsButton = document.createElement('button'); detailsButton.type = 'button'; detailsButton.title = 'Stats for the team with the ball'; detailsButton.setAttribute('aria-label', 'Show team stats'); detailsButton.textContent = 'Stats';
toolbar.append(refresh, detailsButton, settings, close);
const board = document.createElement('div'); board.className = 'widget-board';
const hint = document.createElement('span'); hint.className = 'widget-hint'; hint.textContent = 'SCOREBUG / LIVE NFL';
root.append(toolbar, hint, board);
function possessingSide() { const game = selectGame(snapshot.data?.games, preferences); return game?.possessionTeamId === game?.away.id ? 'away' : 'home'; }
const detailsHover = attachDetailsHover(board, { native: desktop, defaultSide: possessingSide });
const animations = createScoreAnimations(board);
const activity = createGameActivity({ onEvents: (events, game) => animations.enqueue(events, game), onReset: () => animations.clear() });
let nativeDetailsSide = null;
detailsButton.addEventListener('click', () => detailsHover.open());

function render() {
  document.body.dataset.locked = String(Boolean(preferences.locked));
  document.body.dataset.orientation = preferences.orientation === 'vertical' ? 'vertical' : 'horizontal';
  const game = selectGame(snapshot.data?.games, preferences);
  if (game) {
    const html = renderScorebug(game, { idPrefix: 'floating', orientation: preferences.orientation, stale: feedIsStale(snapshot.data, Boolean(snapshot.error)) });
    if (rendered !== html) { board.innerHTML = html; rendered = html; }
    animations.attach(preferences.orientation);
    const side = possessingSide();
    if (desktop && side !== nativeDetailsSide) { nativeDetailsSide = side; window.scorebugDesktop.setDefaultDetailsSide?.(side); }
    document.title = `${game.away.abbreviation} ${game.away.score ?? '–'} · ${game.home.abbreviation} ${game.home.score ?? '–'} — Scorebug`;
    hint.textContent = `${game.away.abbreviation} @ ${game.home.abbreviation} / ${snapshot.error ? 'RECONNECTING' : 'ESPN FEED'}`;
  } else {
    rendered = '';
    const message = document.createElement('div'); message.className = `empty-scorebug${snapshot.error ? ' error' : ''}`;
    message.textContent = snapshot.loading ? 'Connecting to the NFL feed…' : snapshot.error ? 'Feed unavailable · reconnecting…' : preferences.gameId ? 'Selected game unavailable' : 'No NFL games on this date';
    const help = document.createElement('small'); help.textContent = 'Hover here for settings'; message.append(help); board.replaceChildren(message);
  }
}
const poller = new ScoreboardPoller({ date: preferences.date, onUpdate: (next) => { snapshot = next; render(); if (!next.error) activity.setGame(selectGame(next.data?.games, preferences), preferences.date || 'current', next.data?.fetchedAt); } });
onPreferences((next) => { const oldDate = preferences.date; preferences = next; if (oldDate !== next.date) poller.setDate(next.date); render(); activity.setGame(selectGame(snapshot.data?.games, preferences), preferences.date || 'current', snapshot.data?.fetchedAt); });
refresh.addEventListener('click', () => { poller.refresh(); activity.refresh(); });
settings.addEventListener('click', () => {
  if (desktop) window.scorebugDesktop.openSettings();
  else if (window.opener && !window.opener.closed) window.opener.focus();
  else window.open(new URL('/', document.baseURI).href, '_blank', 'noopener,noreferrer');
});
close.addEventListener('click', () => { if (desktop) window.scorebugDesktop.closeWidget(); else window.close(); });
function checkAge() { if (snapshot.data && feedIsStale(snapshot.data, Boolean(snapshot.error))) render(); }
render(); activity.start(); poller.start();
let ageTimer = setInterval(checkAge, 1000);
window.addEventListener('pagehide', () => { poller.stop(); activity.stop(); clearInterval(ageTimer); });
window.addEventListener('pageshow', (event) => {
  if (event.persisted) { activity.start(); poller.start(); clearInterval(ageTimer); ageTimer = setInterval(checkAge, 1000); }
});
