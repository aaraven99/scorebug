// The bundled originals and their sources are documented in docs/ASSETS.md.
const NFL_TEAMS = new Set([
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE',
  'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC',
  'LAC', 'LAR', 'LV', 'MIA', 'MIN', 'NE', 'NO', 'NYG',
  'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WSH',
]);
const ALIASES = new Map([['LA', 'LAR'], ['JAC', 'JAX'], ['WAS', 'WSH']]);

// Measured nontransparent artwork bounds, [left, top, right, bottom], in each
// unmodified source image. Fit the visible mark, not its square CDN padding.
const LOGO_ARTWORK = {
  ARI: { size: [500, 500], bounds: [20, 32, 481, 468] },
  ATL: { size: [500, 500], bounds: [20, 32, 480, 468] },
  BAL: { size: [500, 500], bounds: [20, 139, 481, 361] },
  BUF: { size: [500, 500], bounds: [20, 96, 481, 404] },
  CAR: { size: [500, 500], bounds: [19, 126, 481, 374] },
  CHI: { size: [4096, 4096], bounds: [164, 792, 3932, 3304] },
  CIN: { size: [500, 500], bounds: [20, 88, 480, 412] },
  CLE: { size: [500, 500], bounds: [20, 75, 480, 431] },
  DAL: { size: [500, 500], bounds: [20, 32, 480, 468] },
  DEN: { size: [500, 500], bounds: [20, 113, 480, 387] },
  DET: { size: [500, 500], bounds: [20, 75, 481, 425] },
  GB: { size: [500, 500], bounds: [20, 100, 481, 400] },
  HOU: { size: [500, 500], bounds: [20, 41, 481, 459] },
  IND: { size: [500, 500], bounds: [32, 19, 468, 481] },
  JAX: { size: [500, 500], bounds: [19, 79, 481, 421] },
  KC: { size: [500, 500], bounds: [19, 100, 480, 400] },
  LAC: { size: [500, 500], bounds: [19, 147, 481, 353] },
  LAR: { size: [2500, 1795], bounds: [2, 2, 2499, 1795] },
  LV: { size: [500, 500], bounds: [30, 17, 470, 483] },
  MIA: { size: [500, 500], bounds: [19, 66, 481, 434] },
  MIN: { size: [500, 500], bounds: [67, 23, 433, 477] },
  NE: { size: [500, 500], bounds: [19, 139, 481, 361] },
  NO: { size: [500, 500], bounds: [62, 20, 438, 480] },
  NYG: { size: [500, 500], bounds: [20, 71, 480, 429] },
  NYJ: { size: [4096, 4096], bounds: [164, 1455, 3932, 2641] },
  PHI: { size: [500, 500], bounds: [19, 92, 480, 408] },
  PIT: { size: [500, 500], bounds: [19, 19, 481, 481] },
  SEA: { size: [500, 500], bounds: [19, 147, 481, 353] },
  SF: { size: [500, 500], bounds: [19, 113, 481, 387] },
  TB: { size: [500, 500], bounds: [19, 45, 481, 455] },
  TEN: { size: [500, 500], bounds: [20, 20, 480, 480] },
  WSH: { size: [500, 500], bounds: [19, 122, 481, 378] },
};
const CONTRAST_OUTLINE = new Set(['NYG', 'NYJ']);

function teamAbbreviation(team) {
  const raw = String(team?.abbreviation || '').trim().toUpperCase();
  return ALIASES.get(raw) || raw;
}

/** Original image geometry and selective contour separation for team panels. */
export function teamLogoPresentation(team) {
  const abbreviation = teamAbbreviation(team);
  const artwork = LOGO_ARTWORK[abbreviation];
  return {
    size: artwork?.size || [1, 1],
    bounds: artwork?.bounds || [0, 0, 1, 1],
    outline: CONTRAST_OUTLINE.has(abbreviation),
  };
}


/** Prefer bundled team artwork so live scorebugs do not depend on image-CDN access. */
export function localTeamLogo(team) {
  const abbreviation = teamAbbreviation(team);
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
