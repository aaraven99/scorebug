import { normalizeRacingRows } from './preferences-model.js';
import { sportFor } from './sports.js';

/** Artwork dimensions, excluding the optional source-status badge. */
export const SCOREBUG_DIMENSIONS = Object.freeze({
  horizontal: Object.freeze({ width: 600, height: 138, statusHeight: 24 }),
  vertical: Object.freeze({ width: 160, height: 290, statusHeight: 19 }),
});

/**
 * Racing rows keep a fixed readable size as the selected classification grows.
 * Reserve the requested height even when a feed has not supplied every driver;
 * a live frame must not resize or move a pinned window as entries arrive.
 */
export function scorebugDimensions(game, options = {}) {
  const vertical = options.orientation === 'vertical';
  const base = SCOREBUG_DIMENSIONS[vertical ? 'vertical' : 'horizontal'];
  if (game?.kind !== 'race' && sportFor(game) !== 'racing') return base;
  const racingRows = normalizeRacingRows(options.racingRows);
  const columns = vertical ? 1 : 2;
  const rowsPerColumn = Math.ceil(racingRows / columns);
  const rowHeight = vertical ? 24 : 28;
  const headerHeight = vertical ? 46 : 35;
  const footerHeight = vertical ? 24 : 20;
  return {
    ...base,
    height: headerHeight + footerHeight + 6 + rowsPerColumn * rowHeight,
    racingRows, columns, rowsPerColumn, rowHeight, headerHeight, footerHeight,
  };
}

/** Fit the whole scorebug when an OS or a manually resized window is shorter. */
export function fitScorebugWidth(dimensions, {availableWidth, availableHeight, maximumWidth = availableWidth} = {}) {
  const width = Number.isFinite(availableWidth) ? Math.max(0, availableWidth) : 0;
  const height = Number.isFinite(availableHeight) ? Math.max(0, availableHeight) : 0;
  const maximum = Number.isFinite(maximumWidth) ? Math.max(0, maximumWidth) : width;
  const totalHeight = dimensions?.height + (dimensions?.statusHeight || 0);
  if (!(dimensions?.width > 0) || !Number.isFinite(totalHeight) || totalHeight <= 0) return Math.min(width, maximum);
  return Math.min(width, maximum, height * dimensions.width / totalHeight);
}
