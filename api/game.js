import { GameDetailsError } from '../lib/details.mjs';
import { ScoreboardError } from '../lib/nfl.mjs';
import { getGameDetails } from '../lib/multisport.mjs';

/** The selected game's stats and play evidence, independent of the score feed. */
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.setHeader('Allow', 'GET, HEAD');
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'Use GET to read game details.', code: 'METHOD_NOT_ALLOWED' }));
  }
  try {
    const params = new URL(req.url, 'http://localhost').searchParams;
    const ids = params.getAll('id'), leagues = params.getAll('league'), dates = params.getAll('date');
    if (ids.length !== 1) throw new GameDetailsError('Provide one game ID.', { statusCode: 400, code: 'INVALID_GAME_ID' });
    if (leagues.length > 1) throw new GameDetailsError('Choose one league.', { statusCode: 400, code: 'INVALID_LEAGUE' });
    if (dates.length > 1) throw new GameDetailsError('Provide only one date.', { statusCode: 400, code: 'INVALID_DATE' });
    const data = await getGameDetails({ gameId: ids[0], leagueId: leagues[0], date: dates[0] });
    res.statusCode = 200;
    if (data.retryAfterMs > 0) res.setHeader('Retry-After', String(Math.ceil(data.retryAfterMs / 1000)));
    res.end(req.method === 'HEAD' ? undefined : JSON.stringify(data));
  } catch (error) {
    const known = error instanceof GameDetailsError || error instanceof ScoreboardError;
    res.statusCode = known ? error.statusCode : 502;
    const retry = known && Number.isFinite(error.retryAfterMs) ? Math.max(0, error.retryAfterMs) : res.statusCode === 503 ? 4000 : 0;
    if (retry > 0) res.setHeader('Retry-After', String(Math.ceil(retry / 1000)));
    res.end(req.method === 'HEAD' ? undefined : JSON.stringify({
      error: known ? error.message : 'Game details are temporarily unavailable.',
      code: known ? error.code : 'DETAILS_UNAVAILABLE',
      ...(retry > 0 ? { retryAfterMs: retry } : {}),
    }));
  }
}
