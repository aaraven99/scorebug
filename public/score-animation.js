import { localTeamLogo } from './team-assets.js';
import { teamColor } from './scorebug.js';

const EXIT_MS = 260;
const QUEUE_MAX_AGE_MS = 20000;
const cleanText = (value, limit = 96) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';

function playerFor(event) {
  const name = cleanText(event.player?.name);
  if (!name) return null;
  let headshot = null;
  try {
    const url = new URL(event.player.headshot);
    if (url.protocol === 'https:' && !url.username && !url.password && !url.port && ['a.espncdn.com','media.formula1.com'].includes(url.hostname)) headshot = url.href;
  } catch { /* A name remains useful when the feed supplies no usable photo. */ }
  return { name, headshot };
}

function eventDetail(event, team) {
  const result = [team?.abbreviation];
  if (event.statDetail) result.push(cleanText(event.statDetail,64));
  if (event.kind === 'big-play' && Number.isFinite(event.yardsGained)) result.push(`${event.yardsGained} YARDS`);
  else if (Number.isFinite(event.points) && event.points > 0) result.push(`+${event.points}`);
  else if (event.kind === 'interception' || event.kind === 'fumble') result.push('TURNOVER');
  return result.filter(Boolean).join(' · ');
}

/**
 * Bounded notices over the team row; the game clock and real scores are untouched.
 * Every notice owns its timers and exit completion. A replaced demo finishes its
 * short exit before the next notice enters, and live notices always take priority.
 */
export function createScoreAnimations(host) {
  const document = host.ownerDocument;
  const window = document.defaultView;
  const overlay = document.createElement('div');
  overlay.className = 'score-animation';
  overlay.setAttribute('role', 'status'); overlay.setAttribute('aria-live', 'polite');
  overlay.setAttribute('aria-atomic', 'true'); overlay.hidden = true;
  let queue = [], active = null, currentGameId = null, generation = 0, gapTimer = null;
  const reducedMotion = () => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);

  function attach(orientation = 'horizontal') {
    host.classList.add('score-animation-host');
    host.dataset.animationOrientation = orientation === 'vertical' ? 'vertical' : 'horizontal';
    if (overlay.parentElement !== host) host.append(overlay);
  }

  function cancelGap() { window.clearTimeout(gapTimer); gapTimer = null; }

  function resetOverlay() {
    overlay.hidden = true; overlay.replaceChildren();
    overlay.classList.remove('is-playing', 'is-exiting');
    for (const key of ['kind', 'demo', 'state', 'player']) delete overlay.dataset[key];
    for (const property of ['--event-exit-clip', '--event-exit-opacity', '--event-exit-transform']) overlay.style.removeProperty(property);
  }

  function finishExit(record, token) {
    if (active !== record || record.exitToken !== token || record.phase !== 'exiting') return;
    window.clearTimeout(record.exitTimer);
    if (record.onExit) overlay.removeEventListener('animationend', record.onExit);
    active = null; resetOverlay();
    if (queue.length) {
      const nextGeneration = generation;
      gapTimer = window.setTimeout(() => {
        gapTimer = null;
        if (nextGeneration === generation && !active) playNext();
      }, reducedMotion() ? 0 : 70);
    }
  }

  function exitCurrent() {
    if (!active || active.phase === 'exiting') return;
    const record = active;
    window.clearTimeout(record.holdTimer);
    record.phase = 'exiting'; record.exitToken = ++generation;
    const token = record.exitToken;
    overlay.dataset.state = 'exiting';
    if (reducedMotion()) { finishExit(record, token); return; }

    // Capture an interrupted entrance too, so rapid previews cannot jump to a
    // fully revealed banner before starting their exit.
    const computed = window.getComputedStyle(overlay);
    overlay.style.setProperty('--event-exit-clip', computed.clipPath);
    overlay.style.setProperty('--event-exit-opacity', computed.opacity);
    overlay.style.setProperty('--event-exit-transform', computed.transform);
    overlay.classList.remove('is-playing'); overlay.classList.add('is-exiting');
    record.onExit = (event) => {
      if (event.target === overlay && event.animationName === 'score-exit') finishExit(record, token);
    };
    overlay.addEventListener('animationend', record.onExit);
    // Covers a detached host, suspended animation, or a preference change that
    // removes the CSS animation before animationend can fire.
    record.exitTimer = window.setTimeout(() => finishExit(record, token), EXIT_MS + 80);
  }

  function clear() {
    queue = []; currentGameId = null; cancelGap();
    if (active) exitCurrent(); else resetOverlay();
  }

  function clearDemo() {
    queue = queue.filter((item) => !item.demo);
    if (active?.item.demo) exitCurrent();
  }

  function buildContent(record) {
    const { event, game, demo } = record.item;
    const team = [game.away, game.home, ...(game.entries || []).flatMap(entry=>[entry.team,entry.athlete,entry])].find((candidate) => candidate?.id === event.teamId);
    const player = playerFor(event);
    const color = team ? teamColor(team, team.id === game.away?.id ? 'away' : 'home') : '#425349';
    const flagColor = {'red-flag':'#c82232','yellow-flag':'#caab12','safety-car':'#a88e18','virtual-safety-car':'#a88e18','green-flag':'#287647','checkered-flag':'#303630'}[event.kind];
    overlay.style.setProperty('--event-color', flagColor || color);
    overlay.dataset.kind = cleanText(event.kind, 32);
    overlay.dataset.player = String(Boolean(player));
    if (demo) overlay.dataset.demo = 'true'; else delete overlay.dataset.demo;

    const content = document.createElement('div'); content.className = 'score-animation-content';
    const art = document.createElement('div'); art.className = 'score-animation-art'; art.setAttribute('aria-hidden', 'true');
    const fallback = document.createElement('span'); fallback.className = 'score-animation-crest-fallback'; fallback.textContent = team?.abbreviation || (game.leagueId || 'SPORT').toUpperCase();
    const logoPath = team && localTeamLogo(team);
    if (logoPath) {
      const logo = document.createElement('img'); logo.src = logoPath; logo.alt = ''; logo.className = 'score-animation-logo';
      fallback.hidden = true;
      logo.addEventListener('error', () => { logo.hidden = true; fallback.hidden = false; }, { once: true });
      art.append(logo);
    }
    art.append(fallback);
    if (player?.headshot) {
      const photo = document.createElement('img'); photo.className = 'score-animation-player-photo';
      photo.alt = ''; photo.hidden = true; photo.decoding = 'async'; photo.referrerPolicy = 'no-referrer';
      art.dataset.portrait = 'loading';
      photo.addEventListener('load', () => {
        if (active !== record || record.phase === 'exiting') return;
        photo.hidden = false; art.dataset.portrait = 'ready';
      }, { once: true });
      photo.addEventListener('error', () => { photo.hidden = true; art.dataset.portrait = 'fallback'; }, { once: true });
      photo.src = player.headshot; art.append(photo);
    }

    const text = document.createElement('div'); text.className = 'score-animation-copy';
    const meta = document.createElement('div'); meta.className = 'score-animation-meta';
    if (demo) {
      const badge = document.createElement('span'); badge.className = 'score-animation-demo-label'; badge.textContent = 'DEMO'; meta.append(badge);
    }
    const detail = document.createElement('span'); detail.className = 'score-animation-detail'; detail.textContent = eventDetail(event, team); meta.append(detail);
    const title = document.createElement('strong'); title.className = 'score-animation-title'; title.textContent = cleanText(event.title, 64) || 'SCORE UPDATE';
    if (title.textContent.length > 17) title.classList.add('score-animation-title--long');
    const name = document.createElement('span'); name.className = player ? 'score-animation-player-name' : 'score-animation-team-name';
    name.textContent = player?.name || team?.name || team?.abbreviation || (game.leagueId || 'SPORT').toUpperCase();
    text.append(meta, title, name); content.append(art, text);
    return content;
  }

  function playNext() {
    if (active) return;
    cancelGap();
    queue = queue.filter((item) => Date.now() - item.receivedAt < QUEUE_MAX_AGE_MS && item.game.id === currentGameId);
    const item = queue.shift(); if (!item) return;
    const record = { item, token: ++generation, phase: 'visible', holdTimer: null, exitTimer: null, exitToken: null, onExit: null };
    active = record;
    overlay.replaceChildren(buildContent(record)); overlay.hidden = false; overlay.dataset.state = 'visible';
    overlay.classList.remove('is-playing', 'is-exiting');
    // A fresh notice gets one entrance; refreshing scores does not replay it.
    void overlay.offsetWidth; overlay.classList.add('is-playing');
    record.holdTimer = window.setTimeout(() => {
      if (active === record && record.phase === 'visible') exitCurrent();
    }, item.event.kind === 'touchdown' ? 3000 : 2500);
  }

  function setContext(game) {
    if (currentGameId !== null && currentGameId !== game.id) clear();
    currentGameId = game.id;
  }

  return {
    attach, clear, clearDemo,
    demo(event, game) {
      if (!event || !game?.id) return;
      setContext(game);
      queue = queue.filter((item) => !item.demo);
      // A demo cannot interrupt an actual play announcement. Repeated preview
      // clicks retain only the latest demo, after any pending live notices.
      queue.push({ event, game, receivedAt: Date.now(), demo: true });
      if (active?.item.demo) exitCurrent();
      attach(host.dataset.animationOrientation); playNext();
    },
    enqueue(events, game) {
      if (!Array.isArray(events) || !events.length || !game?.id) return;
      setContext(game);
      queue = queue.filter((item) => !item.demo);
      for (const event of events) if (event && (!event.gameId || event.gameId === game.id)) queue.push({ event, game, receivedAt: Date.now(), demo: false });
      queue = queue.slice(-4);
      if (active?.item.demo) exitCurrent();
      attach(host.dataset.animationOrientation); playNext();
    },
  };
}
