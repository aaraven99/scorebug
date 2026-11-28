import { getTeams as defaultGetTeams } from '../lib/multisport.mjs';
import { ScoreboardError } from '../lib/nfl.mjs';

export function createTeamsHandler({ getTeams = defaultGetTeams } = {}) {
  return async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.setHeader('Allow', 'GET, HEAD'); res.statusCode = 405;
      return res.end(JSON.stringify({ error: 'Use GET to read teams.', code: 'METHOD_NOT_ALLOWED' }));
    }
    try {
      const leagues = new URL(req.url, 'http://localhost').searchParams.getAll('league');
      if (leagues.length > 1) throw new ScoreboardError('Choose one league.', { statusCode: 400, code: 'INVALID_LEAGUE' });
      const data = await getTeams({ leagueId: leagues[0] });
      res.statusCode = 200;
      if (data.retryAfterMs > 0) res.setHeader('Retry-After', String(Math.ceil(data.retryAfterMs / 1000)));
      return res.end(req.method === 'HEAD' ? undefined : JSON.stringify(data));
    } catch (error) {
      const known = error instanceof ScoreboardError;
      res.statusCode = known ? error.statusCode : 502;
      const delay = Number.isFinite(error.retryAfterMs) ? error.retryAfterMs : res.statusCode === 503 ? 4000 : 0;
      if (delay) res.setHeader('Retry-After', String(Math.ceil(delay / 1000)));
      return res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ error: known ? error.message : 'Teams are temporarily unavailable.', code: known ? error.code : 'TEAMS_UNAVAILABLE', ...(delay ? { retryAfterMs: delay } : {}) }));
    }
  };
}

export default createTeamsHandler();
