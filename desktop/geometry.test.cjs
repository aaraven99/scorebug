'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ANCHORS, anchorBounds, clampBounds, nearestAnchor, displayForBounds, widgetSize, detailsBounds, scorebugHitBounds, teamPanelBounds, teamAtPoint, hoverBridge, containsPoint } = require('./geometry.cjs');

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

test('normal edge drags snap without aiming at the exact side midpoint', () => {
  const area = { x: -1920, y: 70, width: 1920, height: 1000 };
  for (const scale of [0.65, 1, 1.8]) {
    for (const orientation of ['horizontal', 'vertical']) {
      const size = widgetSize(scale, orientation);
      const y = area.y + (area.height - size.height) * 0.3;
      assert.equal(nearestAnchor({ x: area.x + 7, y, ...size }, area).anchor, 'middle-left');
      assert.equal(nearestAnchor({ x: area.x + area.width - size.width - 7, y, ...size }, area).anchor, 'middle-right');
      const x = area.x + (area.width - size.width) * 0.3;
      assert.equal(nearestAnchor({ x, y: area.y + 7, ...size }, area).anchor, 'top-center');
      assert.equal(nearestAnchor({ x, y: area.y + area.height - size.height - 7, ...size }, area).anchor, 'bottom-center');
      assert.equal(nearestAnchor({ x: area.x + 7, y: area.y + 7, ...size }, area).anchor, 'top-left');
    }
  }
});

test('all sizes reserve unscaled toolbar room and the complete status badge', () => {
  assert.deepEqual(widgetSize(1), { width: 520, height: 176 });
  assert.deepEqual(widgetSize(1, 'vertical'), { width: 160, height: 370 });
  assert.deepEqual(widgetSize(0.65), { width: 338, height: 126 });
  assert.deepEqual(widgetSize(0.65, 'vertical'), { width: 104, height: 241 });
  assert.deepEqual(widgetSize(1.8, 'vertical'), { width: 288, height: 663 });
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

test('team extensions stay visible at all anchors and turn inward at screen edges', () => {
  const area = { x: -1920, y: 70, width: 1920, height: 1000 };
  for (const anchor of ANCHORS) {
    const orientation = ['middle-left', 'middle-right'].includes(anchor) ? 'vertical' : 'horizontal';
    const widget = anchorBounds(anchor, widgetSize(1, orientation), area);
    for (const side of ['home', 'away']) {
      const panel = detailsBounds(widget, area, { side, orientation });
      assert.equal(panel.width, 220);
      assert.equal(panel.height, 230);
      assert.ok(panel.x >= area.x && panel.y >= area.y, anchor);
      assert.ok(panel.x + panel.width <= area.x + area.width, anchor);
      assert.ok(panel.y + panel.height <= area.y + area.height, anchor);
      for (const team of ['home', 'away']) {
        const colored = teamPanelBounds(widget, orientation, team);
        const horizontalOverlap = Math.min(panel.x + panel.width, colored.x + colored.width) - Math.max(panel.x, colored.x);
        assert.ok(horizontalOverlap <= 1, `${anchor}: card obscured ${team}`);
      }
      if (anchor === 'middle-left') assert.ok(panel.x > widget.x + widget.width - 10);
      if (anchor === 'middle-right') assert.ok(panel.x + panel.width < widget.x + 10);
      if (anchor === 'center') assert.equal(panel.x > widget.x, side === 'home');
    }
  }
});

test('team extensions join the colored edge instead of the transparent window margin', () => {
  const area = { x: 100, y: 20, width: 1400, height: 430 };
  const widget = { x: 500, y: 150, ...widgetSize() };
  const home = detailsBounds(widget, area, { side: 'home' });
  const away = detailsBounds(widget, area, { side: 'away' });
  const homeTeam = teamPanelBounds(widget, 'horizontal', 'home');
  const awayTeam = teamPanelBounds(widget, 'horizontal', 'away');
  assert.ok(Math.abs(home.x - homeTeam.x - homeTeam.width) <= 1);
  assert.ok(Math.abs(away.x + away.width - awayTeam.x) <= 1);
  const tiny = { x: -300, y: 50, width: 200, height: 180 };
  assert.deepEqual(detailsBounds({ x: -300, y: 50, width: 160, height: 144 }, tiny), { ...tiny });
});

test('hover geometry excludes empty widget margins and bridges only the gap', () => {
  const widget = { x: 100, y: 500, ...widgetSize() };
  const hit = scorebugHitBounds(widget);
  assert.equal(containsPoint(hit, { x: 110, y: 510 }), false);
  assert.equal(containsPoint(hit, { x: 360, y: 600 }), true);
  const panel = { x: 150, y: 110, width: 420, height: 380 };
  assert.deepEqual(hoverBridge(widget, panel), { x: 150, y: 490, width: 420, height: 10 });
  assert.equal(containsPoint(hoverBridge(widget, panel), { x: 300, y: 495 }), true);
  assert.equal(containsPoint(hoverBridge(widget, panel), { x: 100, y: 495 }), false);
  const vertical = scorebugHitBounds({ x: 100, y: 500, ...widgetSize(1, 'vertical') }, 'vertical');
  assert.equal(containsPoint(vertical, { x: 150, y: 540 }), false, 'empty area above the vertical scorebug');
  assert.equal(containsPoint(vertical, { x: 150, y: 570 }), true, 'top team in the vertical scorebug');
  const enlarged = scorebugHitBounds({ x: 100, y: 500, ...widgetSize(1.8, 'vertical') }, 'vertical');
  assert.equal(containsPoint(enlarged, { x: 220, y: 550 }), false, 'enlarging keeps the transparent toolbar area out');
  assert.equal(containsPoint(enlarged, { x: 220, y: 600 }), true, 'enlarged top team remains a hover target');
});

test('native pointer targets identify each colored team and exclude clocks and margins', () => {
  for (const orientation of ['horizontal', 'vertical']) {
    for (const scale of [0.65, 1, 1.8]) {
      const widget = { x: -800, y: 200, ...widgetSize(scale, orientation) };
      for (const side of ['home', 'away']) {
        const team = teamPanelBounds(widget, orientation, side);
        assert.equal(teamAtPoint(widget, { x: team.x + team.width / 2, y: team.y + team.height / 2 }, orientation), side);
      }
      assert.equal(teamAtPoint(widget, { x: widget.x + widget.width / 2, y: widget.y + 10 }, orientation), null);
      assert.equal(teamAtPoint(widget, { x: widget.x + widget.width / 2, y: widget.y + widget.height - 15 }, orientation), null);
    }
  }
});
