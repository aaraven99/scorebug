import { scorebugDimensions } from './scorebug-layout.js';
import { getLeague } from './sports.js';

/** Browser content size, including the hover toolbar and a possible feed badge. */
export function widgetPopupSize(preferences = {}) {
  const { orientation = 'horizontal', scale = 1 } = preferences;
  const side = orientation === 'vertical';
  const factor = Number.isFinite(scale) ? Math.max(.65, Math.min(1.8, scale)) : 1;
  const league = getLeague(preferences.leagueId || 'nfl');
  const dimensions = scorebugDimensions({ leagueId: league?.id, sport: league?.sport, kind: league?.kind }, preferences);
  const width = Math.round((side ? 160 : 520) * factor);
  const artworkHeight = (width - 16) * (dimensions.height + dimensions.statusHeight) / dimensions.width;
  return { width, height: Math.ceil(artworkHeight) + (side ? 64 : 39) };
}
