// The bundled originals and their sources are documented in docs/ASSETS.md.
const NFL_TEAMS = new Set([
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE',
  'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC',
  'LAC', 'LAR', 'LV', 'MIA', 'MIN', 'NE', 'NO', 'NYG',
  'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WSH',
]);
const ALIASES = new Map([['LA', 'LAR'], ['JAC', 'JAX'], ['WAS', 'WSH']]);

/** Prefer bundled team artwork so live scorebugs do not depend on image-CDN access. */
export function localTeamLogo(team) {
  const raw = String(team?.abbreviation || '').trim().toUpperCase();
  const abbreviation = ALIASES.get(raw) || raw;
  if (NFL_TEAMS.has(abbreviation)) return `/logos/${abbreviation.toLowerCase()}.png`;
  try {
    const url = new URL(String(team?.logo || ''));
    if (url.protocol === 'https:' && !url.username && !url.password && /(^|\.)espncdn\.com$/i.test(url.hostname)) {
      return url.href;
    }
  } catch {
    // Unknown teams without a valid feed logo use the renderer's text fallback.
  }
  return null;
}
