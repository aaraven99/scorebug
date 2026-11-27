/** One allowlist shared by the browser, local app and server. */
export const DEFAULT_LEAGUE = 'nfl';
const league = (id, name, sport, espnPath, extra = {}) => Object.freeze({ id, name, sport, espnPath, kind: 'match', ...extra });
export const LEAGUES = Object.freeze([
  league('nfl', 'NFL', 'football', 'football/nfl'),
  league('nba', 'NBA', 'basketball', 'basketball/nba'),
  league('wnba', 'WNBA', 'basketball', 'basketball/wnba'),
  league('mlb', 'MLB', 'baseball', 'baseball/mlb'),
  league('nhl', 'NHL', 'hockey', 'hockey/nhl'),
  league('f1', 'Formula 1', 'racing', 'racing/f1', { kind: 'race', sessions: true }),
  league('epl', 'Premier League', 'soccer', 'soccer/eng.1'),
  league('ucl', 'Champions League', 'soccer', 'soccer/uefa.champions'),
  league('mls', 'MLS', 'soccer', 'soccer/usa.1'),
  league('laliga', 'LaLiga', 'soccer', 'soccer/esp.1'),
  league('bundesliga', 'Bundesliga', 'soccer', 'soccer/ger.1'),
  league('seriea', 'Serie A', 'soccer', 'soccer/ita.1'),
  league('ligue1', 'Ligue 1', 'soccer', 'soccer/fra.1'),
  league('nwsl', 'NWSL', 'soccer', 'soccer/usa.nwsl'),
  league('wsl', "Women's Super League", 'soccer', 'soccer/eng.w.1'),
  league('worldcup', 'World Cup', 'soccer', 'soccer/fifa.world'),
  league('cfb', 'College football', 'football', 'football/college-football'),
  league('cbb', "Men's college basketball", 'basketball', 'basketball/mens-college-basketball', { regulationPeriods: 2 }),
  league('wcbb', "Women's college basketball", 'basketball', 'basketball/womens-college-basketball'),
  league('nascar', 'NASCAR Cup', 'racing', 'racing/nascar-premier', { kind: 'race' }),
  league('indycar', 'IndyCar', 'racing', 'racing/irl', { kind: 'race' }),
  league('atp', 'ATP tennis', 'tennis', 'tennis/atp'),
  league('wta', 'WTA tennis', 'tennis', 'tennis/wta'),
  league('pga', 'PGA Tour', 'golf', 'golf/pga', { kind: 'leaderboard' }),
  league('lpga', 'LPGA Tour', 'golf', 'golf/lpga', { kind: 'leaderboard' }),
  league('nrl', 'NRL', 'rugby', 'rugby-league/3'),
  league('sixnations', 'Six Nations', 'rugby', 'rugby/180659'),
  league('superrugby', 'Super Rugby Pacific', 'rugby', 'rugby/242041'),
  league('ncaavb', "Women's college volleyball", 'volleyball', 'volleyball/womens-college-volleyball'),
  league('ncaamvb', "Men's college volleyball", 'volleyball', 'volleyball/mens-college-volleyball'),
]);
const byId = new Map(LEAGUES.map((entry) => [entry.id, entry]));
export function getLeague(id) { return byId.get(String(id ?? '')) || null; }
export function normalizeLeague(id) { return getLeague(id)?.id || DEFAULT_LEAGUE; }
export function sportFor(game) { return game?.sport || getLeague(game?.leagueId)?.sport || 'football'; }
export function leagueForGameId(id) {
  const prefix = typeof id === 'string' && id.includes(':') ? id.split(':')[0] : DEFAULT_LEAGUE;
  return getLeague(prefix)?.id || null;
}
export function formatPeriod(game = {}) {
  if (game.phase === 'halftime') return 'Halftime';
  if (game.phase === 'final') return 'Final';
  if (['scheduled', 'postponed', 'suspended', 'canceled', 'delayed'].includes(game.phase)) {
    return ({ scheduled: 'Scheduled', postponed: 'Postponed', suspended: 'Suspended', canceled: 'Canceled', delayed: 'Delayed' })[game.phase];
  }
  const sport = sportFor(game), period = Number(game.period) || 0;
  if (game.kind === 'race') return game.sessionName || 'Race';
  if (sport === 'golf') return period ? `Round ${period}` : 'Tournament';
  if (sport === 'baseball') {
    const half = game.situation?.half || game.inningHalf;
    return period ? `${half === 'top' ? 'Top' : half === 'bottom' ? 'Bot' : 'Inning'} ${period}` : 'Baseball';
  }
  if (sport === 'tennis' || sport === 'volleyball') return period ? `Set ${period}` : 'Match';
  if (sport === 'soccer' || sport === 'rugby') return period > 2 ? period === 3 ? 'ET 1' : period === 4 ? 'ET 2' : 'Penalties' : period ? `${period}H` : 'Match';
  const regulation = getLeague(game.leagueId)?.regulationPeriods || (sport === 'hockey' ? 3 : 4);
  const label = period > regulation ? period === regulation + 1 ? 'OT' : `${period - regulation}OT` : period ? `${sport === 'hockey' ? 'P' : regulation === 2 ? 'H' : 'Q'}${period}` : 'Live';
  return game.phase === 'intermission' ? `End ${label}` : label;
}
export function formatSituation(game = {}) {
  const sport = sportFor(game), s = game.situation || {};
  if (sport === 'football') return [game.downDistance || s.downDistance, game.fieldPosition || s.fieldPosition].filter(Boolean).join(' · ');
  if (sport === 'basketball') return [s.shotClock != null ? `${s.shotClock}s shot clock` : null, s.bonus ? 'Bonus' : null].filter(Boolean).join(' · ');
  if (sport === 'baseball') return [s.balls != null && s.strikes != null ? `${s.balls}–${s.strikes}` : null, s.outs != null ? `${s.outs} out${s.outs === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ');
  if (sport === 'hockey') return s.powerPlayTeamId ? 'Power play' : s.strength || '';
  if (sport === 'soccer' || sport === 'rugby') return s.addedTime != null ? `+${s.addedTime} min` : s.tackle != null ? `Tackle ${s.tackle}` : '';
  if (sport === 'tennis') return [s.pointScore, s.servingTeamId ? 'Serving' : null].filter(Boolean).join(' · ');
  if (sport === 'volleyball') return s.pointScore || '';
  if (sport === 'cricket') return [s.overs != null ? `${s.overs} ov` : null, s.target != null ? `Target ${s.target}` : null].filter(Boolean).join(' · ');
  if (sport === 'racing') return [game.lap != null ? `Lap ${game.lap}${game.totalLaps != null ? ` / ${game.totalLaps}` : ''}` : null, game.flag && game.flag !== 'green' ? game.flag.replace(/-/g, ' ') : null].filter(Boolean).join(' · ');
  return '';
}

/** Merge only the selected session's timing; never replace the score feed state. */
export function mergeSportDetails(game, summary, { now = Date.now() } = {}) {
  if (!game || game.kind !== 'race' || !summary || summary.gameId !== game.id || summary.leagueId !== game.leagueId || summary.race?.id !== game.id) return game;
  const race = summary.race;
  if (race.leagueId !== game.leagueId || race.sport !== game.sport) return game;
  const currentTime = Date.parse(game.startTime), timingStart = Date.parse(race.startTime);
  if (Number.isFinite(currentTime) && Number.isFinite(timingStart) && Math.abs(currentTime - timingStart) > 600000) return game;
  const fetched = Date.parse(summary.timingFetchedAt || race.timingFetchedAt || summary.fetchedAt);
  if (!Number.isFinite(fetched) || fetched > now + 60000) return game;
  const previous = Date.parse(game.timingFetchedAt);
  if (Number.isFinite(previous) && fetched < previous) return game;
  const timingStale = Boolean(summary.stale || summary.timingStale || race.timingStale || game.state === 'in' && now - fetched > 45000);
  return { ...game,
    entries: Array.isArray(race.entries) && race.entries.length ? race.entries : game.entries,
    raceControl: Array.isArray(race.raceControl) ? race.raceControl : [], flag: race.flag || null,
    lap: Number.isInteger(race.lap) && race.lap > 0 && race.lap <= 1000 ? race.lap : game.lap,
    totalLaps: Number.isInteger(race.totalLaps) && race.totalLaps > 0 && race.totalLaps <= 1000 ? race.totalLaps : game.totalLaps,
    ...(race.fastestLap && typeof race.fastestLap === 'object' ? { fastestLap: race.fastestLap } : {}),
    timingFetchedAt: new Date(fetched).toISOString(), timingStale,
    openF1SessionKey: race.openF1SessionKey || null, coverage: summary.coverage || race.coverage || game.coverage,
  };
}
