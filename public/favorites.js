import { ScoreboardPoller, activeGames, feedIsStale } from './score-client.js';
import { normalizeFavorites, matchesFavorite, gameLeague } from './preferences-model.js';

/** Only followed leagues get background requests. The selected feed is reused. */
export function createFavoritesFeed({ onUpdate = () => {} } = {}) {
  const feeds = new Map();
  let preferences = { leagueId: 'nfl', favorites: [] }, current = null, running = false;
  function sync(next = preferences, snapshot = current) {
    preferences = next; current = snapshot;
    const leagues = new Set(normalizeFavorites(preferences.favorites).map(favorite => favorite.leagueId));
    leagues.delete(preferences.leagueId);
    for (const [id, value] of feeds) if (!leagues.has(id)) { value.poller.stop(); feeds.delete(id); }
    for (const id of leagues) if (!feeds.has(id)) {
      const value = { state: {data:null,error:null,loading:true}, poller:null };
      value.poller = new ScoreboardPoller({leagueId:id, interval:5000, onUpdate:state => { value.state = state; onUpdate(); }});
      feeds.set(id,value);
      if (running) value.poller.start();
    }
  }
  function result() {
    const states = [current, ...[...feeds.values()].map(value => value.state)].filter(Boolean);
    const seen = new Set(), games = [];
    let unavailable = false, pending = false;
    for (const state of states) {
      if (state.error || (state.data && feedIsStale(state.data))) unavailable = true;
      if (!state.data && state.loading) pending = true;
      for (const game of activeGames(state.data?.games)) {
        const key = `${gameLeague(game)}/${game.id}`;
        if (seen.has(key) || !matchesFavorite(game, preferences.favorites)) continue;
        seen.add(key); games.push({...game, favoriteFeedDelayed:Boolean(state.error || feedIsStale(state.data))});
      }
    }
    return {games,unavailable,pending};
  }
  return {sync, result,
    start(){running=true;for(const feed of feeds.values())feed.poller.start();},
    stop(){running=false;for(const feed of feeds.values())feed.poller.stop();},
    refresh(){for(const feed of feeds.values())feed.poller.refresh();}
  };
}
