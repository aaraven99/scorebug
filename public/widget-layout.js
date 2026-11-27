import { SCOREBUG_DIMENSIONS } from './scorebug.js';

/** Browser content size, including the hover toolbar and a possible feed badge. */
export function widgetPopupSize({ orientation = 'horizontal', scale = 1 } = {}) {
  const side = orientation === 'vertical';
  const factor = Number.isFinite(scale) ? Math.max(.65, Math.min(1.8, scale)) : 1;
  const dimensions = SCOREBUG_DIMENSIONS[side ? 'vertical' : 'horizontal'];
  const width = Math.round((side ? 160 : 520) * factor);
  const artworkHeight = (width - 16) * (dimensions.height + dimensions.statusHeight) / dimensions.width;
  return { width, height: Math.ceil(artworkHeight) + (side ? 64 : 39) };
}
