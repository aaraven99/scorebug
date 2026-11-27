'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ANCHORS, anchorBounds, clampBounds, nearestAnchor, displayForBounds, contentAlignmentForAnchor, widgetSize, detailsBounds, detailsPlacement, detailsWindowShape, DETAILS_SIZE, DETAILS_SEAM_OVERLAP, scorebugHitBounds, teamPanelBounds, teamPanelPolygon, teamAtPoint, hoverBridge, containsPoint } = require('./geometry.cjs');

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

test('top docks put visible team panels close to the work area with controls and badges below', () => {
  const displays = [
    { scaleFactor: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
    { scaleFactor: 1.5, workArea: { x: -1280, y: 48, width: 1280, height: 672 } },
    { scaleFactor: 2, workArea: { x: 0, y: -850, width: 1440, height: 850 } }
  ];
  for (const { workArea: area } of displays) {
    for (const scale of [0.65, 1, 1.8]) {
      for (const anchor of ['top-left', 'top-center', 'top-right']) {
        const widget = anchorBounds(anchor, widgetSize(scale, 'horizontal', area), area);
        const alignment = contentAlignmentForAnchor(anchor);
        const bug = scorebugHitBounds(widget, 'horizontal', alignment);
        const team = teamPanelBounds(widget, 'horizontal', 'away', alignment);
        assert.equal(widget.y, area.y, 'the full window begins inside the taskbar-safe work area');
        assert.equal(bug.y, area.y + 8);
        assert.ok(team.y - area.y >= 8 && team.y - area.y <= 16, `${anchor}, scale ${scale}`);
        const toolbarTop = widget.y + widget.height - 28;
        assert.ok(bug.y + bug.width * 162 / 600 <= toolbarTop - 2, 'even the below-status badge clears the toolbar');
        assert.ok(widget.y + widget.height <= area.y + area.height);
        for (const side of ['home', 'away']) {
          const panel = teamPanelBounds(widget, 'horizontal', side, alignment);
          assert.equal(teamAtPoint(widget, { x: panel.x + panel.width / 2, y: panel.y + panel.height / 2 }, 'horizontal', alignment), side);
        }
        assert.equal(teamAtPoint(widget, { x: bug.x + bug.width / 2, y: toolbarTop + 8 }, 'horizontal', alignment), null);
      }
    }
  }
});

test('free dragging preserves content alignment while new anchors choose their own layout', () => {
  for (const previous of ['top', 'bottom']) {
    assert.equal(contentAlignmentForAnchor(null, previous), previous);
    for (const anchor of ANCHORS) {
      assert.equal(contentAlignmentForAnchor(anchor, previous), anchor.startsWith('top-') ? 'top' : 'bottom');
    }
  }
  assert.equal(contentAlignmentForAnchor(null, 'invalid'), 'bottom');
});

test('short high-DPI work areas fit the complete vertical SVG proportionally', () => {
  const area = { x: -960, y: 36, width: 960, height: 550 };
  const size = widgetSize(1.8, 'vertical', area);
  assert.deepEqual(size, { width: 238, height: 549 });
  for (const anchor of ['middle-left', 'middle-right', 'bottom-center', 'top-center']) {
    const widget = anchorBounds(anchor, size, area);
    assert.equal(widget.width, size.width);
    assert.equal(widget.height, size.height, 'anchoring must not clip the fitted height');
    const alignment = contentAlignmentForAnchor(anchor);
    const bug = scorebugHitBounds(widget, 'vertical', alignment);
    assert.ok(Math.abs(bug.height - bug.width * 348 / 160) < 0.000001);
    const badgeHeight = bug.width * 19 / 160;
    assert.ok(alignment === 'top' ? bug.y + bug.height + badgeHeight <= widget.y + widget.height - 31 : bug.y - badgeHeight >= widget.y + 31);
    assert.ok(widget.y >= area.y && widget.y + widget.height <= area.y + area.height);
  }
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

test('team blades stay visible at every anchor, size and monitor origin', () => {
  const area = { x: -1920, y: 70, width: 1920, height: 1000 };
  for (const scale of [0.65, 1, 1.8]) {
    for (const anchor of ANCHORS) {
      const orientation = ['middle-left', 'middle-right'].includes(anchor) ? 'vertical' : 'horizontal';
      const contentAlignment = contentAlignmentForAnchor(anchor);
      const widget = anchorBounds(anchor, widgetSize(scale, orientation), area);
      for (const side of ['home', 'away']) {
        const { bounds: panel, presentation } = detailsPlacement(widget, area, { side, orientation, contentAlignment });
        assert.equal(panel.width, DETAILS_SIZE.width);
        if (presentation.neckHeight) assert.ok(panel.height >= DETAILS_SIZE.height);
        else assert.equal(panel.height, DETAILS_SIZE.height);
        assert.ok(panel.x >= area.x && panel.y >= area.y, `${anchor} ${scale}`);
        assert.ok(panel.x + panel.width <= area.x + area.width, anchor);
        assert.ok(panel.y + panel.height <= area.y + area.height, anchor);
        assert.equal(presentation.side, side);
        assert.equal(presentation.orientation, orientation);
        assert.equal(presentation.width, panel.width);
        assert.equal(presentation.height, panel.height);
        const team = teamPanelBounds(widget, orientation, side, contentAlignment);
        assert.equal(presentation.gradientX, team.x - panel.x);
        assert.equal(presentation.gradientY, team.y - panel.y);
        assert.equal(presentation.gradientWidth, team.width);
        assert.equal(presentation.gradientHeight, team.height);
        if (anchor === 'middle-left') assert.equal(presentation.direction, 'right');
        if (anchor === 'middle-right') assert.equal(presentation.direction, 'left');
        if (anchor === 'center') assert.equal(presentation.direction, side === 'home' ? 'right' : 'left');
      }
    }
  }
});

test('lateral blades follow the exact slanted team edge with a small connected overlap', () => {
  const area = { x: -100, y: -120, width: 1600, height: 1100 };
  for (const orientation of ['horizontal', 'vertical']) {
    for (const scale of [0.65, 1, 1.8]) {
      const widget = anchorBounds('center', widgetSize(scale, orientation), area);
      for (const side of ['home', 'away']) {
        const { bounds, presentation } = detailsPlacement(widget, area, { side, orientation });
        const polygon = teamPanelPolygon(widget, orientation, side);
        const direction = side === 'away' ? 'left' : 'right';
        assert.equal(presentation.direction, direction);
        const [top, bottom] = direction === 'left' ? [polygon[0], polygon[3]] : [polygon[1], polygon[2]];
        const inward = direction === 'left' ? DETAILS_SEAM_OVERLAP : -DETAILS_SEAM_OVERLAP;
        assert.ok(Math.abs(bounds.x + presentation.joinTopX - (top[0] + inward)) <= 0.51);
        assert.ok(Math.abs(bounds.x + presentation.joinBottomX - (bottom[0] + inward)) <= 0.51);
        assert.ok(Math.abs(bounds.y + presentation.joinTop - top[1]) < 0.001);
        assert.ok(Math.abs(bounds.y + presentation.joinBottom - bottom[1]) < 0.001);
        assert.ok(presentation.joinTopX > presentation.joinBottomX, 'seam preserves the scorebug slant');
        assert.ok(presentation.joinTop >= 0 && presentation.joinBottom <= bounds.height);
        assert.deepEqual(detailsBounds(widget, area, { side, orientation }), bounds);
      }
    }
  }
});

test('horizontal corner blades attach above or below the selected team, never to its rival', () => {
  const area = { x: 100, y: 20, width: 1400, height: 900 };
  for (const [anchor, side, direction] of [
    ['top-left', 'away', 'down'], ['top-right', 'home', 'down'],
    ['bottom-left', 'away', 'up'], ['bottom-right', 'home', 'up']
  ]) {
    const widget = anchorBounds(anchor, widgetSize(), area);
    const contentAlignment = contentAlignmentForAnchor(anchor);
    const { bounds, presentation } = detailsPlacement(widget, area, { side, contentAlignment });
    const polygon = teamPanelPolygon(widget, 'horizontal', side, contentAlignment);
    const edge = direction === 'up' ? [polygon[0], polygon[1]] : [polygon[3], polygon[2]];
    assert.equal(presentation.direction, direction);
    assert.equal(presentation.attachment, direction === 'up' ? 'bottom' : 'top');
    assert.ok(bounds.x + presentation.joinLeft >= edge[0][0] - 0.01);
    assert.ok(bounds.x + presentation.joinRight <= edge[1][0] + 0.01);
    const bug = scorebugHitBounds(widget, 'horizontal', contentAlignment);
    const expectedY = direction === 'up' ? edge[0][1] + DETAILS_SEAM_OVERLAP : bug.y + 136 * bug.width / 600 - DETAILS_SEAM_OVERLAP;
    assert.ok(Math.abs(bounds.y + presentation.joinY - expectedY) <= 0.51);
  }
});

test('downward blades join below the full information strip and leave its clock/down text visible', () => {
  for (const orientation of ['horizontal', 'vertical']) {
    for (const scale of [0.65, 1, 1.8]) {
      const size = widgetSize(scale, orientation);
      const area = { x: -800, y: 50, width: size.width + 32, height: size.height + 320 };
      const widget = anchorBounds('top-center', size, area);
      const contentAlignment = 'top';
      const bug = scorebugHitBounds(widget, orientation, contentAlignment);
      const factor = bug.width / (orientation === 'vertical' ? 160 : 600);
      const stripBottom = bug.y + (orientation === 'vertical' ? 346 : 136) * factor;
      for (const side of ['home', 'away']) {
        const { bounds, presentation } = detailsPlacement(widget, area, { side, orientation, contentAlignment });
        assert.equal(presentation.direction, 'down');
        assert.ok(bounds.y >= stripBottom - DETAILS_SEAM_OVERLAP - 0.51, 'only the narrow border overlap can enter the strip');
        assert.ok(Math.abs(bounds.y + presentation.joinY - stripBottom + DETAILS_SEAM_OVERLAP) <= 0.51);
        assert.ok(bounds.x + presentation.joinLeft >= bug.x + factor - 0.01);
        assert.ok(bounds.x + presentation.joinRight <= bug.x + (orientation === 'vertical' ? 149 : 571) * factor + 0.01);
        assert.ok(bounds.y + bounds.height <= area.y + area.height);
      }
    }
  }
});

test('top-corner downward blades leave room for a below-panel status badge at every size', () => {
  const area = { x: -1280, y: 40, width: 1280, height: 900 };
  for (const scale of [0.65, 1, 1.8]) {
    for (const [anchor, side] of [['top-left', 'away'], ['top-right', 'home']]) {
      const widget = anchorBounds(anchor, widgetSize(scale, 'horizontal', area), area);
      const bug = scorebugHitBounds(widget, 'horizontal', 'top');
      const factor = bug.width / 600;
      const { bounds, presentation } = detailsPlacement(widget, area, { side, contentAlignment: 'top' });
      assert.equal(presentation.direction, 'down');
      assert.ok(presentation.neckHeight >= 26 * factor + 6);
      assert.ok(bounds.x + presentation.joinLeft > bug.x + 224 * factor, 'the narrow connector clears the largest status flag');
      assert.ok(presentation.joinRight - presentation.joinLeft >= 8, 'the connector remains visibly joined');
      assert.ok(bounds.y + presentation.joinY + presentation.neckHeight > bug.y + 162 * factor + 3, 'the broad body begins below the complete badge');
      assert.ok(bounds.y + presentation.joinY + presentation.neckHeight >= widget.y + widget.height + 3, 'the narrow connector continues past the toolbar');
      const regions = detailsWindowShape(presentation);
      assert.equal(regions.length, 2);
      const body = regions[1];
      assert.ok(body.height >= DETAILS_SIZE.height - 24, 'the enlarged frame retains the full stats body');
      // The real horizontal toolbar is narrower than this 128px reserved band.
      // Check both ends of the band, not only a single convenient button point.
      for (const x of [widget.x + widget.width - 137, widget.x + widget.width - 10]) {
        for (const y of [widget.y + widget.height - 28, widget.y + widget.height - 4]) {
          assert.ok(!regions.some((region) => containsPoint(region, { x: x - bounds.x, y: y - bounds.y })), 'native input shape covers the controls');
        }
      }
    }
  }
});

test('other blade directions and ordinary downward blades restore the full native window region', () => {
  assert.deepEqual(detailsWindowShape(null), []);
  for (const direction of ['left', 'right', 'up']) {
    assert.deepEqual(detailsWindowShape({ direction, width: 284, height: 260, neckHeight: 60 }), []);
  }
  assert.deepEqual(detailsWindowShape({ direction: 'down', width: 284, height: 216 }), []);
});

test('small work areas keep the complete blade window reachable and all seam values finite', () => {
  const tiny = { x: -300, y: 50, width: 200, height: 180 };
  const placement = detailsPlacement({ x: -300, y: 50, width: 160, height: 144 }, tiny);
  assert.deepEqual(placement.bounds, { ...tiny });
  for (const [key, value] of Object.entries(placement.presentation)) {
    if (key.startsWith('join')) assert.ok(Number.isFinite(value) && value >= 0, key);
  }
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
