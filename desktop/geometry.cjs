'use strict';

const ANCHORS = Object.freeze([
  'top-left', 'top-center', 'top-right',
  'middle-left', 'center', 'middle-right',
  'bottom-left', 'bottom-center', 'bottom-right'
]);

const ANCHOR_LABELS = Object.freeze({
  'top-left': 'Top left', 'top-center': 'Top center', 'top-right': 'Top right',
  'middle-left': 'Left center', center: 'Center', 'middle-right': 'Right center',
  'bottom-left': 'Bottom left', 'bottom-center': 'Bottom center', 'bottom-right': 'Bottom right'
});

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function clampBounds(bounds, workArea) {
  const width = Math.max(1, Math.min(Math.round(finite(bounds.width, 520)), workArea.width));
  const height = Math.max(1, Math.min(Math.round(finite(bounds.height, 144)), workArea.height));
  return {
    x: Math.round(Math.min(Math.max(finite(bounds.x, workArea.x), workArea.x), workArea.x + workArea.width - width)),
    y: Math.round(Math.min(Math.max(finite(bounds.y, workArea.y), workArea.y), workArea.y + workArea.height - height)),
    width,
    height
  };
}

function anchorBounds(anchor, size, workArea, margin = 16) {
  if (!ANCHORS.includes(anchor)) throw new RangeError('Unknown screen anchor');
  const width = Math.min(size.width, workArea.width);
  const height = Math.min(size.height, workArea.height);
  const edgeX = Math.min(margin, Math.max(0, (workArea.width - width) / 2));
  const edgeY = Math.min(margin, Math.max(0, (workArea.height - height) / 2));
  const xs = {
    left: workArea.x + edgeX,
    center: workArea.x + (workArea.width - width) / 2,
    right: workArea.x + workArea.width - width - edgeX
  };
  const ys = {
    // The top layout already has an 8px transparent inset. Keep the complete
    // HWND on-screen and place its visible panels near the work-area edge.
    top: workArea.y,
    middle: workArea.y + (workArea.height - height) / 2,
    bottom: workArea.y + workArea.height - height - edgeY
  };
  const [vertical, horizontal] = anchor === 'center' ? ['middle', 'center'] : anchor.split('-');
  return clampBounds({ x: xs[horizontal], y: ys[vertical], width, height }, workArea);
}

function nearestAnchor(bounds, workArea, threshold = 56, margin = 16) {
  // Snap anywhere along an edge. Requiring proximity to the exact side-center
  // point left most normal side drags floating in their old orientation.
  const distances = {
    left: Math.max(0, bounds.x - workArea.x - margin),
    right: Math.max(0, workArea.x + workArea.width - margin - bounds.x - bounds.width),
    top: Math.max(0, bounds.y - workArea.y - margin),
    bottom: Math.max(0, workArea.y + workArea.height - margin - bounds.y - bounds.height)
  };
  const horizontal = Math.min(distances.left, distances.right) <= threshold
    ? (distances.left <= distances.right ? 'left' : 'right') : null;
  const vertical = Math.min(distances.top, distances.bottom) <= threshold
    ? (distances.top <= distances.bottom ? 'top' : 'bottom') : null;
  if (vertical || horizontal) {
    const anchor = vertical ? `${vertical}-${horizontal || 'center'}` : `middle-${horizontal}`;
    return { anchor, bounds: anchorBounds(anchor, bounds, workArea, margin), distance: Math.min(...Object.values(distances)) };
  }
  const target = anchorBounds('center', bounds, workArea, margin);
  const distance = Math.hypot(target.x - bounds.x, target.y - bounds.y);
  return distance <= threshold ? { anchor: 'center', bounds: target, distance } : null;
}

function contentAlignmentForAnchor(anchor, previous = 'bottom') {
  // A free drag must not move the artwork inside the window on release.
  if (anchor === null) return previous === 'top' ? 'top' : 'bottom';
  return typeof anchor === 'string' && anchor.startsWith('top-') ? 'top' : 'bottom';
}

function widgetSize(scale = 1, orientation = 'horizontal', workArea = null) {
  const vertical = orientation === 'vertical';
  let width = Math.round((vertical ? 160 : 520) * scale);
  // Controls and the transparent margins use CSS pixels, so they must not shrink
  // with the scorebug. Reserve the feed-status badge even while it is absent.
  const ratio = vertical ? 309 / 160 : 162 / 600;
  if (workArea) {
    // A short, high-DPI work area may not fit a large vertical scorebug. Reduce
    // its width as well, instead of clipping a height whose SVG still uses the
    // original width. Electron work areas and these dimensions are both DIPs.
    const heightLimitedWidth = Math.max(17, Math.floor(16 + (workArea.height - 39) / ratio));
    width = Math.max(1, Math.min(width, Math.floor(workArea.width), heightLimitedWidth));
  }
  return { width, height: Math.ceil(Math.max(1, width - 16) * ratio) + 39 };
}

function displayForBounds(bounds, displays, fallbackId) {
  if (!displays.length) throw new RangeError('At least one display is required');
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const containing = displays.find(({ workArea: area }) => (
    centerX >= area.x && centerX < area.x + area.width &&
    centerY >= area.y && centerY < area.y + area.height
  ));
  if (containing) return containing;
  let best = displays.find((display) => String(display.id) === String(fallbackId)) || displays[0];
  let bestArea = 0;
  for (const display of displays) {
    const area = display.workArea;
    const overlap = Math.max(0, Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x)) *
      Math.max(0, Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y));
    if (overlap > bestArea) { best = display; bestArea = overlap; }
  }
  return best;
}

function containsPoint(bounds, point) {
  return Boolean(bounds && point.x >= bounds.x && point.y >= bounds.y && point.x < bounds.x + bounds.width && point.y < bounds.y + bounds.height);
}

function overlapArea(a, b) {
  return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
}

const DETAILS_SIZE = Object.freeze({ width: 320, height: 344 });
const COMPARISON_DETAILS_SIZE = Object.freeze({ width: 408, height: 450 });
const DETAILS_SEAM_OVERLAP = 1.5;

function detailsPlacement(widgetBounds, workArea, { side = 'home', orientation = 'horizontal', contentAlignment = 'bottom', size } = {}) {
  side = ['away', 'home', 'comparison'].includes(side) ? side : 'home';
  const comparison = side === 'comparison';
  size ||= comparison ? COMPARISON_DETAILS_SIZE : DETAILS_SIZE;
  orientation = orientation === 'vertical' ? 'vertical' : 'horizontal';
  const width = Math.max(1, Math.min(Math.round(finite(size.width, DETAILS_SIZE.width)), workArea.width));
  const height = Math.max(1, Math.min(Math.round(finite(size.height, DETAILS_SIZE.height)), workArea.height));
  const strip = situationPanelPolygon(widgetBounds, orientation, contentAlignment);
  const polygon = comparison ? strip : teamPanelPolygon(widgetBounds, orientation, side, contentAlignment);
  const team = polygonBounds(polygon);
  const bug = scorebugHitBounds(widgetBounds, orientation, contentAlignment);
  const factor = bug.width / (orientation === 'vertical' ? 160 : 600);
  // Downward blades join beneath the information strip so their neck never
  // covers the clock/down text. Match the visible path (not its 2px SVG margin).
  const stripBottom = strip[3][1];
  const stripLeft = strip[3][0];
  const stripRight = strip[2][0];
  const belowStatus = orientation === 'horizontal' && contentAlignment === 'top';
  // The top layout reserves a below-panel status badge through SVG x224. Its
  // downward blade uses a narrow strip segment to the right of that space.
  // Keep the reservation while fresh as well, so a delayed feed cannot move it.
  const clockSpan = orientation === 'vertical' ? [22, 135] : [228, 358];
  const comparisonSpan = clockSpan.map((x) => bug.x + x * factor);
  const downLeft = Math.max(comparison ? comparisonSpan[0] : polygon[3][0], stripLeft, belowStatus ? bug.x + 232 * factor : -Infinity);
  const downRight = Math.min(comparison ? comparisonSpan[1] : polygon[2][0], stripRight, belowStatus && side !== 'away' ? bug.x + 343 * factor : Infinity);
  // A clock expansion above a bottom-docked scoreboard clears both teams. Its
  // stem stays centered on the clock without placing a frame over the scores.
  const upEdge = comparison
    ? comparisonSpan.map((x) => [x, bug.y + (orientation === 'vertical' ? 2 : 4) * factor])
    : [polygon[0], polygon[1]];
  const downEdge = [[downLeft, stripBottom], [downRight, stripBottom]];
  const overlap = DETAILS_SEAM_OVERLAP;
  // Carry a narrow connector past the below-board controls. Add the extra
  // depth to this blade only, preserving the full existing stats-body space.
  const downNeckHeight = belowStatus ? Math.max(26 * factor + 6, widgetBounds.y + widgetBounds.height + 3 - (stripBottom - overlap)) : 0;
  const downHeight = Math.min(workArea.height, height + Math.max(0, Math.ceil(downNeckHeight + 1 - 24)));
  const limit = (value, low, high) => Math.max(low, Math.min(value, high));
  const lateralPolygon = comparison && orientation === 'horizontal'
    ? [teamPanelPolygon(widgetBounds, orientation, 'away', contentAlignment)[0], teamPanelPolygon(widgetBounds, orientation, 'home', contentAlignment)[1], strip[2], strip[3]]
    : polygon;
  const desired = (direction) => {
    if (direction === 'left' || direction === 'right') {
      const edge = direction === 'left' ? [lateralPolygon[0], lateralPolygon[3]] : [lateralPolygon[1], lateralPolygon[2]];
      const inward = direction === 'left' ? overlap : -overlap;
      const points = edge.map(([x, y]) => [x + inward, y]);
      const x = direction === 'left' ? Math.max(points[0][0], points[1][0]) - width : Math.min(points[0][0], points[1][0]);
      const y = limit(team.y + (team.height - height) / 2, workArea.y, workArea.y + workArea.height - height);
      return { direction, bounds: { x, y, width, height }, points };
    }
    const edge = direction === 'up' ? upEdge : downEdge;
    const y = edge[0][1] + (direction === 'up' ? overlap : -overlap) - (direction === 'up' ? height : 0);
    const x = limit((edge[0][0] + edge[1][0]) / 2 - width / 2, workArea.x, workArea.x + workArea.width - width);
    return { direction, bounds: { x, y, width, height: direction === 'down' ? downHeight : height }, points: edge.map(([px, py]) => [px, py + (direction === 'up' ? overlap : -overlap)]) };
  };
  const primary = comparison
    ? (team.x - workArea.x > workArea.x + workArea.width - team.x - team.width ? 'left' : 'right')
    : side === 'away' ? 'left' : 'right';
  const upSpace = upEdge[0][1] - workArea.y;
  const downSpace = workArea.y + workArea.height - stripBottom;
  const verticalDirections = upSpace >= downSpace ? ['up', 'down'] : ['down', 'up'];
  // Horizontal teams have different outer edges. If the selected team's edge
  // is against the screen, attach above/below that team rather than the rival.
  const directions = orientation === 'vertical'
    ? [primary, primary === 'left' ? 'right' : 'left', ...verticalDirections]
    : comparison ? [...verticalDirections, primary, primary === 'left' ? 'right' : 'left'] : [primary, ...verticalDirections];
  const candidates = directions.map(desired);
  const fits = ({ bounds }) => bounds.x >= workArea.x && bounds.y >= workArea.y &&
    bounds.x + bounds.width <= workArea.x + workArea.width && bounds.y + bounds.height <= workArea.y + workArea.height;
  let selected = candidates.find(fits);
  if (!selected) {
    // A central widget can leave useful space above/below without fitting the
    // full stats body. Scroll that body before covering the live scoreboard.
    const minWidth = comparison ? 340 : 240, minBodyHeight = comparison ? 260 : 180;
    selected = candidates.map((candidate) => {
      const bounds = { ...candidate.bounds }, direction = candidate.direction;
      if (direction === 'left') {
        const right = bounds.x + bounds.width;
        bounds.width = Math.max(1, Math.min(bounds.width, Math.floor(right - workArea.x)));
        bounds.x = right - bounds.width;
      } else if (direction === 'right') {
        bounds.width = Math.max(1, Math.min(bounds.width, Math.floor(workArea.x + workArea.width - bounds.x)));
      } else if (direction === 'up') {
        const bottom = bounds.y + bounds.height;
        bounds.height = Math.max(1, Math.min(bounds.height, Math.floor(bottom - workArea.y)));
        bounds.y = bottom - bounds.height;
      } else {
        bounds.height = Math.max(1, Math.min(bounds.height, Math.floor(workArea.y + workArea.height - bounds.y)));
      }
      const readable = ['left', 'right'].includes(direction) ? bounds.width >= minWidth
        : bounds.height >= minBodyHeight + (direction === 'down' ? downNeckHeight : 0);
      return { ...candidate, bounds, readable };
    }).find((candidate) => candidate.readable && fits(candidate));
  }
  if (!selected) {
    // On unusually small displays keep the whole window reachable and choose
    // the placement that covers the least of the selected team.
    selected = candidates.map((candidate) => ({ ...candidate, bounds: clampBounds(candidate.bounds, workArea) }))
      .reduce((best, candidate) => overlapArea(candidate.bounds, comparison ? bug : team) < overlapArea(best.bounds, comparison ? bug : team) ? candidate : best);
  }
  const bounds = clampBounds(selected.bounds, workArea);
  const direction = selected.direction;
  const presentation = {
    side, direction, orientation,
    attachment: { left: 'right', right: 'left', up: 'bottom', down: 'top' }[direction],
    width: bounds.width, height: bounds.height,
    // Continue the selected team's original gradient in the blade's local
    // coordinate space, including after screen-edge placement and fitting.
    gradientX: team.x - bounds.x, gradientY: team.y - bounds.y,
    gradientWidth: team.width, gradientHeight: team.height
  };
  if (direction === 'down' && belowStatus) presentation.neckHeight = downNeckHeight;
  if (direction === 'left' || direction === 'right') {
    const [top, bottom] = selected.points;
    const edgeHeight = bottom[1] - top[1];
    const topY = limit(top[1], bounds.y, bounds.y + bounds.height);
    const bottomY = limit(bottom[1], bounds.y, bounds.y + bounds.height);
    const edgeX = (y) => edgeHeight ? top[0] + (bottom[0] - top[0]) * (y - top[1]) / edgeHeight : top[0];
    Object.assign(presentation, {
      joinTop: topY - bounds.y,
      joinBottom: bottomY - bounds.y,
      joinTopX: limit(edgeX(topY) - bounds.x, 0, bounds.width),
      joinBottomX: limit(edgeX(bottomY) - bounds.x, 0, bounds.width)
    });
  } else {
    const [left, right] = selected.points;
    // A large scorebug can have a wider team than the panel. Joining a centered
    // portion of its straight edge keeps the blade on that same team's color.
    Object.assign(presentation, {
      joinLeft: limit(left[0] - bounds.x, 0, bounds.width),
      joinRight: limit(right[0] - bounds.x, 0, bounds.width),
      joinY: limit(left[1] - bounds.y, 0, bounds.height)
    });
  }
  return { bounds, presentation };
}

function detailsBounds(widgetBounds, workArea, options) {
  return detailsPlacement(widgetBounds, workArea, options).bounds;
}

function detailsWindowShape(presentation) {
  // Electron's transparent rectangles still intercept clicks. For the one
  // layout whose neck passes the widget's toolbar, expose only that neck and
  // the full body below it to native drawing/input. [] restores a normal window.
  if (presentation?.direction !== 'down' || !Number.isFinite(presentation.neckHeight)) return [];
  const width = Math.max(1, Math.round(finite(presentation.width, DETAILS_SIZE.width)));
  const height = Math.max(1, Math.round(finite(presentation.height, DETAILS_SIZE.height)));
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const joinY = clamp(finite(presentation.joinY, 1), .8, height - .8);
  const shoulder = Math.min(height - 24, Math.max(24, joinY + 12, joinY + presentation.neckHeight));
  // Include the 4px taper and outline around the shared SVG neck; the body
  // rectangle begins a pixel early to avoid any seam at fractional-DIP scales.
  const left = clamp(Math.floor(finite(presentation.joinLeft, width * .2) - 5), 0, width - 1);
  const right = clamp(Math.ceil(finite(presentation.joinRight, width * .8) + 1), left + 1, width);
  const bodyTop = clamp(Math.floor(shoulder) - 1, 0, height - 1);
  return [
    { x: left, y: 0, width: right - left, height: Math.min(height, Math.ceil(shoulder) + 1) },
    { x: 0, y: bodyTop, width, height: height - bodyTop }
  ];
}

function scorebugHitBounds(bounds, orientation = 'horizontal', contentAlignment = 'bottom') {
  const width = Math.max(1, bounds.width - 16);
  // Match the main SVG artwork, excluding controls and the optional badge.
  // Top layouts put both below it; bottom layouts keep them above it. The
  // artwork's origin is therefore stable when the feed-status badge changes.
  const aspect = orientation === 'vertical' ? 290 / 160 : 138 / 600;
  const height = Math.max(1, Math.min(bounds.height - 8, width * aspect));
  return { x: bounds.x + 8, y: contentAlignment === 'top' ? bounds.y + 8 : bounds.y + bounds.height - 8 - height, width, height };
}

// These vertices and narrow hover regions mirror public/scorebug.js. The
// geometry tests compare them with the actual renderer to catch future drift.
const TEAM_POLYGONS = Object.freeze({
  horizontal: {
    away: [[30, 4], [303, 4], [285, 88], [12, 88]],
    home: [[308, 4], [595, 4], [577, 88], [290, 88]]
  },
  vertical: {
    away: [[17, 2], [159, 2], [151, 98], [9, 98]],
    home: [[17, 105], [159, 105], [151, 201], [9, 201]]
  }
});
const SITUATION_POLYGONS = Object.freeze({
  horizontal: [[30 - 89 * 3 / 14, 93], [595 - 89 * 3 / 14, 93], [595 - 132 * 3 / 14, 136], [30 - 132 * 3 / 14, 136]],
  vertical: [[17 - 101 / 12, 206], [159 - 101 / 12, 206], [159 - 183 / 12, 288], [17 - 183 / 12, 288]]
});
const DETAILS_TARGETS = Object.freeze({
  horizontal: {
    away: [[[30, 4], [171, 4], [171, 88], [12, 88]]],
    home: [[[435, 4], [595, 4], [577, 88], [435, 88]]],
    comparison: [[[228, 94], [358, 94], [358, 135], [228, 135]]]
  },
  vertical: {
    away: [[[28, 4], [145, 4], [145, 40], [28, 40]], [[17, 2], [29, 2], [21, 98], [9, 98]]],
    home: [[[28, 107], [145, 107], [145, 143], [28, 143]], [[147, 105], [159, 105], [151, 201], [139, 201]]],
    comparison: [[[22, 228], [135, 228], [135, 254], [22, 254]]]
  }
});

function transformPolygon(bounds, orientation, contentAlignment, polygon) {
  const bug = scorebugHitBounds(bounds, orientation, contentAlignment);
  const factor = bug.width / (orientation === 'vertical' ? 160 : 600);
  return polygon.map(([x, y]) => [bug.x + x * factor, bug.y + y * factor]);
}

function polygonBounds(polygon) {
  const xs = polygon.map(([x]) => x), ys = polygon.map(([, y]) => y);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

function teamPanelPolygon(bounds, orientation = 'horizontal', side = 'home', contentAlignment = 'bottom') {
  return transformPolygon(bounds, orientation, contentAlignment, TEAM_POLYGONS[orientation === 'vertical' ? 'vertical' : 'horizontal'][side === 'away' ? 'away' : 'home']);
}

function situationPanelPolygon(bounds, orientation = 'horizontal', contentAlignment = 'bottom') {
  return transformPolygon(bounds, orientation, contentAlignment, SITUATION_POLYGONS[orientation === 'vertical' ? 'vertical' : 'horizontal']);
}

function teamPanelBounds(bounds, orientation = 'horizontal', side = 'home', contentAlignment = 'bottom') {
  return polygonBounds(teamPanelPolygon(bounds, orientation, side, contentAlignment));
}

function pointInPolygon(polygon, x, y) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function teamAtPoint(bounds, point, orientation = 'horizontal', contentAlignment = 'bottom') {
  const layout = orientation === 'vertical' ? 'vertical' : 'horizontal';
  const bug = scorebugHitBounds(bounds, orientation, contentAlignment);
  if (!containsPoint(bug, point)) return null;
  const factor = bug.width / (layout === 'vertical' ? 160 : 600);
  const x = (point.x - bug.x) / factor, y = (point.y - bug.y) / factor;
  for (const [side, polygons] of Object.entries(DETAILS_TARGETS[layout])) {
    const clip = side === 'comparison' ? SITUATION_POLYGONS[layout] : TEAM_POLYGONS[layout][side];
    if (pointInPolygon(clip, x, y) && polygons.some((polygon) => pointInPolygon(polygon, x, y))) return side;
  }
  return null;
}

function hoverBridge(a, b) {
  if (!a || !b) return null;
  const left = Math.max(a.x, b.x);
  const right = Math.min(a.x + a.width, b.x + b.width);
  if (right > left) {
    if (a.y + a.height <= b.y) return { x: left, y: a.y + a.height, width: right - left, height: b.y - (a.y + a.height) };
    if (b.y + b.height <= a.y) return { x: left, y: b.y + b.height, width: right - left, height: a.y - (b.y + b.height) };
  }
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (bottom > top) {
    if (a.x + a.width <= b.x) return { x: a.x + a.width, y: top, width: b.x - (a.x + a.width), height: bottom - top };
    if (b.x + b.width <= a.x) return { x: b.x + b.width, y: top, width: a.x - (b.x + b.width), height: bottom - top };
  }
  return null;
}

module.exports = { ANCHORS, ANCHOR_LABELS, clampBounds, anchorBounds, nearestAnchor, displayForBounds, contentAlignmentForAnchor, widgetSize, containsPoint, detailsBounds, detailsPlacement, detailsWindowShape, DETAILS_SIZE, COMPARISON_DETAILS_SIZE, DETAILS_SEAM_OVERLAP, scorebugHitBounds, teamPanelBounds, teamPanelPolygon, situationPanelPolygon, teamAtPoint, hoverBridge };
