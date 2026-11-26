import { getGameDetails, GameDetailsError } from '../lib/details.mjs';

/** On-demand details for a hovered game; independent of the small score feed. */
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
    const ids = new URL(req.url, 'http://localhost').searchParams.getAll('id');
    if (ids.length !== 1) throw new GameDetailsError('Provide one numeric NFL game ID.', { statusCode: 400, code: 'INVALID_GAME_ID' });
    const data = await getGameDetails({ gameId: ids[0] });
    res.statusCode = 200;
    res.end(req.method === 'HEAD' ? undefined : JSON.stringify(data));
  } catch (error) {
    const known = error instanceof GameDetailsError;
    res.statusCode = known ? error.statusCode : 502;
    if (res.statusCode === 503) res.setHeader('Retry-After', '15');
    res.end(req.method === 'HEAD' ? undefined : JSON.stringify({
      error: known ? error.message : 'Game details are temporarily unavailable.',
      code: known ? error.code : 'DETAILS_UNAVAILABLE',
    }));
  }
}
