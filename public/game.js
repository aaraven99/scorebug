import { initializePreferences, updatePreferences, onPreferences, selectGame, ScoreboardPoller, feedIsStale, checkedAgo, gameLabel } from './score-client.js';
import { GameDetailsPoller } from './game-details-client.js';
import { renderScorebug } from './scorebug.js';
import { renderField } from './field.js';
import { getGameInsights } from './game-insights.js';
import { createScoreAnimations } from './score-animation.js';
import { createGameEventTracker } from './game-events.js';
import { latestPlayText, comparisonMarkup, insightsMarkup, quarterMarkup, playsMarkup, drivesMarkup, playerStatsMarkup, gameInfoMarkup, updateMarkup } from './game-view.js';

const $ = (id) => document.getElementById(id);
const bridge = window.scorebugDesktop;
let preferences = await initializePreferences();
let snapshot = { data: null, error: null, loading: true };
let summaryState = { data: null, error: null, loading: false };
let currentGame = null, currentContext = null, noticeTimer, healthTimer;
let nativeFullscreen = false;
const animations = createScoreAnimations($('center-scorebug'));
const tracker = createGameEventTracker();
const text = (id, value) => { const node = $(id); if (node.textContent !== value) node.textContent = value; };
function notice(message) { text('center-notice', message); $('center-notice').hidden = false; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => $('center-notice').hidden = true, 6000); }
function matchedSummary(game) {
  const id = game?.detailsGameId === null ? null : game?.detailsGameId || game?.id;
  return id && summaryState.data?.gameId === id ? summaryState.data : null;
}
function selectOptions(games, selected) {
  const select = $('center-game-select'), existing = new Map([...select.options].map((option) => [option.value, option]));
  const desired = games?.length ? games.map((game) => [game.id, gameLabel(game)]) : [['', snapshot.loading ? 'Finding games…' : 'No games in this schedule']];
  desired.forEach(([value, label], index) => {
    const option = existing.get(value) || new Option(label, value);
    if (option.text !== label) option.text = label;
    if (select.options[index] !== option) select.insertBefore(option, select.options[index] || null);
    existing.delete(value);
  });
  for (const option of existing.values()) option.remove();
  select.value = selected?.id || ''; select.disabled = !games?.length;
  $('center-automatic').setAttribute('aria-pressed', String(!preferences.gameId && !preferences.date));
}
function renderHealth() {
  const summary = matchedSummary(currentGame);
  const scoreDelayed = Boolean(snapshot.error || (snapshot.data && feedIsStale(snapshot.data)));
  const detailsDelayed = Boolean(summaryState.error || summary?.statsStale || (summary && feedIsStale(summary)));
  text('center-health', scoreDelayed ? `Feed delayed · ${checkedAgo(snapshot.data).toLowerCase()}` : snapshot.data ? checkedAgo(snapshot.data) : 'Connecting…');
  $('center-health').classList.toggle('delayed', scoreDelayed);
  text('center-summary-status', detailsDelayed ? 'Some details are delayed. Last received totals stay visible.' : summary ? 'Game totals · updating automatically' : currentGame?.detailsGameId === null ? 'This feed does not provide a detailed box score.' : currentGame ? 'Loading game details…' : 'Choose a game to see its details.');
  $('center-summary-status').classList.toggle('delayed', detailsDelayed);
  for (const id of ['center-stats-note', 'center-players-note']) { text(id, detailsDelayed ? 'Last available totals · delayed' : id === 'center-stats-note' ? 'All reported totals' : 'All reported categories'); $(id).classList.toggle('delayed', detailsDelayed); }
  const insights = getGameInsights(currentGame, summary, { stale: scoreDelayed });
  updateMarkup($('center-insights'), insightsMarkup(currentGame, insights));
  return { scoreDelayed, detailsDelayed, insights };
}
function render() {
  currentGame = selectGame(snapshot.data?.games, preferences);
  const game = currentGame, summary = matchedSummary(game);
  const context = `${game?.id || 'none'}:${preferences.date || 'current'}:${snapshot.data?.sourceId || 'espn-site'}`;
  if (context !== currentContext) {
    currentContext = context; tracker.reset(); animations.clear();
    for (const id of ['center-plays', 'center-comparison', 'center-scoring', 'center-drives']) $(id).scrollTop = 0;
  }
  selectOptions(snapshot.data?.games, game);
  const { scoreDelayed, insights } = renderHealth();
  const title = game ? `${game.away.name} at ${game.home.name}` : snapshot.loading ? 'Finding your game…' : 'No game selected';
  text('center-title', title);
  document.title = game ? `${game.away.abbreviation} ${game.away.score ?? '—'} · ${game.home.abbreviation} ${game.home.score ?? '—'} — Game center` : 'Game center — Scorebug';
  const board = game ? renderScorebug(game, { idPrefix: 'game-center', orientation: 'horizontal', interactive: false, stale: scoreDelayed }) : `<p class="empty-note">${snapshot.loading ? 'Connecting to the NFL feed…' : snapshot.error ? 'Unable to reach the feed. Reconnecting automatically.' : 'Choose Automatic to find a current game.'}</p>`;
  updateMarkup($('center-scorebug'), board); animations.attach('horizontal');
  text('center-status', game ? [game.status, game.broadcast, game.venue].filter(Boolean).join(' · ') : 'The last received score stays visible if a feed is interrupted.');
  updateMarkup($('center-quarters'), quarterMarkup(game, summary));
  updateMarkup($('center-field'), renderField(game));
  const offense = game && [game.away, game.home].find((team) => String(team.id) === String(game.possessionTeamId));
  text('center-possession', game?.phase === 'live' && offense ? `${offense.abbreviation} possession` : '');
  text('center-situation', game?.phase === 'live' ? [game.downDistance, game.fieldPosition ? `Ball at ${game.fieldPosition}` : null].filter(Boolean).join(' · ') || 'Waiting for down and field position.' : game?.status || 'Waiting for a game.');
  text('center-last-play', latestPlayText(game, summary) || (game?.state === 'pre' ? 'Play-by-play starts after kickoff.' : 'Waiting for a reported play.'));
  const drive = !summary?.statsStale && !summary?.stale && summary?.drives?.find((item) => item.isActive);
  text('center-current-drive', drive ? `Current drive: ${drive.description || [drive.plays != null ? `${drive.plays} plays` : '', drive.yards != null ? `${drive.yards} yards` : '', drive.timeElapsed].filter(Boolean).join(' · ')}` : '');
  updateMarkup($('center-comparison'), comparisonMarkup(game, insights));
  const plays = summary?.playByPlay?.length ? summary.playByPlay : summary?.eventPlays || [];
  updateMarkup($('center-plays'), playsMarkup(plays, game));
  text('center-play-count', plays.length ? `${plays.length}${plays.length >= 250 ? ' most recent' : ''} plays · newest first${summary && feedIsStale(summary) ? ' · delayed' : ''}` : 'Newest first');
  updateMarkup($('center-scoring'), playsMarkup(summary?.scoringPlays, game, { scoring: true }));
  updateMarkup($('center-drives'), drivesMarkup(summary?.drives, game));
  text('center-drive-count', summary?.drives?.length ? `${summary.drives.length} drives · newest first` : 'Newest first');
  updateMarkup($('center-players'), playerStatsMarkup(summary?.playerStats, game));
  updateMarkup($('center-info'), gameInfoMarkup(game, summary) || '<p class="empty-note">Game information has not been reported.</p>');
  text('center-source', [snapshot.data?.source, summary?.source && summary.source !== snapshot.data?.source ? summary.source : null].filter(Boolean).join(' · ') || 'Live data reconnects automatically.');
  if (!game || scoreDelayed) { tracker.reset(); animations.clear(); return; }
  const events = tracker.update({ game, details: summary && !summary.stale && !summaryState.error ? summary : null, contextKey: context, now: Date.now() });
  if (events.length) animations.enqueue(events, game);
}

const summaries = new GameDetailsPoller({ onUpdate: (next) => { summaryState = next; render(); } });
function update() {
  render();
  summaries.setGame(currentGame?.detailsGameId === null ? null : currentGame?.detailsGameId || currentGame?.id || null);
}
const poller = new ScoreboardPoller({ date: preferences.date, onUpdate: (next) => { snapshot = next; update(); } });
onPreferences((next) => { const old = preferences; preferences = next; if (old.date !== next.date) poller.setDate(next.date); update(); });
function choose(patch) {
  const url = new URL(location.href);
  if (Object.hasOwn(patch, 'gameId')) { if (patch.gameId) url.searchParams.set('game', patch.gameId); else url.searchParams.delete('game'); }
  if (Object.hasOwn(patch, 'date')) { if (patch.date) url.searchParams.set('date', patch.date); else url.searchParams.delete('date'); }
  url.searchParams.delete('team');
  try { history.replaceState(null, '', url); } catch { /* Shared preferences still carry the selection. */ }
  return updatePreferences(patch);
}
$('center-game-select').addEventListener('change', (event) => choose({ gameId: event.target.value || null }));
$('center-automatic').addEventListener('click', () => choose({ gameId: null, date: null }));
$('center-refresh').addEventListener('click', () => { poller.refresh(); summaries.refresh(); });
function renderFullscreen() { text('center-fullscreen', (bridge ? nativeFullscreen : Boolean(document.fullscreenElement)) ? 'Exit full screen' : 'Full screen'); }
$('center-fullscreen').addEventListener('click', async () => {
  try {
    if (bridge?.setGameCenterFullscreen) { const next = await bridge.setGameCenterFullscreen(!nativeFullscreen); nativeFullscreen = Boolean(next?.fullscreen); }
    else if (document.fullscreenElement) await document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
    else notice('This browser does not support full screen here. You can maximize the window instead.');
    renderFullscreen();
  } catch { notice('Full screen is unavailable here. You can maximize this window instead.'); }
});
document.addEventListener('fullscreenchange', renderFullscreen);
if (bridge?.getGameCenterState) {
  bridge.onGameCenterState?.((state) => { nativeFullscreen = Boolean(state?.fullscreen); renderFullscreen(); });
  bridge.getGameCenterState().then((state) => { nativeFullscreen = Boolean(state?.fullscreen); renderFullscreen(); }).catch(() => {});
}
function closeCenter(event) {
  if (bridge?.closeGameCenter) { event?.preventDefault(); bridge.closeGameCenter(); }
  else if (event?.currentTarget?.id === 'center-close') location.assign('/');
}
$('center-close').addEventListener('click', closeCenter);
$('game-back').addEventListener('click', closeCenter);
function start() { summaries.start(); poller.start(); clearInterval(healthTimer); healthTimer = setInterval(() => { const wasDelayed = $('center-health').classList.contains('delayed'); const { scoreDelayed } = renderHealth(); if (wasDelayed !== scoreDelayed) render(); }, 1000); }
function stop() { poller.stop(); summaries.stop(); tracker.reset(); animations.clear(); clearInterval(healthTimer); clearTimeout(noticeTimer); }
window.addEventListener('pagehide', stop);
window.addEventListener('pageshow', (event) => { if (event.persisted) start(); });
render(); start();
