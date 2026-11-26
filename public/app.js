import { renderScorebug } from './scorebug.js';
import { referenceGame } from './fixtures.js';
import { localTeamLogo } from './team-assets.js';
import { attachDetailsHover } from './details-hover.js';
import { initializePreferences, getPreferences, updatePreferences, onPreferences, selectGame, ScoreboardPoller, feedIsStale, checkedAgo } from './score-client.js';

const $ = (id) => document.getElementById(id);
const desktop = Boolean(window.scorebugDesktop);
let preferences = await initializePreferences();
let snapshot = { data: null, error: null, loading: true };
let reference = false;
let pipWindow = null;
let toastTimer;
let renderedSvg = '';

function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 6500); }
function formatKickoff(value) { const date = new Date(value); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date) : ''; }
function phaseLabel(game) { return game?.isLive ? 'LIVE' : ({ halftime: 'HALFTIME', intermission: 'BREAK', final: 'FINAL', scheduled: 'UPCOMING', delayed: 'DELAYED', postponed: 'POSTPONED', suspended: 'SUSPENDED', canceled: 'CANCELED' }[game?.phase] || 'NFL'); }
function renderHealth() {
  const stale = snapshot.data && feedIsStale(snapshot.data, Boolean(snapshot.error));
  $('checked-at').textContent = snapshot.error ? `Reconnecting · ${checkedAgo(snapshot.data).toLowerCase()}` : checkedAgo(snapshot.data);
  const dot = $('feed-health').querySelector('.health-dot');
  dot.className = `health-dot${snapshot.error || stale ? ' error' : snapshot.data ? '' : ' pending'}`;
  if (stale) renderPreview();
}
function renderPreview() {
  const game = reference ? referenceGame : selectGame(snapshot.data?.games, preferences);
  const root = $('scorebug-preview');
  if (game) {
    const html = renderScorebug(game, { idPrefix: 'preview', orientation: preferences.orientation, demo: reference, stale: !reference && feedIsStale(snapshot.data, Boolean(snapshot.error)) });
    if (html !== renderedSvg) { root.innerHTML = html; renderedSvg = html; }
    $('game-title').textContent = reference ? 'San Francisco at Kansas City' : `${game.away.name} at ${game.home.name}`;
    $('phase-badge').textContent = reference ? 'REFERENCE' : phaseLabel(game);
    $('phase-badge').className = `status-pill${!reference && game.isLive ? ' live' : ''}${!reference && snapshot.error ? ' error' : ''}`;
  } else {
    renderedSvg = '';
    const label = snapshot.loading ? 'Connecting to the NFL feed' : snapshot.error ? 'Unable to reach the score feed' : preferences.gameId ? 'This game is not in the selected schedule' : 'No NFL games for this date';
    root.replaceChildren();
    const message = document.createElement('div'); message.className = `empty-scorebug${snapshot.error ? ' error' : ''}`; message.textContent = label; root.append(message);
    $('game-title').textContent = snapshot.loading ? 'Finding your game…' : 'Choose a game below';
    $('phase-badge').textContent = snapshot.error ? 'OFFLINE' : snapshot.loading ? 'CONNECTING' : 'NO GAME';
    $('phase-badge').className = `status-pill${snapshot.error ? ' error' : ''}`;
  }
  $('preview-caption').textContent = reference ? 'SCREENSHOT REFERENCE / NOT LIVE' : 'HOVER FOR FIELD POSITION + STATS';
  $('reference-note').hidden = !reference;
  $('reference-toggle').setAttribute('aria-pressed', String(reference));
  $('reference-toggle').textContent = reference ? 'Back to live game ↗' : 'Compare reference ↗';
}
function renderGames() {
  const games = snapshot.data?.games || [];
  const current = selectGame(games, preferences);
  const select = $('game-select');
  const desired = games.map((game) => `${game.id}:${game.away.score}:${game.home.score}:${game.phase}`).join('|');
  if (select.dataset.options !== desired || !select.options.length) {
    select.dataset.options = desired; select.replaceChildren();
    if (!games.length) select.add(new Option(snapshot.loading ? 'Loading games…' : 'No games available — try another date', ''));
    for (const game of games) {
      const scores = game.state !== 'pre' ? `  ${game.away.score ?? '–'} – ${game.home.score ?? '–'}` : '';
      select.add(new Option(`${game.away.abbreviation} @ ${game.home.abbreviation}${scores} · ${phaseLabel(game)}`, game.id));
    }
  }
  select.disabled = !games.length;
  select.value = current?.id || '';
  $('games-count').textContent = games.length ? `${games.length} GAME${games.length === 1 ? '' : 'S'}` : 'NFL';
  $('feed-error').hidden = !snapshot.error;
  $('feed-error').textContent = snapshot.error ? 'The feed is unavailable. Last known scores are marked as delayed; reconnecting automatically. You can also use the refresh button.' : '';
  const teams = $('match-teams'); teams.replaceChildren();
  if (current) {
    for (const [index, team] of [current.away, current.home].entries()) {
      if (index) { const versus = document.createElement('span'); versus.className = 'versus'; versus.textContent = 'AT'; teams.append(versus); }
      const el = document.createElement('span'); el.className = 'team';
      const teamLogo = localTeamLogo(team);
      if (teamLogo) { const logo = document.createElement('img'); logo.src = teamLogo; logo.alt = ''; logo.width = 31; logo.height = 31; logo.addEventListener('error', () => logo.hidden = true, { once: true }); el.append(logo); }
      el.append(document.createTextNode(team.abbreviation)); teams.append(el);
    }
    $('match-meta').textContent = [formatKickoff(current.startTime), current.broadcast, current.venue].filter(Boolean).join(' · ');
    $('last-play').textContent = current.lastPlay || (current.state === 'pre' ? 'The scorebug will update automatically when the game starts.' : current.status || 'Waiting for the next play.');
    document.title = `${current.away.abbreviation} ${current.away.score ?? '–'} · ${current.home.abbreviation} ${current.home.score ?? '–'} — Scorebug`;
  } else {
    const label = document.createElement('span'); label.className = 'placeholder-label'; label.textContent = 'The Bears are your default team.'; teams.append(label);
    $('match-meta').textContent = 'Choose a game or a different date.';
    $('last-play').textContent = snapshot.loading ? 'Waiting for the feed…' : 'No play information available.';
  }
}
function renderPreferences() {
  const scale = Number(preferences.scale) || 1;
  $('size-range').value = String(scale); $('size-value').textContent = `${Math.round(scale * 100)}%`;
  $('size-range').style.background = `linear-gradient(to right,var(--accent) ${(scale - .65) / 1.15 * 100}%,#3d4739 ${(scale - .65) / 1.15 * 100}%)`;
  const vertical = preferences.orientation === 'vertical';
  $('scorebug-preview').style.width = `${(vertical ? 144 : 520) * scale}px`;
  $('preview-stage').dataset.orientation = vertical ? 'vertical' : 'horizontal';
  $('date-input').value = preferences.date ? `${preferences.date.slice(0, 4)}-${preferences.date.slice(4, 6)}-${preferences.date.slice(6, 8)}` : '';
  $('snap-checkbox').checked = preferences.snapEnabled !== false; $('lock-checkbox').checked = Boolean(preferences.locked);
  for (const button of $('anchor-grid').querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.anchor === preferences.anchor));
}
const poller = new ScoreboardPoller({ date: preferences.date, onUpdate: (state) => { snapshot = state; renderPreview(); renderGames(); renderHealth(); } });
onPreferences((next) => { const oldDate = preferences.date; preferences = next; if (oldDate !== next.date) poller.setDate(next.date); renderPreferences(); renderPreview(); renderGames(); });

$('game-select').addEventListener('change', (event) => { reference = false; updatePreferences({ gameId: event.target.value || null }); });
$('date-input').addEventListener('change', (event) => updatePreferences({ date: event.target.value.replaceAll('-', '') || null, gameId: null }));
$('week-button').addEventListener('click', () => updatePreferences({ date: null, gameId: null }));
$('size-range').addEventListener('input', (event) => {
  const scale = Number(event.target.value);
  updatePreferences({ scale });
  if (pipWindow && !pipWindow.closed) {
    try { pipWindow.resizeTo(Math.round(520 * scale), Math.round(144 * scale)); } catch { /* Browser may constrain PiP size. */ }
  }
});
const previewDetails = attachDetailsHover($('scorebug-preview'), { enabled: () => !reference });
$('reference-toggle').addEventListener('click', () => { reference = !reference; previewDetails.close(); renderPreview(); });
$('refresh-button').addEventListener('click', () => poller.refresh());
$('snap-checkbox').addEventListener('change', (event) => updatePreferences({ snapEnabled: event.target.checked }));
$('lock-checkbox').addEventListener('change', (event) => updatePreferences({ locked: event.target.checked }));
$('anchor-grid').addEventListener('click', (event) => { const button = event.target.closest('button[data-anchor]'); if (button) updatePreferences({ anchor: button.dataset.anchor }); });
$('clean-button').addEventListener('click', () => {
  const url = new URL('/widget.html', location.href);
  const game = selectGame(snapshot.data?.games, preferences);
  if (game) url.searchParams.set('game', game.id);
  if (preferences.date) url.searchParams.set('date', preferences.date);
  if (desktop) { updatePreferences({ anchor: preferences.anchor || 'bottom-center' }); toast('The desktop scorebug is ready. Drag it to any edge to snap.'); }
  else window.open(url.href, '_blank', 'noopener,noreferrer');
});

async function floatWidget() {
  if (desktop) { await updatePreferences({ anchor: 'bottom-center' }); toast('Scorebug snapped to the bottom center.'); return; }
  if (pipWindow && !pipWindow.closed) { pipWindow.focus(); return; }
  if (!window.documentPictureInPicture?.requestWindow) {
    const popup = window.open('/widget.html', 'scorebug-overlay', `popup,width=${Math.round(520 * preferences.scale)},height=${Math.round(144 * preferences.scale)}`);
    toast(popup ? 'Pin this window with PowerToys: Win + Ctrl + T. The desktop app supports snapping.' : 'Popup blocked. Use Clean view, then pin it with PowerToys.');
    return;
  }
  try {
    // Must stay directly inside the user gesture. PiP owns its own runtime/timers.
    pipWindow = await window.documentPictureInPicture.requestWindow({ width: Math.round(520 * preferences.scale), height: Math.round(144 * preferences.scale) });
    pipWindow.scorebugInitialPreferences = getPreferences();
    const doc = pipWindow.document;
    doc.documentElement.lang = 'en'; doc.title = 'Scorebug — Live NFL';
    const base = doc.createElement('base'); base.href = `${location.origin}/`; doc.head.append(base);
    for (const path of ['/widget.css', '/scorebug.css']) { const link = doc.createElement('link'); link.rel = 'stylesheet'; link.href = new URL(path, location.origin).href; doc.head.append(link); }
    doc.body.className = 'widget-page'; doc.body.dataset.pip = 'true';
    const main = doc.createElement('main'); main.id = 'widget-root'; main.className = 'widget-root'; main.setAttribute('aria-label', 'Floating NFL scoreboard'); doc.body.append(main);
    const script = doc.createElement('script'); script.type = 'module'; script.src = new URL('/widget-runtime.js', location.origin).href; doc.body.append(script);
    $('float-button-label').textContent = 'Scorebug is floating';
    pipWindow.addEventListener('pagehide', () => { pipWindow = null; $('float-button-label').textContent = 'Float in browser'; }, { once: true });
    toast('Drag the floating scorebug wherever you want. Keep this tab open.');
  } catch (error) { console.warn('Picture-in-Picture:', error.message); toast('The browser could not open a floating window. Try Clean view + PowerToys, or the desktop app.'); }
}
$('float-button').addEventListener('click', floatWidget);
if (desktop) {
  $('desktop-controls').hidden = false; $('desktop-banner').hidden = true;
  $('mode-label').textContent = 'DESKTOP COMPANION'; $('float-button-label').textContent = 'Snap to bottom center';
  $('floating-copy').textContent = 'Transparent and always on top. Side positions turn vertical; top and bottom stay horizontal. Hover for field position and stats.';
  $('floating-hint').textContent = 'Hover the scorebug for controls, or right-click it for the full menu. Close this settings window to keep watching.';
  $('clean-button').hidden = true;
} else if (!window.documentPictureInPicture?.requestWindow) {
  $('float-button-label').textContent = 'Open mini window';
  $('floating-hint').textContent = 'Pin it with PowerToys: Win + Ctrl + T. For automatic snapping, use the desktop app.';
}
renderPreferences(); poller.start();
let healthTimer = setInterval(renderHealth, 1000);
window.addEventListener('pagehide', () => { poller.stop(); clearInterval(healthTimer); });
window.addEventListener('pageshow', (event) => {
  if (event.persisted) { poller.start(); clearInterval(healthTimer); healthTimer = setInterval(renderHealth, 1000); }
});
