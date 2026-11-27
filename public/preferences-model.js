const ID = /^(?:\d{1,15}|(?:thescore|fox)-\d{1,15}|[a-z][a-z0-9.-]{0,39}:[a-zA-Z0-9_-]{1,48})$/;
const LEAGUE = /^[a-z][a-z0-9.-]{0,39}$/;
const STYLE = /^[a-z][a-z0-9-]{0,79}$/;
const shortText = (value, length = 100) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, length) : '';
export const DEFAULT_LEAGUE_ID = 'nfl';
export function validLeagueId(value) { return typeof value === 'string' && LEAGUE.test(value); }
export function supportedGameId(value) { return typeof value === 'string' && ID.test(value); }
export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{8}$/.test(value)) return false;
  const iso = `${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0,10) === iso;
}
export function leagueOfId(value) { return typeof value === 'string' && value.includes(':') ? value.slice(0, value.indexOf(':')) : 'nfl'; }
export function gameLeague(game) { return validLeagueId(game?.leagueId) ? game.leagueId : leagueOfId(game?.id); }
export function safeLogo(value) {
  if (typeof value !== 'string') return null;
  if (/^\/(?:assets\/teams|logos(?:\/[a-z0-9-]+)?)\/[a-z0-9-]+\.(?:svg|png)$/i.test(value)) return value;
  try { const u = new URL(value); return u.protocol === 'https:' && u.hostname === 'a.espncdn.com' && !u.username && !u.password && !u.port ? u.href : null; } catch { return null; }
}
export function normalizeFavorites(value) {
  const result = [], seen = new Set();
  for (const item of Array.isArray(value) ? value : []) {
    if (!item || !validLeagueId(item.leagueId) || typeof item.teamId !== 'string' || !/^(?:\d{1,15}|[a-z][a-z0-9.-]{0,39}:[a-zA-Z0-9_-]{1,48})$/.test(item.teamId)) continue;
    if (item.leagueId === 'nfl' ? !/^\d{1,15}$/.test(item.teamId) : !item.teamId.startsWith(`${item.leagueId}:`)) continue;
    const key = `${item.leagueId}/${item.teamId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ leagueId: item.leagueId, teamId: item.teamId, name: shortText(item.name), abbreviation: shortText(item.abbreviation, 16), logo: safeLogo(item.logo), color: /^#[\da-f]{6}$/i.test(item.color || '') ? item.color : null });
    if (result.length >= 64) break;
  }
  return result;
}
export function normalizePreferencePatch(patch = {}) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return {};
  const result = {};
  if (Object.hasOwn(patch, 'leagueId') && validLeagueId(patch.leagueId)) result.leagueId = patch.leagueId;
  if (Object.hasOwn(patch, 'styleId') && typeof patch.styleId === 'string' && STYLE.test(patch.styleId)) result.styleId = patch.styleId;
  if (Object.hasOwn(patch, 'favorites')) result.favorites = normalizeFavorites(patch.favorites);
  if (Object.hasOwn(patch, 'gameId')) result.gameId = supportedGameId(patch.gameId) ? patch.gameId : null;
  if (Object.hasOwn(patch, 'date')) result.date = validDate(patch.date) ? patch.date : null;
  if (Object.hasOwn(patch, 'team')) result.team = typeof patch.team === 'string' && /^[A-Z]{2,4}$/.test(patch.team) ? patch.team : null;
  if (typeof patch.scale === 'number' && Number.isFinite(patch.scale)) result.scale = Math.min(1.8, Math.max(0.65, patch.scale));
  if (['horizontal', 'vertical'].includes(patch.orientation)) result.orientation = patch.orientation;
  if (Object.hasOwn(patch,'anchor') && patch.anchor === null) result.anchor = null;
  if (/^(?:top|bottom)-(?:left|center|right)$|^middle-(?:left|right)$|^center$/.test(patch.anchor || '')) result.anchor = patch.anchor;
  for (const key of ['snapEnabled', 'locked']) if (typeof patch[key] === 'boolean') result[key] = patch[key];
  if (['top', 'bottom'].includes(patch.contentAlignment)) result.contentAlignment = patch.contentAlignment;
  return result;
}
export function matchesFavorite(game, favorites) {
  const leagueId = gameLeague(game);
  const ids = new Set([game?.away?.id, game?.home?.id, ...(Array.isArray(game?.entries) ? game.entries.flatMap(e => [e.team?.id, e.athlete?.id, e.id]) : [])].filter(Boolean).map(String));
  return normalizeFavorites(favorites).some(item => item.leagueId === leagueId && ids.has(item.teamId));
}
