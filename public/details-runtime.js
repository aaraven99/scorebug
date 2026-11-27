import { initializePreferences, onPreferences, selectGame, ScoreboardPoller, feedIsStale } from './score-client.js';
import { GameDetailsPoller } from './game-details-client.js';
import { localTeamLogo } from './team-assets.js';
import { teamColor } from './scorebug.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
let side = params.get('side') === 'away' ? 'away' : 'home';
let preferences = await initializePreferences();
let snapshot = { data: null, error: null, loading: true };
let summaryState = { data: null, error: null, loading: false };
let currentGame = null, ageTimer;
const STAT_ROWS = [['totalYards', 'Total yards'], ['netPassingYards', 'Passing yards'], ['rushingYards', 'Rushing yards'], ['thirdDownEff', 'Third downs'], ['turnovers', 'Turnovers'], ['possessionTime', 'Possession time']];

function render() {
  currentGame = selectGame(snapshot.data?.games, preferences);
  const game = currentGame, team = game?.[side];
  const summary = summaryState.data?.gameId === game?.id ? summaryState.data : null;
  document.body.dataset.side = side;
  const color = team ? teamColor(team, side) : '#33483b';
  document.documentElement.style.setProperty('--team-color', color);
  $('details-name').textContent = `${side === 'away' ? 'AWAY' : 'HOME'} · TEAM STATS`;
  $('details-match').textContent = team ? `${team.abbreviation} · ${team.score ?? '—'}` : snapshot.loading ? 'Connecting…' : 'No game';
  $('details-match').title = team?.name || '';
  document.title = team ? `${team.abbreviation} team stats — Scorebug` : 'Scorebug — Team stats';
  const logo = team && localTeamLogo(team);
  $('details-logo').hidden = !logo;
  if (logo && $('details-logo').getAttribute('src') !== logo) $('details-logo').src = logo;
  const rows = summary?.teamStats || [];
  const fragment = document.createDocumentFragment();
  for (const [key, label] of STAT_ROWS) {
    const stat = rows.find((row) => row.key === key);
    const tr = document.createElement('tr'), th = document.createElement('th'), td = document.createElement('td');
    th.scope = 'row'; th.textContent = label; td.textContent = stat?.[side] ?? '—';
    tr.append(th, td); fragment.append(tr);
  }
  $('stats-body').replaceChildren(fragment);
  const possession = game && [game.away, game.home].find((candidate) => candidate.id === game.possessionTeamId);
  $('field-position').textContent = game?.fieldPosition ? `${possession?.abbreviation || 'Ball'} · ${game.fieldPosition}` : game?.phase === 'final' ? 'Final' : game?.phase === 'halftime' ? 'Halftime' : 'Position unavailable';
  $('field-down').textContent = game?.state === 'in' ? game.downDistance || '' : '';
  const play = game?.lastPlay || summary?.lastPlay?.text || (game?.state === 'pre' ? 'Team totals appear after kickoff.' : 'Waiting for a reported play.');
  $('details-play').textContent = play; $('details-play').title = play;
  const delayed = Boolean(summaryState.error || snapshot.error || (summary && feedIsStale(summary)) || (snapshot.data && feedIsStale(snapshot.data)));
  $('stats-status').textContent = game?.detailsGameId === null ? 'Team totals unavailable'
    : delayed ? summary ? 'Last received · reconnecting' : 'Stats unavailable · retrying' : summary ? 'Game totals · auto-updating' : game ? 'Loading team stats…' : 'No game selected';
  $('stats-status').className = delayed ? 'delayed' : '';
  $('details-source').textContent = summary?.source || snapshot.data?.source || '';
}
const summaries = new GameDetailsPoller({ onUpdate: (next) => { summaryState = next; render(); } });
function update() { render(); summaries.setGame(currentGame?.detailsGameId === null ? null : currentGame?.detailsGameId || currentGame?.id || null); }
const poller = new ScoreboardPoller({ date: preferences.date, onUpdate: (next) => { snapshot = next; update(); } });
onPreferences((next) => { const oldDate = preferences.date; preferences = next; if (oldDate !== next.date) poller.setDate(next.date); update(); });
function setSide(value) { if (value === 'away' || value === 'home') { side = value; render(); } }
window.scorebugDesktop?.onDetailsSideChanged?.(setSide);
if (window.scorebugDesktop?.getState) {
  try { setSide((await window.scorebugDesktop.getState()).detailsSide); } catch { /* The URL remains the initial side if the window is closing. */ }
}
window.addEventListener('message', (event) => {
  if (event.source === window.parent && event.origin === new URL(document.baseURI).origin && event.data?.type === 'scorebug:details-side') setSide(event.data.side);
});
function start() { summaries.start(); poller.start(); clearInterval(ageTimer); ageTimer = setInterval(render, 1000); }
function stop() { summaries.stop(); poller.stop(); clearInterval(ageTimer); }
function closeDetails() {
  if (window.scorebugDesktop?.hideDetails) window.scorebugDesktop.hideDetails();
  else if (window.parent !== window) window.parent.postMessage({ type: 'scorebug:close-details' }, new URL(document.baseURI).origin);
  else window.close();
}
$('details-close').addEventListener('click', closeDetails);
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeDetails(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else start(); });
window.addEventListener('pagehide', stop);
window.addEventListener('pageshow', (event) => { if (event.persisted) start(); });
render(); start();
