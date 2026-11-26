import { initializePreferences, onPreferences, selectGame, ScoreboardPoller, feedIsStale, checkedAgo } from './score-client.js';
import { fieldSituation, renderField } from './field.js';

const $ = (id) => document.getElementById(id);
let preferences = await initializePreferences();
let snapshot = { data: null, error: null, loading: true };
let currentGame = null, summary = null, summaryError = null, summaryId = null;
let summaryController = null, summaryGeneration = 0, summaryLastAttempt = 0, active = true;
let detailsTimer;
const STAT_ROWS = [['totalYards', 'Total yards'], ['netPassingYards', 'Passing yards'], ['rushingYards', 'Rushing yards'], ['thirdDownEff', 'Third downs'], ['turnovers', 'Turnovers'], ['possessionTime', 'Time of possession']];

function gamePhase(game) {
  return ({ live: 'LIVE GAME', halftime: 'HALFTIME', intermission: 'QUARTER BREAK', final: 'FINAL', scheduled: 'UPCOMING', delayed: 'GAME DELAYED', suspended: 'SUSPENDED', postponed: 'POSTPONED', canceled: 'CANCELED' })[game?.phase] || 'GAME DETAILS';
}
function renderStats() {
  $('stats-away').textContent = currentGame?.away.abbreviation || 'Away';
  $('stats-home').textContent = currentGame?.home.abbreviation || 'Home';
  const rows = summary && currentGame && summary.gameId === currentGame.id ? summary.teamStats : [];
  const fragment = document.createDocumentFragment();
  for (const [key, label] of STAT_ROWS) {
    const stat = rows?.find((row) => row.key === key);
    const tr = document.createElement('tr');
    for (const value of [label, stat?.away ?? '—', stat?.home ?? '—']) { const td = document.createElement('td'); td.textContent = value; tr.append(td); }
    fragment.append(tr);
  }
  $('stats-body').replaceChildren(fragment);
  const stale = summary && (summaryError || Date.now() - Date.parse(summary.fetchedAt) > 45000);
  $('stats-status').textContent = summaryError ? 'Updates delayed' : summaryController ? 'Updating…' : stale ? 'Last received' : summary ? 'Game totals' : currentGame ? 'Loading…' : 'No game';
  $('stats-error').hidden = !summaryError;
  $('stats-error').textContent = summary ? 'Showing the last received stats. Reconnecting…' : 'Stats are temporarily unavailable. Reconnecting…';
}
function render() {
  currentGame = selectGame(snapshot.data?.games, preferences);
  const game = currentGame;
  $('details-match').textContent = game ? `${game.away.abbreviation} ${game.away.score ?? '—'} · ${game.home.abbreviation} ${game.home.score ?? '—'}` : snapshot.loading ? 'Connecting…' : 'No game selected';
  $('details-phase').textContent = gamePhase(game);
  const field = fieldSituation(game);
  $('field-position').textContent = field ? `${field.offense.abbreviation} ball · ${field.label}` : game?.phase === 'halftime' ? 'Between halves' : 'Current ball position';
  $('field-down').textContent = game?.downDistance || '';
  $('field-visual').innerHTML = renderField(game);
  $('field-legend').hidden = !field;
  const recent = summary && game && summary.gameId === game.id ? summary.lastPlay : null;
  // The current scoreboard's play wins over a separately fetched, possibly older summary.
  $('details-play').textContent = game?.lastPlay || recent?.text || (game?.state === 'pre' ? 'Play details will appear after kickoff.' : snapshot.error ? 'The score feed is unavailable. Reconnecting…' : 'Waiting for a reported play.');
  $('play-time').textContent = game?.clock && game?.period ? `Game clock: ${game.period <= 4 ? `Q${game.period}` : 'OT'} · ${game.clock}` : game?.status || '';
  const delayed = snapshot.data && feedIsStale(snapshot.data, Boolean(snapshot.error));
  $('details-age').textContent = delayed ? 'Score updates delayed' : checkedAgo(snapshot.data);
  $('details-age').className = delayed ? 'delayed' : '';
  renderStats();
}
async function refreshSummary(force = false) {
  if (!active || !currentGame || summaryController || (!force && Date.now() - summaryLastAttempt < 10000)) return;
  summaryLastAttempt = Date.now();
  const id = currentGame.id, generation = summaryGeneration;
  const controller = new AbortController(); summaryController = controller;
  const timeout = setTimeout(() => controller.abort(), 12000);
  renderStats();
  try {
    const url = new URL('/api/game', document.baseURI); url.searchParams.set('id', id);
    const response = await fetch(url, { cache: 'no-store', signal: controller.signal, headers: { Accept: 'application/json' } });
    const data = await response.json();
    if (!response.ok || data.gameId !== id || !Array.isArray(data.teamStats) || !Number.isFinite(Date.parse(data.fetchedAt))) throw new Error('Game stats unavailable');
    if (generation !== summaryGeneration || !active) return;
    summary = data; summaryError = null;
  } catch (error) { if (generation === summaryGeneration && active) summaryError = error; }
  finally { clearTimeout(timeout); if (generation === summaryGeneration) { summaryController = null; render(); } }
}
function updateSummaryGame() {
  if (currentGame?.id !== summaryId) {
    summaryId = currentGame?.id || null; summaryGeneration++; summaryController?.abort(); summaryController = null;
    summary = null; summaryError = null; summaryLastAttempt = 0;
  }
  refreshSummary();
}
const poller = new ScoreboardPoller({ date: preferences.date, onUpdate: (next) => { snapshot = next; render(); updateSummaryGame(); } });
onPreferences((next) => { const oldDate = preferences.date; preferences = next; if (oldDate !== next.date) poller.setDate(next.date); render(); updateSummaryGame(); });
function start() { active = true; poller.start(); clearInterval(detailsTimer); detailsTimer = setInterval(() => { render(); refreshSummary(); }, 1000); }
function stop() { active = false; poller.stop(); clearInterval(detailsTimer); summaryGeneration++; summaryController?.abort(); summaryController = null; }
function closeDetails() {
  if (window.scorebugDesktop?.hideDetails) window.scorebugDesktop.hideDetails();
  else if (window.parent !== window) window.parent.postMessage({ type: 'scorebug:close-details' }, new URL(document.baseURI).origin);
  else window.close();
}
$('details-close').addEventListener('click', closeDetails);
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeDetails(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else { start(); refreshSummary(true); } });
window.addEventListener('pagehide', stop);
window.addEventListener('pageshow', (event) => { if (event.persisted) start(); });
render(); start();
