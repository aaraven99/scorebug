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
  let result = null;
  for (const anchor of ANCHORS) {
    const target = anchorBounds(anchor, bounds, workArea, margin);
    const distance = Math.hypot(target.x - bounds.x, target.y - bounds.y);
    if (distance <= threshold && (!result || distance < result.distance)) {
      result = { anchor, bounds: target, distance };
    }
  }
  return result;
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

function detailsBounds(widgetBounds, workArea, size = { width: 420, height: 480 }, gap = 10) {
  const width = Math.min(size.width, workArea.width);
  const height = Math.min(size.height, workArea.height);
  const centeredX = widgetBounds.x + (widgetBounds.width - width) / 2;
  const centeredY = widgetBounds.y + (widgetBounds.height - height) / 2;
  const above = { x: centeredX, y: widgetBounds.y - height - gap, width, height };
  const below = { x: centeredX, y: widgetBounds.y + widgetBounds.height + gap, width, height };
  const right = { x: widgetBounds.x + widgetBounds.width + gap, y: centeredY, width, height };
  const left = { x: widgetBounds.x - width - gap, y: centeredY, width, height };
  const preferAbove = widgetBounds.y + widgetBounds.height / 2 >= workArea.y + workArea.height / 2;
  const vertical = widgetBounds.height > widgetBounds.width;
  const preferRight = widgetBounds.x + widgetBounds.width / 2 < workArea.x + workArea.width / 2;
  const candidates = vertical
    ? (preferRight ? [right, left, below, above] : [left, right, below, above])
    : (preferAbove ? [above, below, right, left] : [below, above, right, left]);
  const clamped = candidates.map((bounds) => clampBounds(bounds, workArea));
  // Clamping may turn an off-screen candidate into one that overlaps the bug.
  // Prefer a non-overlapping placement, preserving the directional preference.
  const unobstructed = clamped.find((bounds) => overlapArea(bounds, widgetBounds) === 0);
  return unobstructed || clamped.reduce((best, bounds) => overlapArea(bounds, widgetBounds) < overlapArea(best, widgetBounds) ? bounds : best);
}

function scorebugHitBounds(bounds, orientation = 'horizontal') {
  const width = Math.max(1, bounds.width - 16);
  // Match each SVG's aspect ratio instead of including the transparent space
  // reserved above it for controls. A delayed-feed badge is not a hover target.
  const aspect = orientation === 'vertical' ? 310 / 160 : 117 / 600;
  const height = Math.max(1, Math.min(bounds.height - 8, Math.ceil(width * aspect)));
  return { x: bounds.x + 8, y: bounds.y + bounds.height - 8 - height, width, height };
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

module.exports = { ANCHORS, ANCHOR_LABELS, clampBounds, anchorBounds, nearestAnchor, displayForBounds, containsPoint, detailsBounds, scorebugHitBounds, hoverBridge };
