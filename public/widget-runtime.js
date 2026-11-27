import { renderScorebug } from './scorebug.js';
import { initializePreferences, onPreferences, updatePreferences, isSupportedGameId, selectGame, ScoreboardPoller, feedIsStale } from './score-client.js';
import { attachDetailsHover } from './details-hover.js';
import { createGameActivity } from './game-activity.js';
import { createScoreAnimations } from './score-animation.js';
import { getLeague } from './sports.js';
import { gameLabel } from './score-client.js';
import { widgetPopupSize } from './widget-layout.js';

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
const detailsButton = document.createElement('button'); detailsButton.type = 'button'; detailsButton.title = 'Stats for the team with the ball'; detailsButton.setAttribute('aria-label', 'Show team stats'); detailsButton.className = 'widget-stats-button';
detailsButton.innerHTML = '<span class="widget-stats-label">Stats</span><svg class="widget-stats-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 12V8m5 4V3m5 9V6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const gameCenter = document.createElement('button'); gameCenter.type = 'button'; gameCenter.title = 'Full-screen game view'; gameCenter.setAttribute('aria-label', 'Open full-screen game view');
gameCenter.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 2H2v4m8-4h4v4M2 10v4h4m8-4v4h-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
toolbar.append(refresh, detailsButton, gameCenter, settings, close);
const layoutControls = document.createElement('div'); layoutControls.className = 'widget-layout-controls'; layoutControls.setAttribute('role', 'group'); layoutControls.setAttribute('aria-label', 'Scorebug layout');
const layoutButtons = ['horizontal', 'vertical'].map((orientation) => {
  const button = document.createElement('button'); button.type = 'button'; button.textContent = orientation === 'horizontal' ? 'Normal' : 'Side';
  button.setAttribute('aria-label', `${orientation === 'horizontal' ? 'Normal' : 'Side'} view`);
  button.addEventListener('click', () => {
    if (preferences.orientation === orientation) return;
    // Browser-created pop-outs may resize in this user gesture. A regular tab
    // may ignore it; the selected layout remains usable in its current viewport.
    if (!document.body.hasAttribute('data-pip') && window.opener) {
      const size = widgetPopupSize({ ...preferences, orientation });
      try { window.resizeTo(size.width + Math.max(0, outerWidth - innerWidth), size.height + Math.max(0, outerHeight - innerHeight)); } catch {}
    }
    detailsHover.close({ immediate: true });
    updatePreferences({ orientation }).catch(() => {});
  });
  layoutControls.append(button); return button;
});
if (!desktop) toolbar.prepend(layoutControls);
const board = document.createElement('div'); board.className = 'widget-board';
const hint = document.createElement('span'); hint.className = 'widget-hint'; hint.textContent = 'SCOREBUG / LIVE SPORTS';
root.append(toolbar, hint, board);
function possessingSide() { const game = selectGame(snapshot.data?.games, preferences); return ['race','leaderboard'].includes(game?.kind) ? 'comparison' : game?.possessionTeamId && game?.possessionTeamId === game?.away?.id ? 'away' : 'home'; }
const detailsHover = attachDetailsHover(board, { native: desktop, defaultSide: possessingSide });
const animations = createScoreAnimations(board);
const activity = createGameActivity({ onEvents: (events, game) => animations.enqueue(events, game), onReset: () => animations.clear(), onDetails: () => render() });
function updateActivity() { activity.setGame(selectGame(snapshot.data?.games, preferences), preferences.date || 'current', snapshot.data?.fetchedAt, { sourceId: snapshot.data?.sourceId, stale: snapshot.data?.stale, error: Boolean(snapshot.error) }); }
let nativeDetailsSide = null;
let nativeDetailsGameId, nativeDetailsLeagueId;
let regionFrame = null;
detailsButton.addEventListener('click', () => detailsHover.open());

function render() {
  document.body.dataset.locked = String(Boolean(preferences.locked));
  document.body.dataset.orientation = preferences.orientation === 'vertical' ? 'vertical' : 'horizontal';
  document.body.style.setProperty('--widget-side-width', `${widgetPopupSize({ ...preferences, orientation: 'vertical' }).width - 16}px`);
  layoutButtons.forEach((button, index) => button.setAttribute('aria-pressed', String((preferences.orientation === 'vertical') === Boolean(index))));
  const topAligned = desktop && preferences.contentAlignment === 'top';
  document.body.dataset.contentAlignment = topAligned ? 'top' : 'bottom';
  const game = activity.getDisplayGame(selectGame(snapshot.data?.games, preferences));
  const gameId = isSupportedGameId(game?.id) ? game.id : null;
  if (desktop && (gameId !== nativeDetailsGameId || preferences.leagueId !== nativeDetailsLeagueId)) {
    nativeDetailsGameId = gameId; nativeDetailsLeagueId = preferences.leagueId;
    const task = window.scorebugDesktop.setDetailsContext
      ? window.scorebugDesktop.setDetailsContext({gameId,leagueId:preferences.leagueId})
      : window.scorebugDesktop.setDetailsGameId?.(gameId);
    task?.catch(() => { if(nativeDetailsGameId===gameId)nativeDetailsGameId=undefined; });
  }
  if (game) {
    const html = renderScorebug(game, { idPrefix: 'floating', styleId: preferences.styleId, orientation: preferences.orientation, statusPosition: topAligned ? 'below' : 'above', stale: feedIsStale(snapshot.data, Boolean(snapshot.error)) || game.timingStale });
    if (rendered !== html) { board.innerHTML = html; rendered = html; }
    animations.attach(preferences.orientation);
    const side = possessingSide();
    if (desktop && side !== nativeDetailsSide) { nativeDetailsSide = side; window.scorebugDesktop.setDefaultDetailsSide?.(side); }
    document.title = `${gameLabel(game)} — Scorebug`;
    hint.textContent = `${game.away && game.home ? `${game.away.abbreviation} @ ${game.home.abbreviation}` : game.name || game.sessionName || 'Session'} / ${feedIsStale(snapshot.data, Boolean(snapshot.error)) || game.timingStale ? 'FEED DELAYED' : snapshot.data?.feedStatus === 'backup' ? 'BACKUP FEED' : 'LIVE FEED'}`;
  } else {
    rendered = '';
    const message = document.createElement('div'); message.className = `empty-scorebug${snapshot.error ? ' error' : ''}`;
    message.textContent = snapshot.loading ? `Connecting to ${getLeague(preferences.leagueId)?.name || 'the feed'}…` : snapshot.error ? 'Feed unavailable · reconnecting…' : preferences.gameId ? 'Selected game unavailable' : 'No events on this date';
    const help = document.createElement('small'); help.textContent = 'Hover here for settings'; message.append(help); board.replaceChildren(message);
  }
  syncNativeRegions();
}
function syncNativeRegions() {
  if(!desktop || !window.scorebugDesktop.setDetailsRegions)return;
  if(regionFrame!==null)cancelAnimationFrame(regionFrame);
  regionFrame=requestAnimationFrame(()=>{
    regionFrame=null;
    const bounds=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
    const targets=[...board.querySelectorAll('.bug-details-target[data-details-side]')].slice(0,32).map(node=>({side:node.dataset.detailsSide,...bounds(node)}));
    const panels={};
    for(const side of ['away','home','comparison']){
      const group=board.querySelector(`[data-team-side="${side}"]`);
      const path=side==='comparison'?board.querySelector('.bug-situation-panel'):group?.querySelector('.bug-team-panel');
      if(path){
        const match=/^M([\d.-]+)\s+([\d.-]+)H([\d.-]+)L([\d.-]+)\s+([\d.-]+)H([\d.-]+)Z$/.exec(path.getAttribute('d')||'');
        const matrix=path.getScreenCTM();
        const points=match&&matrix?(()=>{const[,x1,y1,x2,x3,y3,x4]=match.map(Number);return [[x1,y1],[x2,y1],[x3,y3],[x4,y3]].map(([x,y])=>{const p=new DOMPoint(x,y).matrixTransform(matrix);return [p.x,p.y];});})():undefined;
        panels[side]={...bounds(path),points,fill:group?.dataset.teamFill||path.getAttribute('fill'),border:group?.dataset.teamBorder||path.getAttribute('stroke'),ink:group?.dataset.teamInk};
      }
    }
    const shapes=Object.values(panels), artwork=shapes.length?{x:Math.min(...shapes.map(r=>r.x)),y:Math.min(...shapes.map(r=>r.y)),width:Math.max(...shapes.map(r=>r.x+r.width))-Math.min(...shapes.map(r=>r.x)),height:Math.max(...shapes.map(r=>r.y+r.height))-Math.min(...shapes.map(r=>r.y))}:null;
    window.scorebugDesktop.setDetailsRegions({targets,panels,board:artwork,styleId:preferences.styleId,legacyBlades:preferences.styleId==='nfl-blades'&&!board.querySelector('svg')?.classList.contains('scorebug--variant')}).catch(()=>{});
  });
}
window.addEventListener('resize',syncNativeRegions);
const poller = new ScoreboardPoller({ leagueId: preferences.leagueId, date: preferences.date, onUpdate: (next) => { snapshot = next; render(); updateActivity(); } });
onPreferences((next) => { const old = preferences; preferences = next; if (old.date !== next.date || old.leagueId !== next.leagueId) poller.setContext({date:next.date,leagueId:next.leagueId}); render(); updateActivity(); });
refresh.addEventListener('click', () => { poller.refresh(); activity.refresh(); });
settings.addEventListener('click', () => {
  if (desktop) window.scorebugDesktop.openSettings();
  else if (window.opener && !window.opener.closed) window.opener.focus();
  else window.open(new URL('/', document.baseURI).href, '_blank', 'noopener,noreferrer');
});
gameCenter.addEventListener('click', () => {
  detailsHover.close({ immediate: true });
  if (desktop) window.scorebugDesktop.openGameCenter();
  else window.open(new URL('/game.html', document.baseURI).href, '_blank', 'noopener,noreferrer');
});
close.addEventListener('click', () => { if (desktop) window.scorebugDesktop.closeWidget(); else window.close(); });
function checkAge() { if (snapshot.data && feedIsStale(snapshot.data, Boolean(snapshot.error))) render(); }
render(); activity.start(); poller.start();
let ageTimer = setInterval(checkAge, 1000);
window.addEventListener('pagehide', () => { poller.stop(); activity.stop(); clearInterval(ageTimer); });
window.addEventListener('pageshow', (event) => {
  if (event.persisted) { activity.start(); poller.start(); clearInterval(ageTimer); ageTimer = setInterval(checkAge, 1000); }
});
