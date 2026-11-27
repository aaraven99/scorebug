import { ScoreboardError } from '../lib/nfl.mjs';
import { getScoreboard } from '../lib/multisport.mjs';

/** Node/Vercel function; also used unchanged by the local development server. */
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    res.statusCode = 405;
    res.end(JSON.stringify({ error: 'Use GET to read live scores.', code: 'METHOD_NOT_ALLOWED' }));
    return;
  }
  try {
    const url = new URL(req.url, 'http://localhost');
    const dates = url.searchParams.getAll('date');
    if (dates.length > 1) throw new ScoreboardError('Provide only one date.', { statusCode: 400, code: 'INVALID_DATE' });
    const leagues = url.searchParams.getAll('league');
    if (leagues.length > 1) throw new ScoreboardError('Choose one league.', { statusCode: 400, code: 'INVALID_LEAGUE' });
    const data = await getScoreboard({ date: dates[0], leagueId: leagues[0] });
    res.statusCode = 200;
    if (data.retryAfterMs > 0) res.setHeader('Retry-After', String(Math.ceil(data.retryAfterMs / 1000)));
    res.end(req.method === 'HEAD' ? undefined : JSON.stringify(data));
  } catch (error) {
    const known = error instanceof ScoreboardError;
    res.statusCode = known ? error.statusCode : 502;
    const retry = known && Number.isFinite(error.retryAfterMs) ? Math.max(0, error.retryAfterMs) : res.statusCode === 503 ? 4000 : 0;
    if (retry > 0) res.setHeader('Retry-After', String(Math.ceil(retry / 1000)));
    res.end(req.method === 'HEAD' ? undefined : JSON.stringify({
      error: known ? error.message : 'Live scores are temporarily unavailable. Please try again shortly.',
      code: known ? error.code : 'UPSTREAM_UNAVAILABLE',
      ...(retry > 0 ? { retryAfterMs: retry } : {}),
    }));
  }
}
