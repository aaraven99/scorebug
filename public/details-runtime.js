import { getLeague, normalizeLeague, sportFor, mergeSportDetails, formatSituation, formatPeriod } from './sports.js';
import { statPriority, statLabel } from './sport-stats.js';
import { renderSportSurface, classificationMarkup, raceControlMarkup } from './sport-view.js';
import { initializePreferences, onPreferences, selectGame, isSupportedGameId, ScoreboardPoller, feedIsStale } from './score-client.js';
import { GameDetailsPoller } from './game-details-client.js';
import { localTeamLogo } from './team-assets.js';
import { teamPalette } from './scorebug.js';
import { bladeOutline, BLADE_OPEN_MS } from './details-blade.js';
import { renderField } from './field.js';
import { getGameInsights } from './game-insights.js';
import { escapeHTML, latestPlayText, comparisonMarkup, insightsMarkup, updateMarkup } from './game-view.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const sides = ['away', 'home', 'comparison'];
let side = sides.includes(params.get('side')) ? params.get('side') : 'home';
let presentation = { side, direction: params.get('direction') || (side === 'away' ? 'left' : 'right'), orientation: params.get('orientation') || 'horizontal', phase: 'closed' };
// Embedded/native stats must wait for the source widget's identity.
if (params.has('embedded') || window.scorebugDesktop) presentation.gameId = null;
let presentationRevision = 0, renderReady = false;
const presentationKeys = ['joinTop', 'joinBottom', 'joinTopX', 'joinBottomX', 'joinLeft', 'joinRight', 'joinY', 'neckHeight', 'gradientX', 'gradientY', 'gradientWidth', 'gradientHeight'];
for (const key of presentationKeys) if (params.has(key)) presentation[key] = Number(params.get(key));
const validColor = (value) => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
function paintBlade(palette) {
  document.documentElement.style.setProperty('--team-color', palette.fill);
  document.documentElement.style.setProperty('--team-ink', palette.ink);
  document.documentElement.style.setProperty('--team-muted', `${palette.ink}bf`);
  document.documentElement.style.setProperty('--team-line', `${palette.ink}40`);
  $('blade-outline').setAttribute('fill', palette.fill);
  $('blade-border').setAttribute('stroke', palette.border);
}
function drawBlade() {
  const outline = bladeOutline(innerWidth, innerHeight, presentation);
  document.querySelector('.blade-frame').setAttribute('viewBox', `0 0 ${outline.width} ${outline.height}`);
  $('blade-outline').setAttribute('d', outline.path);
  $('blade-border').setAttribute('d', outline.borderPath);
  document.querySelector('.team-details').style.clipPath = outline.clip;
  const { top, right, bottom, left } = outline.inset;
  document.querySelector('.blade-content').style.inset = `${top}px ${right}px ${bottom}px ${left}px`;
}
function applyPresentation(value) {
  if (!value || typeof value !== 'object') return;
  const next = { ...presentation };
  if (sides.includes(value.side)) next.side = value.side;
  if (Object.hasOwn(value, 'leagueId') && getLeague(value.leagueId)) next.leagueId = value.leagueId;
  if (Object.hasOwn(value, 'gameId')) next.gameId = isSupportedGameId(value.gameId) ? value.gameId : null;
  if (['left', 'right', 'up', 'down'].includes(value.direction)) next.direction = value.direction;
  if (['horizontal', 'vertical'].includes(value.orientation)) next.orientation = value.orientation;
  if (['closed', 'opening', 'open', 'closing'].includes(value.phase)) next.phase = value.phase;
  for (const key of presentationKeys) if (Number.isFinite(value[key])) next[key] = value[key];
  if (Object.hasOwn(value, 'direction') && !Number.isFinite(value.neckHeight)) delete next.neckHeight;
  // A target change must not briefly reuse the previous team's colors.
  if (next.side !== presentation.side) for (const key of ['teamColor', 'teamFill', 'teamBorder', 'teamInk']) delete next[key];
  for (const key of ['teamColor', 'teamFill', 'teamBorder', 'teamInk']) if (validColor(value[key])) next[key] = value[key];
  const wasClosed = presentation.phase === 'closed';
  presentation = next; side = next.side;
  document.body.dataset.direction = next.direction;
  document.body.dataset.orientation = next.orientation;
  drawBlade();
  if (wasClosed && next.phase !== 'closed') document.querySelector('.blade-reveal').getBoundingClientRect();
  document.body.dataset.phase = next.phase;
  document.querySelector('.blade-content').inert = ['closed', 'closing'].includes(next.phase);
  if (renderReady) update();
}
applyPresentation(presentation);
window.addEventListener('resize', drawBlade);
window.scorebugDesktop?.onDetailsPresentationChanged?.((value) => { presentationRevision += 1; applyPresentation(value); });
if (window.scorebugDesktop?.getDetailsPresentation) {
  const revision = presentationRevision;
  window.scorebugDesktop.getDetailsPresentation().then((value) => { if (revision === presentationRevision) applyPresentation(value); }).catch(() => {});
} else if (!params.has('embedded')) {
  applyPresentation({ phase: 'opening' });
  setTimeout(() => { if (presentation.phase === 'opening') applyPresentation({ phase: 'open' }); }, BLADE_OPEN_MS);
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

function render() {
  const ownsGame = Object.hasOwn(presentation, 'gameId');
  currentGame = ownsGame ? presentation.gameId ? selectGame(snapshot.data?.games, { gameId: presentation.gameId }) : null : selectGame(snapshot.data?.games, preferences);
  const selectedGame = currentGame;
  const selectedDetailsId = selectedGame?.detailsGameId === null ? null : selectedGame?.detailsGameId || selectedGame?.id;
  currentGame=mergeSportDetails(selectedGame,selectedDetailsId&&summaryState.data?.gameId===selectedDetailsId?summaryState.data:null);
  const game = currentGame, comparing = side === 'comparison' || ['race','leaderboard'].includes(game?.kind), team = game?.[side];
  const detailsGameId = game?.detailsGameId === null ? null : game?.detailsGameId || game?.id;
  const summary = detailsGameId && summaryState.data?.gameId === detailsGameId ? summaryState.data : null;
  const statsDelayed = Boolean(summary?.statsStale || game?.timingStale || summaryState.error || (summary && feedIsStale(summary)));
  const scoreDelayed = Boolean(snapshot.error || (snapshot.data && feedIsStale(snapshot.data)));
  document.body.dataset.side = side;
  const palette = comparing ? { fill: '#101b16', border: '#050b08', ink: '#fffef5' } : teamPalette(team || { color: '#33483b' }, side);
  if (!comparing) {
    if (presentation.teamColor) Object.assign(palette, teamPalette({ color: presentation.teamColor }, side));
    if (presentation.teamFill) palette.fill = presentation.teamFill;
    if (presentation.teamBorder) palette.border = presentation.teamBorder;
    if (presentation.teamInk) palette.ink = presentation.teamInk;
  }
  paintBlade(palette);
  $('details-name').textContent = comparing ? statsDelayed ? 'COMPARISON · STATS DELAYED' : 'GAME COMPARISON' : `${side === 'away' ? 'AWAY' : 'HOME'} · ${statsDelayed ? 'STATS DELAYED' : 'TEAM STATS'}`;
  $('details-name').classList.toggle('delayed', statsDelayed);
  $('details-name').title = statsDelayed ? 'Team totals are delayed. The latest received totals remain visible.' : '';
  $('details-match').textContent = comparing ? game ? ['race','leaderboard'].includes(game.kind) ? game.sessionName || game.name || 'Session' : `${game.away.abbreviation} vs ${game.home.abbreviation}` : 'Waiting for a game' : team ? `${team.abbreviation} · ${team.score ?? '—'}` : snapshot.loading ? 'Connecting…' : ownsGame && presentation.gameId ? 'Game unavailable' : 'No game';
  $('details-match').title = team?.name || '';
  document.title = comparing ? 'Game comparison — Scorebug' : team ? `${team.abbreviation} team stats — Scorebug` : 'Scorebug — Team stats';
  const logo = !comparing && team && localTeamLogo(team);
  $('details-logo').hidden = !logo;
  if (logo && $('details-logo').getAttribute('src') !== logo) $('details-logo').src = logo;
  $('team-stats').hidden = comparing; $('comparison-stats').hidden = !comparing; $('details-insights').hidden = !comparing; $('details-play').hidden = comparing;
  if (comparing) {
    const insights = getGameInsights(game, summary, { stale: scoreDelayed });
    updateMarkup($('comparison-stats'), ['race','leaderboard'].includes(game?.kind) ? classificationMarkup(game,{compact:true}) : comparisonMarkup(game, insights, { compact: true }));
    $('details-insights').hidden = ['race','leaderboard'].includes(game?.kind);
    updateMarkup($('details-insights'), ['race','leaderboard'].includes(game?.kind) ? '' : insightsMarkup(game, insights, { compact: true }));
  } else {
    const available = summary?.allTeamStats?.length ? summary.allTeamStats : summary?.teamStats || [];
    const priority = statPriority(game);
    const rows = [...priority.map(key=>available.find(row=>row.key===key)).filter(Boolean),...available.filter(row=>!priority.includes(row.key))];
    updateMarkup($('stats-body'), rows.length ? rows.map(row => `<tr><th scope="row">${escapeHTML(statLabel(row))}</th><td>${escapeHTML(row[side] ?? '—')}</td></tr>`).join('') : '<tr><td>Team totals have not been reported yet.</td></tr>');
  }
  // The field belongs to the middle comparison, never an individual team blade.
  const showField = comparing && !['race','leaderboard'].includes(game?.kind);
  document.querySelector('.field-block').hidden = !showField;
  updateMarkup($('details-field'), showField ? renderSportSurface(game) : '');
  $('field-position').textContent = game?.phase === 'live' && game.fieldPosition ? `Ball at ${game.fieldPosition}` : game ? formatPeriod(game) : '';
  $('field-down').textContent = game?.phase === 'live' ? formatSituation(game) : '';
  const play = latestPlayText(game, summary) || (game?.state === 'pre' ? 'Team totals appear after play begins.' : 'Waiting for a reported play.');
  $('details-play').textContent = play; $('details-play').title = play;
  $('stats-status').textContent = game?.detailsGameId === null ? 'Team totals unavailable' : scoreDelayed || statsDelayed ? summary ? 'Last received · reconnecting' : 'Stats unavailable · retrying' : summary ? 'Auto-updating' : game ? 'Loading team stats…' : 'No game selected';
  $('stats-status').className = scoreDelayed || statsDelayed ? 'delayed' : '';
  $('details-source').textContent = summary?.source || snapshot.data?.source || '';
}
const summaries = new GameDetailsPoller({ onUpdate: (next) => { summaryState = next; render(); } });
function update() {
  const leagueId = presentation.leagueId || preferences.leagueId;
  if (poller.leagueId !== leagueId || poller.date !== preferences.date) { poller.setContext({leagueId,date:preferences.date}); return; }
  render(); summaries.setGame(currentGame?.detailsGameId === null ? null : currentGame?.detailsGameId || currentGame?.id || null,leagueId,preferences.date);
}
const poller = new ScoreboardPoller({ leagueId: presentation.leagueId || preferences.leagueId, date: preferences.date, onUpdate: (next) => { snapshot = next; update(); } });
onPreferences((next) => { preferences = next; update(); });
function setSide(value) { if (sides.includes(value)) applyPresentation({ side: value }); }
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
