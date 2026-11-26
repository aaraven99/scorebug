import { GameDetailsPoller } from './game-details-client.js';
import { createGameEventTracker } from './game-events.js';

/** Track the visible game independently of whether its stats panel is open. */
export function createGameActivity({ onEvents, onReset = () => {} } = {}) {
  const tracker = createGameEventTracker();
  let game = null, contextKey = 'current', summary = null, key = null, active = false;
  let primaryAt = null, waitingForPrimary = true;
  function resetForPrimary() {
    if (!waitingForPrimary) { tracker.reset(); onReset(); }
    waitingForPrimary = true;
  }
  function update() {
    if (!active || !game) return;
    if (primaryAt === null || Date.now() - primaryAt > 45000) { resetForPrimary(); return; }
    if (waitingForPrimary) return;
    const events = tracker.update({ game, details: summary, contextKey, now: Date.now() });
    if (events.length) onEvents?.(events, game);
  }
  const poller = new GameDetailsPoller({ onUpdate: (state) => {
    summary = state.data?.gameId === game?.id ? state.data : null;
    // Failed summary polls never invent plays. Confirmed scoreboard deltas can
    // still use the tracker's delayed, generic scoring fallback.
    if (!state.loading) update();
  } });
  return {
    setGame(next, context = 'current', fetchedAt = null) {
      const nextKey = next ? `${context}:${next.id}` : null;
      const now = Date.now(), stamp = Date.parse(fetchedAt || '');
      // Summary polls must never keep an old primary scoreboard baseline alive.
      if (primaryAt !== null && now - primaryAt > 45000) resetForPrimary();
      game = next; contextKey = context;
      if (Number.isFinite(stamp)) primaryAt = stamp;
      if (nextKey !== key) {
        key = nextKey; summary = null; tracker.reset(); onReset();
        poller.setGame(next?.id || null);
      }
      if (Number.isFinite(stamp) && now - stamp <= 45000) waitingForPrimary = false;
      update();
    },
    start() {
      if (active) return;
      active = true; game = null; key = null; summary = null; primaryAt = null; waitingForPrimary = true;
      tracker.reset(); poller.setGame(null); poller.start();
      // The next fresh scoreboard update establishes the baseline after resume.
    },
    stop() { active = false; poller.stop(); tracker.reset(); onReset(); },
    refresh() { poller.refresh(); }
  };
}
