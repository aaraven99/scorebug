'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ANCHORS, anchorBounds, clampBounds, nearestAnchor, displayForBounds, detailsBounds, scorebugHitBounds, hoverBridge, containsPoint } = require('./geometry.cjs');

test('all nine anchors stay inside a negative-coordinate monitor work area', () => {
  const area = { x: -1920, y: 80, width: 1920, height: 1000 };
  for (const anchor of ANCHORS) {
    const bounds = anchorBounds(anchor, { width: 520, height: 144 }, area);
    assert.ok(bounds.x >= area.x && bounds.y >= area.y, anchor);
    assert.ok(bounds.x + bounds.width <= area.x + area.width, anchor);
    assert.ok(bounds.y + bounds.height <= area.y + area.height, anchor);
  }
  assert.deepEqual(anchorBounds('bottom-center', { width: 520, height: 144 }, area), {
    x: -1220, y: 920, width: 520, height: 144
  });
});

test('snapping requires proximity and selects the nearest eligible anchor', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 };
  assert.equal(nearestAnchor({ x: 29, y: 22, width: 520, height: 144 }, area).anchor, 'top-left');
  assert.equal(nearestAnchor({ x: 400, y: 300, width: 520, height: 144 }, area), null);
  assert.equal(nearestAnchor({ x: 710, y: 450, width: 520, height: 144 }, area).anchor, 'center');
});

test('restore clamps a removed monitor placement without losing the window', () => {
  const area = { x: 0, y: 0, width: 1366, height: 728 };
  assert.deepEqual(clampBounds({ x: -1600, y: 1400, width: 520, height: 144 }, area), {
    x: 0, y: 584, width: 520, height: 144
  });
  const displays = [{ id: 1, workArea: area }];
  assert.equal(displayForBounds({ x: -1600, y: 1400, width: 520, height: 144 }, displays, 99).id, 1);
});

test('monitor selection follows the widget center and supports vertical layouts', () => {
  const displays = [
    { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
    { id: 2, workArea: { x: 0, y: -1080, width: 1920, height: 1080 } }
  ];
  assert.equal(displayForBounds({ x: 500, y: -500, width: 520, height: 144 }, displays, 1).id, 2);
});

test('very small work areas and oversized widgets still produce finite visible bounds', () => {
  const area = { x: -50, y: -50, width: 180, height: 90 };
  for (const anchor of ANCHORS) {
    assert.deepEqual(anchorBounds(anchor, { width: 520, height: 144 }, area), {
      x: -50, y: -50, width: 180, height: 90
    });
  }
});

test('details stay visible and clear of the scorebug at all nine positions', () => {
  const area = { x: -1920, y: 70, width: 1920, height: 1000 };
  for (const anchor of ANCHORS) {
    const size = ['middle-left', 'middle-right'].includes(anchor) ? { width: 160, height: 340 } : { width: 520, height: 144 };
    const widget = anchorBounds(anchor, size, area);
    const panel = detailsBounds(widget, area);
    assert.ok(panel.x >= area.x && panel.y >= area.y, anchor);
    assert.ok(panel.x + panel.width <= area.x + area.width, anchor);
    assert.ok(panel.y + panel.height <= area.y + area.height, anchor);
    const overlaps = panel.x < widget.x + widget.width && panel.x + panel.width > widget.x && panel.y < widget.y + widget.height && panel.y + panel.height > widget.y;
    assert.equal(overlaps, false, anchor);
    if (anchor.startsWith('bottom')) assert.ok(panel.y + panel.height <= widget.y, anchor);
    if (anchor === 'middle-left') assert.ok(panel.x >= widget.x + widget.width);
    if (anchor === 'middle-right') assert.ok(panel.x + panel.width <= widget.x);
  }
});

test('details choose a side when vertical room is unavailable and clamp in tiny areas', () => {
  const area = { x: 100, y: 20, width: 1400, height: 430 };
  const panel = detailsBounds({ x: 116, y: 150, width: 520, height: 144 }, area);
  assert.equal(panel.x, 646);
  const tiny = { x: -300, y: 50, width: 200, height: 180 };
  assert.deepEqual(detailsBounds({ x: -300, y: 50, width: 160, height: 144 }, tiny), { ...tiny });
});

test('hover geometry excludes empty widget margins and bridges only the gap', () => {
  const widget = { x: 100, y: 500, width: 520, height: 144 };
  const hit = scorebugHitBounds(widget);
  assert.equal(containsPoint(hit, { x: 110, y: 510 }), false);
  assert.equal(containsPoint(hit, { x: 360, y: 600 }), true);
  const panel = { x: 150, y: 110, width: 420, height: 380 };
  assert.deepEqual(hoverBridge(widget, panel), { x: 150, y: 490, width: 420, height: 10 });
  assert.equal(containsPoint(hoverBridge(widget, panel), { x: 300, y: 495 }), true);
  assert.equal(containsPoint(hoverBridge(widget, panel), { x: 100, y: 495 }), false);
  const vertical = scorebugHitBounds({ x: 100, y: 500, width: 160, height: 340 }, 'vertical');
  assert.equal(containsPoint(vertical, { x: 150, y: 540 }), false, 'empty area above the vertical scorebug');
  assert.equal(containsPoint(vertical, { x: 150, y: 570 }), true, 'top team in the vertical scorebug');
  const enlarged = scorebugHitBounds({ x: 100, y: 500, width: 288, height: 612 }, 'vertical');
  assert.equal(containsPoint(enlarged, { x: 220, y: 550 }), false, 'enlarging keeps the transparent toolbar area out');
  assert.equal(containsPoint(enlarged, { x: 220, y: 600 }), true, 'enlarged top team remains a hover target');
});
