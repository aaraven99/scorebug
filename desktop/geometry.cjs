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
    top: workArea.y + edgeY,
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

function widgetSize(scale = 1, orientation = 'horizontal') {
  const vertical = orientation === 'vertical';
  const width = Math.round((vertical ? 160 : 520) * scale);
  // Controls and the transparent margins use CSS pixels, so they must not shrink
  // with the scorebug. Reserve the feed-status badge even while it is absent.
  const ratio = vertical ? 367 / 160 : 162 / 600;
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

const DETAILS_SIZE = Object.freeze({ width: 284, height: 216 });
const DETAILS_SEAM_OVERLAP = 1.5;

function detailsPlacement(widgetBounds, workArea, { side = 'home', orientation = 'horizontal', size = DETAILS_SIZE } = {}) {
  side = side === 'away' ? 'away' : 'home';
  orientation = orientation === 'vertical' ? 'vertical' : 'horizontal';
  const width = Math.max(1, Math.min(Math.round(finite(size.width, DETAILS_SIZE.width)), workArea.width));
  const height = Math.max(1, Math.min(Math.round(finite(size.height, DETAILS_SIZE.height)), workArea.height));
  const polygon = teamPanelPolygon(widgetBounds, orientation, side);
  const team = teamPanelBounds(widgetBounds, orientation, side);
  const bug = scorebugHitBounds(widgetBounds, orientation);
  const factor = bug.width / (orientation === 'vertical' ? 160 : 600);
  // Downward blades join beneath the information strip so their neck never
  // covers the clock/down text. Match the visible path (not its 2px SVG margin).
  const stripBottom = bug.y + (orientation === 'vertical' ? 346 : 136) * factor;
  const stripLeft = bug.x + factor;
  const stripRight = bug.x + (orientation === 'vertical' ? 149 : 571) * factor;
  const downEdge = [[Math.max(polygon[3][0], stripLeft), stripBottom], [Math.min(polygon[2][0], stripRight), stripBottom]];
  const overlap = DETAILS_SEAM_OVERLAP;
  const limit = (value, low, high) => Math.max(low, Math.min(value, high));
  const desired = (direction) => {
    if (direction === 'left' || direction === 'right') {
      const edge = direction === 'left' ? [polygon[0], polygon[3]] : [polygon[1], polygon[2]];
      const inward = direction === 'left' ? overlap : -overlap;
      const points = edge.map(([x, y]) => [x + inward, y]);
      const x = direction === 'left' ? Math.max(points[0][0], points[1][0]) - width : Math.min(points[0][0], points[1][0]);
      const y = limit(team.y + (team.height - height) / 2, workArea.y, workArea.y + workArea.height - height);
      return { direction, bounds: { x, y, width, height }, points };
    }
    const edge = direction === 'up' ? [polygon[0], polygon[1]] : downEdge;
    const y = edge[0][1] + (direction === 'up' ? overlap : -overlap) - (direction === 'up' ? height : 0);
    const x = limit((edge[0][0] + edge[1][0]) / 2 - width / 2, workArea.x, workArea.x + workArea.width - width);
    return { direction, bounds: { x, y, width, height }, points: edge.map(([px, py]) => [px, py + (direction === 'up' ? overlap : -overlap)]) };
  };
  const primary = side === 'away' ? 'left' : 'right';
  const upSpace = team.y - workArea.y;
  const downSpace = workArea.y + workArea.height - stripBottom;
  const verticalDirections = upSpace >= downSpace ? ['up', 'down'] : ['down', 'up'];
  // Horizontal teams have different outer edges. If the selected team's edge
  // is against the screen, attach above/below that team rather than the rival.
  const directions = orientation === 'vertical'
    ? [primary, primary === 'left' ? 'right' : 'left', ...verticalDirections]
    : [primary, ...verticalDirections];
  const candidates = directions.map(desired);
  const fits = ({ bounds }) => bounds.x >= workArea.x && bounds.y >= workArea.y &&
    bounds.x + bounds.width <= workArea.x + workArea.width && bounds.y + bounds.height <= workArea.y + workArea.height;
  let selected = candidates.find(fits);
  if (!selected) {
    // On unusually small displays keep the whole window reachable and choose
    // the placement that covers the least of the selected team.
    selected = candidates.map((candidate) => ({ ...candidate, bounds: clampBounds(candidate.bounds, workArea) }))
      .reduce((best, candidate) => overlapArea(candidate.bounds, team) < overlapArea(best.bounds, team) ? candidate : best);
  }
  const bounds = clampBounds(selected.bounds, workArea);
  const direction = selected.direction;
  const presentation = {
    side, direction, orientation,
    attachment: { left: 'right', right: 'left', up: 'bottom', down: 'top' }[direction],
    width: bounds.width, height: bounds.height
  };
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

function scorebugHitBounds(bounds, orientation = 'horizontal') {
  const width = Math.max(1, bounds.width - 16);
  // Match each SVG's aspect ratio instead of including the transparent space
  // reserved above it for controls. A delayed-feed badge is not a hover target.
  const aspect = orientation === 'vertical' ? 348 / 160 : 138 / 600;
  const height = Math.max(1, Math.min(bounds.height - 8, width * aspect));
  return { x: bounds.x + 8, y: bounds.y + bounds.height - 8 - height, width, height };
}

const TEAM_POLYGONS = Object.freeze({
  horizontal: {
    away: [[24, 4], [303, 4], [285, 88], [6, 88]],
    home: [[308, 4], [595, 4], [577, 88], [290, 88]]
  },
  vertical: {
    away: [[10, 2], [159, 2], [149, 121], [1, 121]],
    home: [[10, 128], [159, 128], [149, 247], [1, 247]]
  }
});

function teamPanelPolygon(bounds, orientation = 'horizontal', side = 'home') {
  const vertical = orientation === 'vertical';
  const bug = scorebugHitBounds(bounds, orientation);
  const factor = bug.width / (vertical ? 160 : 600);
  return TEAM_POLYGONS[vertical ? 'vertical' : 'horizontal'][side === 'away' ? 'away' : 'home']
    .map(([x, y]) => [bug.x + x * factor, bug.y + y * factor]);
}

function teamPanelBounds(bounds, orientation = 'horizontal', side = 'home') {
  const vertical = orientation === 'vertical';
  const bug = scorebugHitBounds(bounds, orientation);
  const factor = bug.width / (vertical ? 160 : 600);
  const polygon = TEAM_POLYGONS[vertical ? 'vertical' : 'horizontal'][side === 'away' ? 'away' : 'home'];
  const xs = polygon.map(([x]) => x), ys = polygon.map(([, y]) => y);
  return { x: bug.x + Math.min(...xs) * factor, y: bug.y + Math.min(...ys) * factor,
    width: (Math.max(...xs) - Math.min(...xs)) * factor, height: (Math.max(...ys) - Math.min(...ys)) * factor };
}

function teamAtPoint(bounds, point, orientation = 'horizontal') {
  const vertical = orientation === 'vertical';
  const bug = scorebugHitBounds(bounds, orientation);
  if (!containsPoint(bug, point)) return null;
  const factor = bug.width / (vertical ? 160 : 600);
  const x = (point.x - bug.x) / factor, y = (point.y - bug.y) / factor;
  for (const [side, polygon] of Object.entries(TEAM_POLYGONS[vertical ? 'vertical' : 'horizontal'])) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    if (inside) return side;
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

module.exports = { ANCHORS, ANCHOR_LABELS, clampBounds, anchorBounds, nearestAnchor, displayForBounds, widgetSize, containsPoint, detailsBounds, detailsPlacement, DETAILS_SIZE, DETAILS_SEAM_OVERLAP, scorebugHitBounds, teamPanelBounds, teamPanelPolygon, teamAtPoint, hoverBridge };
