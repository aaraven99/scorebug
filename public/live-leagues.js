import { LEAGUES } from './sports.js';
import { activeGames, feedIsStale } from './score-client.js';
import { gameLeague } from './preferences-model.js';

const validFeed = (data, leagueId) => Boolean(data && data.leagueId === leagueId
  && typeof data.fetchedAt === 'string' && Number.isFinite(Date.parse(data.fetchedAt))
  && Array.isArray(data.games) && data.games.every(game => gameLeague(game) === leagueId));

/** Fetch the other league scoreboards on demand, with a small bounded pool. */
export function createAllLeagueLiveFeed({
  fetcher = (...args) => globalThis.fetch(...args),
  onUpdate = () => {},
  concurrency = 4,
  refreshInterval = 45000,
  requestTimeout = 12000,
  baseURL,
} = {}) {
  let states = new Map(), controllers = new Set(), timer = null, generation = 0;
  let running = false, inFlight = false, refreshQueued = false;

  function emit() { onUpdate(result()); }

  async function request(leagueId, currentGeneration) {
    const controller = new AbortController();
    controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), requestTimeout);
    const previous = states.get(leagueId);
    states.set(leagueId, { data: previous?.data || null, error: null, loading: true });
    emit();
    try {
      const url = new URL('/api/scoreboard', baseURL || globalThis.document?.baseURI || globalThis.location?.origin || 'http://localhost/');
      if (leagueId !== 'nfl') url.searchParams.set('league', leagueId);
      const response = await fetcher(url, { cache: 'no-store', signal: controller.signal, headers: { Accept: 'application/json' } });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message || data?.message || 'Scoreboard unavailable.');
      if (!validFeed(data, leagueId)) throw new Error('Unexpected scoreboard response.');
      if (!running || currentGeneration !== generation) return;
      states.set(leagueId, { data, error: null, loading: false });
    } catch (error) {
      if (!running || currentGeneration !== generation) return;
      states.set(leagueId, { data: previous?.data || null, error, loading: false });
    } finally {
      clearTimeout(timeout);
      controllers.delete(controller);
      if (running && currentGeneration === generation) emit();
    }
  }

  async function refresh() {
    if (!running) return;
    if (inFlight) { refreshQueued = true; return; }
    inFlight = true;
    const currentGeneration = generation;
    const queue = [...states.keys()];
    let cursor = 0;
    const worker = async () => {
      while (running && currentGeneration === generation) {
        const id = queue[cursor++];
        if (!id) return;
        await request(id, currentGeneration);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
    if (currentGeneration !== generation) return;
    inFlight = false;
    if (!running) return;
    if (refreshQueued) { refreshQueued = false; void refresh(); return; }
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void refresh(); }, refreshInterval);
    timer?.unref?.();
  }

  function start(excludedLeagueId) {
    const ids = LEAGUES.map(league => league.id).filter(id => id !== excludedLeagueId);
    if (running && JSON.stringify([...states.keys()]) === JSON.stringify(ids)) return;
    stop();
    running = true;
    generation++;
    states = new Map(ids.map(id => [id, { data: null, error: null, loading: true }]));
    emit();
    void refresh();
  }

  function stop() {
    running = false;
    generation++;
    clearTimeout(timer); timer = null;
    for (const controller of controllers) controller.abort();
    controllers.clear();
    inFlight = false; refreshQueued = false;
    states.clear();
  }

  function result(favoriteLeagueIds = []) {
    const favoriteIds = new Set(favoriteLeagueIds);
    const leagueOrder = new Map(LEAGUES.map((league, index) => [league.id, index]));
    const games = [];
    let loading = false, unavailable = 0, checked = 0;
    for (const [leagueId, state] of states) {
      if (state.loading) loading = true;
      if (state.error) unavailable++;
      if (state.data) checked++;
      for (const game of activeGames(state.data?.games)) games.push({
        ...game,
        favoriteFeedDelayed: Boolean(state.error || feedIsStale(state.data)),
        favoriteLeague: favoriteIds.has(leagueId),
      });
    }
    games.sort((a, b) => Number(b.favoriteLeague) - Number(a.favoriteLeague)
      || (leagueOrder.get(gameLeague(a)) ?? Infinity) - (leagueOrder.get(gameLeague(b)) ?? Infinity));
    return { games, loading, unavailable, checked, total: states.size, running };
  }

  return { start, stop, refresh: () => { refreshQueued = true; if (!inFlight) { refreshQueued = false; void refresh(); } }, result };
}
