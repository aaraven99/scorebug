import { ScoreboardPoller } from './score-client.js';
import { standbyFeedKey } from './standby-model.js';

/** One confirmed scoreboard stream per league/date, shared by every matching slot. */
export function createStandbyFeedPool({ createPoller = options => new ScoreboardPoller(options), onUpdate = () => {} } = {}) {
  const feeds = new Map();
  let active = false, destroyed = false;
  const empty = () => ({ data: null, error: null, loading: true });
  return {
    setSlots(slots) {
      if (destroyed) return;
      const wanted = new Map(slots.map(slot => [standbyFeedKey(slot), slot]));
      for (const [key, entry] of feeds) if (!wanted.has(key)) { entry.poller.stop(); feeds.delete(key); }
      for (const [key, slot] of wanted) {
        if (feeds.has(key)) continue;
        const entry = { state: empty(), poller: null };
        feeds.set(key, entry);
        entry.poller = createPoller({ leagueId: slot.leagueId, date: slot.date, interval: 2000, onUpdate: state => {
          if (destroyed || !active || feeds.get(key) !== entry) return;
          entry.state = state; onUpdate(key, state);
        } });
        if (entry.poller.data) entry.state = { data: entry.poller.data, error: null, loading: true };
        if (active) entry.poller.start();
      }
    },
    snapshot(slot) { return feeds.get(standbyFeedKey(slot))?.state || empty(); },
    setActive(value) {
      if (destroyed || active === Boolean(value)) return;
      active = Boolean(value);
      for (const entry of feeds.values()) active ? entry.poller.start() : entry.poller.stop();
    },
    refresh(slot) {
      if (destroyed || !active) return;
      if (slot) feeds.get(standbyFeedKey(slot))?.poller.refresh();
      else for (const entry of feeds.values()) entry.poller.refresh();
    },
    get size() { return feeds.size; },
    get active() { return active; },
    destroy() { destroyed = true; active = false; for (const entry of feeds.values()) entry.poller.stop(); feeds.clear(); },
  };
}
