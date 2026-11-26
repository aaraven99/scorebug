import { localTeamLogo } from './team-assets.js';
import { teamColor } from './scorebug.js';

/** Brief, bounded announcements over the team row; the clock stays visible. */
export function createScoreAnimations(host) {
  const overlay = document.createElement('div');
  overlay.className = 'score-animation';
  overlay.setAttribute('role', 'status'); overlay.setAttribute('aria-live', 'polite');
  overlay.setAttribute('aria-atomic', 'true'); overlay.hidden = true;
  let queue = [], timer, activeItem = null, currentGameId = null, generation = 0;
  function attach(orientation = 'horizontal') {
    host.classList.add('score-animation-host');
    host.dataset.animationOrientation = orientation;
    if (overlay.parentElement !== host) host.append(overlay);
  }
  function stopCurrent() {
    clearTimeout(timer); generation++; activeItem = null;
    overlay.hidden = true; overlay.replaceChildren();
    overlay.classList.remove('is-playing');
    delete overlay.dataset.kind; delete overlay.dataset.demo;
  }
  function clear() {
    queue = []; currentGameId = null; stopCurrent();
  }
  function clearDemo() {
    queue = queue.filter((item) => !item.demo);
    if (activeItem?.demo) { stopCurrent(); playNext(); }
  }
  function playNext() {
    if (activeItem) return;
    queue = queue.filter((item) => Date.now() - item.receivedAt < 20000);
    const item = queue.shift(); if (!item) return;
    const { event, game } = item;
    if (game.id !== currentGameId) return playNext();
    activeItem = item;
    const startedGeneration = generation;
    const team = [game.away, game.home].find((candidate) => candidate.id === event.teamId);
    const color = team ? teamColor(team, team.id === game.away.id ? 'away' : 'home') : '#425349';
    overlay.style.setProperty('--event-color', color);
    overlay.dataset.kind = event.kind;
    if (item.demo) overlay.dataset.demo = 'true'; else delete overlay.dataset.demo;
    const content = document.createElement('div'); content.className = 'score-animation-content';
    const logoPath = team && localTeamLogo(team);
    if (logoPath) {
      const logo = document.createElement('img'); logo.src = logoPath; logo.alt = ''; logo.className = 'score-animation-logo'; content.append(logo);
    }
    const text = document.createElement('div'); text.className = 'score-animation-copy';
    if (item.demo) {
      const badge = document.createElement('span'); badge.className = 'score-animation-demo-label'; badge.textContent = 'DEMO'; text.append(badge);
    }
    const title = document.createElement('strong'); title.textContent = event.title;
    const detail = document.createElement('span');
    detail.textContent = [team?.abbreviation, event.kind === 'big-play' && Number.isFinite(event.yardsGained) ? `${event.yardsGained} YARDS` : event.points > 0 ? `+${event.points}` : 'TURNOVER'].filter(Boolean).join(' · ');
    text.append(title, detail); content.append(text);
    overlay.replaceChildren(content); overlay.hidden = false;
    // Restart the entrance for consecutive events without rebuilding the SVG.
    overlay.classList.remove('is-playing'); void overlay.offsetWidth; overlay.classList.add('is-playing');
    timer = setTimeout(() => {
      if (startedGeneration !== generation) return;
      overlay.hidden = true; activeItem = null;
      timer = setTimeout(() => { if (startedGeneration === generation) playNext(); }, 150);
    }, event.kind === 'touchdown' ? 3000 : 2500);
  }
  return {
    attach, clear, clearDemo,
    demo(event, game) {
      if (currentGameId && currentGameId !== game.id) clear();
      currentGameId = game.id;
      queue = queue.filter((item) => !item.demo);
      // This deliberate preview never enters the live event tracker or changes
      // its deduplication history. Each click replaces the previous preview.
      stopCurrent();
      queue.unshift({ event, game, receivedAt: Date.now(), demo: true });
      attach(host.dataset.animationOrientation); playNext();
    },
    enqueue(events, game) {
      if (!events.length) return;
      if (currentGameId && currentGameId !== game.id) clear();
      currentGameId = game.id;
      // Real updates take priority over demos; queued real notices keep their
      // normal ordering, and an old demo timer cannot hide the new notice.
      queue = queue.filter((item) => !item.demo);
      if (activeItem?.demo) stopCurrent();
      for (const event of events) queue.push({ event, game, receivedAt: Date.now(), demo: false });
      queue = queue.slice(-4);
      attach(host.dataset.animationOrientation); playNext();
    }
  };
}
