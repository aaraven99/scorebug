import { initializePreferences, onPreferences, selectGame, ScoreboardPoller, feedIsStale } from './score-client.js';
import { GameDetailsPoller } from './game-details-client.js';
import { localTeamLogo } from './team-assets.js';
import { teamColor } from './scorebug.js';
import { bladeOutline, BLADE_OPEN_MS } from './details-blade.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
let side = params.get('side') === 'away' ? 'away' : 'home';
let presentation = { side, direction: params.get('direction') || (side === 'away' ? 'left' : 'right'), orientation: params.get('orientation') || 'horizontal', phase: 'closed' };
let presentationRevision = 0, renderReady = false;
const presentationKeys = ['joinTop','joinBottom','joinTopX','joinBottomX','joinLeft','joinRight','joinY'];
for (const key of presentationKeys) if (params.has(key)) presentation[key] = Number(params.get(key));
function drawBlade() {
  const outline = bladeOutline(innerWidth, innerHeight, presentation);
  document.querySelector('.blade-frame').setAttribute('viewBox', `0 0 ${outline.width} ${outline.height}`);
  $('blade-outline').setAttribute('d', outline.path);
  document.querySelector('.team-details').style.clipPath = outline.clip;
  const { top,right,bottom,left } = outline.inset;
  document.querySelector('.blade-content').style.inset = `${top}px ${right}px ${bottom}px ${left}px`;
}
function applyPresentation(value) {
  if (!value || typeof value !== 'object') return;
  const next = { ...presentation };
  if (value.side === 'away' || value.side === 'home') next.side = value.side;
  if (['left','right','up','down'].includes(value.direction)) next.direction = value.direction;
  if (['horizontal','vertical'].includes(value.orientation)) next.orientation = value.orientation;
  if (['closed','opening','open','closing'].includes(value.phase)) next.phase = value.phase;
  for (const key of presentationKeys) if (Number.isFinite(value[key])) next[key] = value[key];
  if (typeof value.teamColor === 'string' && /^#[\da-f]{6}$/i.test(value.teamColor)) next.teamColor = value.teamColor;
  const wasClosed = presentation.phase === 'closed';
  presentation = next; side = next.side;
  document.body.dataset.direction = next.direction;
  document.body.dataset.orientation = next.orientation;
  drawBlade();
  // Resolve the collapsed style before its first reveal. Subsequent changes
  // reverse the same transition, including rapid re-entry during retraction.
  if (wasClosed && next.phase !== 'closed') document.querySelector('.blade-reveal').getBoundingClientRect();
  document.body.dataset.phase = next.phase;
  document.querySelector('.blade-content').inert = ['closed','closing'].includes(next.phase);
  if (next.teamColor) document.documentElement.style.setProperty('--team-color', next.teamColor);
  if (renderReady) render();
}
applyPresentation(presentation);
window.addEventListener('resize', drawBlade);
const nativePresentation = window.scorebugDesktop?.onDetailsPresentationChanged?.((value) => { presentationRevision += 1; applyPresentation(value); });
if (window.scorebugDesktop?.getDetailsPresentation) {
  const revision = presentationRevision;
  window.scorebugDesktop.getDetailsPresentation().then((value) => { if (revision === presentationRevision) applyPresentation(value); }).catch(() => {});
} else if (!params.has('embedded')) {
  applyPresentation({ phase:'opening' });
  setTimeout(() => { if (presentation.phase === 'opening') applyPresentation({phase:'open'}); }, BLADE_OPEN_MS);
}
window.addEventListener('message', (event) => {
  if (event.source !== window.parent || event.origin !== new URL(document.baseURI).origin) return;
  if (event.data?.type === 'scorebug:details-presentation') { presentationRevision += 1; applyPresentation(event.data.presentation); }
  else if (event.data?.type === 'scorebug:details-side') setSide(event.data.side);
});
let preferences = await initializePreferences();
let snapshot = { data: null, error: null, loading: true };
let summaryState = { data: null, error: null, loading: false };
let currentGame = null, ageTimer;
const STAT_ROWS = [['totalYards', 'Total yards'], ['netPassingYards', 'Passing yards'], ['rushingYards', 'Rushing yards'], ['thirdDownEff', 'Third downs'], ['turnovers', 'Turnovers'], ['possessionTime', 'Possession time']];

function latestPlayText(game, summary) {
  const primary = game?.lastPlayDetails, detail = summary?.lastPlay;
  if (!game?.lastPlay) return detail?.text;
  if (!detail?.text || !primary) return game.lastPlay;
  // These normalized ESPN play IDs are ordered within the matched game.
  // A newly fetched response alone is not evidence that its play is newer.
  if (/^\d+$/.test(primary.id) && /^\d+$/.test(detail.id) && primary.id !== detail.id) return BigInt(detail.id) > BigInt(primary.id) ? detail.text : game.lastPlay;
  if (Number.isFinite(primary.sequenceNumber) && Number.isFinite(detail.sequenceNumber) && primary.sequenceNumber !== detail.sequenceNumber) return detail.sequenceNumber > primary.sequenceNumber ? detail.text : game.lastPlay;
  const primaryTime = Date.parse(primary.wallclock), detailTime = Date.parse(detail.wallclock);
  return Number.isFinite(primaryTime) && Number.isFinite(detailTime) && detailTime > primaryTime ? detail.text : game.lastPlay;
}

function render() {
  currentGame = selectGame(snapshot.data?.games, preferences);
  const game = currentGame, team = game?.[side];
  const detailsGameId = game?.detailsGameId === null ? null : game?.detailsGameId || game?.id;
  const summary = detailsGameId && summaryState.data?.gameId === detailsGameId ? summaryState.data : null;
  const statsDelayed = Boolean(summary?.statsStale);
  document.body.dataset.side = side;
  const color = presentation.teamColor || (team ? teamColor(team, side) : '#33483b');
  document.documentElement.style.setProperty('--team-color', color);
  $('details-name').textContent = `${side === 'away' ? 'AWAY' : 'HOME'} · ${statsDelayed ? 'STATS DELAYED' : 'TEAM STATS'}`;
  $('details-name').classList.toggle('delayed', statsDelayed);
  $('details-name').title = statsDelayed ? 'Team totals are delayed. Recent plays can still update.' : '';
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
    tr.setAttribute('role','row'); th.scope = 'row'; th.setAttribute('role','rowheader'); td.setAttribute('role','cell'); th.textContent = label; td.textContent = stat?.[side] ?? '—';
    tr.append(th, td); fragment.append(tr);
  }
  $('stats-body').replaceChildren(fragment);
  $('field-position').textContent = game?.fieldPosition ? `Ball at ${game.fieldPosition}` : game?.phase === 'final' ? 'Final' : game?.phase === 'halftime' ? 'Halftime' : 'Position unavailable';
  $('field-down').textContent = game?.state === 'in' ? game.downDistance || '' : '';
  const play = latestPlayText(game, summary) || (game?.state === 'pre' ? 'Team totals appear after kickoff.' : 'Waiting for a reported play.');
  $('details-play').textContent = play; $('details-play').title = play;
  const delayed = Boolean(summaryState.error || snapshot.error || (summary && feedIsStale(summary)) || (snapshot.data && feedIsStale(snapshot.data)));
  $('stats-status').textContent = game?.detailsGameId === null ? 'Team totals unavailable'
    : delayed ? summary ? 'Last received · reconnecting' : 'Stats unavailable · retrying'
      : statsDelayed ? 'Stats delayed · plays updating' : summary ? 'Game totals · auto-updating' : game ? 'Loading team stats…' : 'No game selected';
  $('stats-status').className = delayed || statsDelayed ? 'delayed' : '';
  $('details-source').textContent = summary?.source || snapshot.data?.source || '';
}
const summaries = new GameDetailsPoller({ onUpdate: (next) => { summaryState = next; render(); } });
function update() { render(); summaries.setGame(currentGame?.detailsGameId === null ? null : currentGame?.detailsGameId || currentGame?.id || null); }
const poller = new ScoreboardPoller({ date: preferences.date, onUpdate: (next) => { snapshot = next; update(); } });
onPreferences((next) => { const oldDate = preferences.date; preferences = next; if (oldDate !== next.date) poller.setDate(next.date); update(); });
function setSide(value) { if (value === 'away' || value === 'home') { side = value; presentation.side = value; if (renderReady) render(); } }
window.scorebugDesktop?.onDetailsSideChanged?.(setSide);
if (window.scorebugDesktop?.getState) {
  try { setSide((await window.scorebugDesktop.getState()).detailsSide); } catch { /* The URL remains the initial side if the window is closing. */ }
}
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
renderReady = true; render(); start();
