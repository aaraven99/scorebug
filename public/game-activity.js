import { GameDetailsPoller } from './game-details-client.js';
import { createGameEventTracker } from './game-events.js';

/** Track the visible game independently of whether its stats panel is open. */
export function createGameActivity({ onEvents, onReset = () => {} } = {}) {
  const tracker = createGameEventTracker();
  let game = null, contextKey = 'current', summary = null, key = null, active = false;
  let primaryAt = null, waitingForPrimary = true, summaryError = null;
  function resetForPrimary() {
    if (!waitingForPrimary) { tracker.reset(); onReset(); }
    waitingForPrimary = true;
  }
  function update() {
    if (!active || !game) return;
    if (primaryAt === null || Date.now() - primaryAt > 45000) { resetForPrimary(); return; }
    if (waitingForPrimary) return;
    const events = tracker.update({ game, details: summary?.stale ? null : summary, contextKey, now: Date.now() });
    if (events.length) onEvents?.(events, game);
  }
  const poller = new GameDetailsPoller({ onUpdate: (state) => {
    summary = state.data?.gameId === game?.id ? state.data : null;
    summaryError = state.error;
    // Failed summary polls never invent plays. Confirmed scoreboard deltas can
    // still use the tracker's delayed, generic scoring fallback.
    if (!state.loading) update();
  } });
  return {
    setGame(next, context = 'current', fetchedAt = null, feed = {}) {
      const sourceContext = `${context}:${feed.sourceId || 'espn-site'}`;
      const nextKey = next ? `${sourceContext}:${next.id}` : null;
      const now = Date.now(), stamp = Date.parse(fetchedAt || '');
      // Summary polls must never keep an old primary scoreboard baseline alive.
      if (primaryAt !== null && now - primaryAt > 45000) resetForPrimary();
      game = next; contextKey = sourceContext;
      const unavailable = feed.stale === true || feed.error === true;
      if (unavailable) { primaryAt = null; resetForPrimary(); }
      else if (Number.isFinite(stamp)) primaryAt = stamp;
      if (nextKey !== key) {
        key = nextKey; summary = null; summaryError = null; tracker.reset(); onReset();
        // Independent feeds have their own event IDs. Only request an ESPN
        // summary when an exact matchup supplied a known ESPN game identity.
        poller.setGame(next?.detailsGameId === null ? null : next?.detailsGameId || next?.id || null);
      }
      if (!unavailable && Number.isFinite(stamp) && now - stamp <= 45000) waitingForPrimary = false;
      update();
    },
    start() {
      if (active) return;
      active = true; game = null; key = null; summary = null; summaryError = null; primaryAt = null; waitingForPrimary = true;
      tracker.reset(); poller.setGame(null); poller.start();
      // The next fresh scoreboard update establishes the baseline after resume.
    },
    stop() { active = false; poller.stop(); tracker.reset(); onReset(); },
    refresh() { return poller.refresh(); },
    getDetails() {
      // Demo portraits may reuse this game's current summary, but never a
      // previous matchup, a failed request, or a snapshot retained after sleep.
      const now = Date.now(), summaryAt = Date.parse(summary?.fetchedAt || '');
      return active && !waitingForPrimary && !summaryError && !summary?.stale && game && summary?.gameId === game.id
        && primaryAt !== null && now - primaryAt <= 45000
        && Number.isFinite(summaryAt) && now - summaryAt <= 45000 ? summary : null;
    }
  };
}
