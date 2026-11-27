import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderScorebug, teamColor, teamGradientStops } from '../public/scorebug.js';
import { bladeGradientSpace, bladeOutline } from '../public/details-blade.js';
import { placeDetailsBlade } from '../public/details-hover.js';
import geometry from '../desktop/geometry.cjs';

const game = {
  id: 'test', state: 'in', phase: 'live', period: 2, clock: '8:34', downDistance: '2nd & 6', fieldPosition: 'KC 38',
  away: { id: '25', abbreviation: 'SF', color: '#aa0000', score: 10, timeouts: 2 },
  home: { id: '12', abbreviation: 'KC', color: '#e31837', score: 17, timeouts: 3 },
};

function pathPoints(path, factor, x, y) {
  const match = /^M([\d.-]+)\s+([\d.-]+)H([\d.-]+)L([\d.-]+)\s+([\d.-]+)H([\d.-]+)Z$/.exec(path);
  assert.ok(match, 'the renderer exposes the unchanged four-corner panel');
  const [, x1, y1, x2, x3, y3, x4] = match.map(Number);
  return [[x1, y1], [x2, y1], [x3, y3], [x4, y3]].map(([px, py]) => ({ x: x + px * factor, y: y + py * factor }));
}

// Derive the source position from its actual rendered SVG viewBox and the CSS
// box model, independently of the native hit-region/gradient helpers.
function renderedPanels(bounds, orientation, alignment, stale = false, demo = false) {
  const markup = renderScorebug(game, { orientation, stale, demo, statusPosition: alignment === 'top' ? 'below' : 'above', idPrefix: 'gradient-test' });
  const [, minY, svgWidth, svgHeight] = /viewBox="0 (-?\d+) (\d+) (\d+)"/.exec(markup).map(Number);
  const factor = (bounds.width - 16) / svgWidth;
  const svgTop = alignment === 'top' ? bounds.y + 8 : bounds.y + bounds.height - 8 - svgHeight * factor;
  const originY = svgTop - minY * factor;
  const pointSet = (side) => {
    const path = new RegExp(`data-team-side="${side}"[^>]*>[\\s\\S]*?<path class="bug-team-panel" d="([^"]+)"`).exec(markup)?.[1];
    return pathPoints(path, factor, bounds.x + 8, originY);
  };
  const strip = pathPoints(/class="bug-situation-panel" d="([^"]+)"/.exec(markup)[1], factor, bounds.x + 8, originY);
  const belowStatus = alignment === 'top' && orientation === 'horizontal'
    ? { clearX: bounds.x + 8 + 232 * factor, homeRight: bounds.x + 8 + 343 * factor, clearanceY: originY + 162 * factor + 6 } : null;
  const badgePath = /class="bug-status-flag"[^>]*><path d="([^"]+)"/.exec(markup)?.[1];
  let badge = null;
  if (badgePath && belowStatus) {
    const [x1, y1, x2, x3, y3, x4] = badgePath.match(/-?\d+/g).map(Number);
    badge = boundingBox([[x1, y1], [x2, y1], [x3, y3], [x4, y3]].map(([x, y]) => ({ x: bounds.x + 8 + x * factor, y: originY + (162 + y) * factor })));
  }
  return { away: pointSet('away'), home: pointSet('home'), lowerEdge: [strip[3], strip[2]], belowStatus, badge };
}

function boundingBox(points) {
  const xs = points.map(({ x }) => x), ys = points.map(({ y }) => y);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

function stopsFromMarkup(markup, side) {
  const gradient = new RegExp(`<linearGradient id="gradient-test-${side}"[^>]*>(.*?)</linearGradient>`).exec(markup)[1];
  return [...gradient.matchAll(/<stop offset="([^"]+)" stop-color="([^"]+)"\/>/g)]
    .map(([, offset, color]) => ({ offset, color }));
}

function assertContinuation(frame, presentation, sourcePoints) {
  const source = boundingBox(sourcePoints);
  const space = bladeGradientSpace(frame.width, frame.height, presentation);
  for (const [actual, expected] of [
    [frame.x + space.x, source.x], [frame.y + space.y, source.y],
    [space.width, source.width], [space.height, source.height],
  ]) assert.ok(Math.abs(actual - expected) < 1e-8, `source gradient moved: ${actual} != ${expected}`);

  // A point has the same color coordinate in both SVGs, including the bevel's
  // slightly different direction and source stops beyond the blade's edges.
  const seams = ['left', 'right'].includes(presentation.direction)
    ? [[presentation.joinTopX, presentation.joinTop], [presentation.joinBottomX, presentation.joinBottom]]
    : [[presentation.joinLeft, presentation.joinY], [presentation.joinRight, presentation.joinY]];
  for (const diagonal of [.12, .1]) {
    for (const fraction of [0, .25, .5, .75, 1]) {
      const x = seams[0][0] + (seams[1][0] - seams[0][0]) * fraction;
      const y = seams[0][1] + (seams[1][1] - seams[0][1]) * fraction;
      const sourceCoordinate = (diagonal * (frame.x + x - source.x) / source.width + (frame.y + y - source.y) / source.height) / (1 + diagonal ** 2);
      const bladeCoordinate = (diagonal * (x - space.x) / space.width + (y - space.y) / space.height) / (1 + diagonal ** 2);
      assert.ok(Math.abs(sourceCoordinate - bladeCoordinate) < 1e-10, 'the gradient must not restart at the new window');
    }
  }
}

test('blades share the exact SF-gold/KC-red palette and all four original stops', () => {
  assert.equal(teamColor(game.away, 'away'), '#b3995d');
  for (const orientation of ['horizontal', 'vertical']) {
    const markup = renderScorebug(game, { orientation, idPrefix: 'gradient-test' });
    for (const side of ['away', 'home']) {
      const stops = teamGradientStops(game[side], side);
      assert.deepEqual(stops.map(({ offset }) => offset), ['0', '.37', '.58', '1']);
      assert.deepEqual(stops, stopsFromMarkup(markup, side));
      assert.deepEqual(teamGradientStops({ color: teamColor(game[side], side) }, side), stops, 'the blade consumes the resolved source color without retinting it');
    }
  }
});

test('native source gradients stay aligned across all directions, monitor origins, sizes and status badges', () => {
  const directions = new Set();
  for (const orientation of ['horizontal', 'vertical']) {
    for (const scale of [.65, 1, 1.8]) {
      for (const anchor of ['center', 'middle-left', 'middle-right', 'top-left', 'top-right', 'bottom-left', 'bottom-right']) {
        const area = { x: -1920, y: 48, width: 1920, height: 1000 };
        const alignment = geometry.contentAlignmentForAnchor(anchor);
        const bounds = geometry.anchorBounds(anchor, geometry.widgetSize(scale, orientation, area), area);
        for (const stale of [false, true]) {
          const source = renderedPanels(bounds, orientation, alignment, stale);
          for (const side of ['away', 'home']) {
            const placement = geometry.detailsPlacement(bounds, area, { side, orientation, contentAlignment: alignment });
            directions.add(placement.presentation.direction);
            assertContinuation(placement.bounds, placement.presentation, source[side]);
          }
        }
      }
    }
  }
  assert.deepEqual([...directions].sort(), ['down', 'left', 'right', 'up']);
});

test('browser placement carries the same source gradient for lateral and top/bottom fallback blades', () => {
  const directions = new Set();
  for (const orientation of ['horizontal', 'vertical']) {
    for (const scale of [.65, 1, 1.8]) {
      for (const anchor of ['center', 'top-left', 'top-right', 'bottom-left', 'bottom-right']) {
        const area = { x: 0, y: 0, width: 1920, height: 1000 };
        const alignment = geometry.contentAlignmentForAnchor(anchor);
        const bounds = geometry.anchorBounds(anchor, geometry.widgetSize(scale, orientation, area), area);
        const source = renderedPanels(bounds, orientation, alignment, true);
        for (const side of ['away', 'home']) {
          const placement = placeDetailsBlade({ points: source[side], lowerEdge: source.lowerEdge, belowStatus: source.belowStatus, orientation, teamColor: teamColor(game[side], side) }, side, area);
          directions.add(placement.presentation.direction);
          assertContinuation(placement, placement.presentation, source[side]);
        }
      }
    }
  }
  assert.deepEqual([...directions].sort(), ['down', 'left', 'right', 'up']);
});

test('top-corner downward necks leave delayed/sample badges visible and retain room for six stats', () => {
  for (const scale of [.65, 1, 1.8]) {
    for (const [anchor, side] of [['top-left', 'away'], ['top-right', 'home']]) {
      const area = { x: 0, y: 0, width: 1920, height: 1000 };
      const bounds = geometry.anchorBounds(anchor, geometry.widgetSize(scale, 'horizontal', area), area);
      for (const [stale, demo] of [[true, false], [false, true]]) {
        const source = renderedPanels(bounds, 'horizontal', 'top', stale, demo);
        const native = geometry.detailsPlacement(bounds, area, { side, contentAlignment: 'top' });
        const browser = placeDetailsBlade({ points: source[side], lowerEdge: source.lowerEdge, belowStatus: source.belowStatus, orientation: 'horizontal' }, side, area);
        for (const { bounds: frame, presentation } of [native, { bounds: browser, presentation: browser.presentation }]) {
          assert.equal(presentation.direction, 'down');
          const outline = bladeOutline(frame.width, frame.height, presentation);
          const points = [...outline.path.matchAll(/[ML]([\d.-]+) ([\d.-]+)/g)].map(([, x, y]) => ({ x: frame.x + Number(x), y: frame.y + Number(y) }));
          assert.ok(frame.y + outline.connector.end > source.badge.y + source.badge.height + 2, 'the wide body begins after the whole flag');
          for (let y = source.badge.y; y <= source.badge.y + source.badge.height; y += .5) {
            const crossings = [];
            for (let i = 0; i < points.length; i++) {
              const a = points[i], b = points[(i + 1) % points.length];
              if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) crossings.push(a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y));
            }
            crossings.sort((a, b) => a - b);
            for (let i = 0; i < crossings.length; i += 2) assert.ok(crossings[i + 1] <= source.badge.x || crossings[i] >= source.badge.x + source.badge.width, 'no part of the blade may cover the badge');
          }
          const bodyHeight = frame.height - outline.inset.top - outline.inset.bottom;
          assert.ok(bodyHeight >= 24 + 90 + 17 + 24 + 9, 'header, six actual 30px stat rows in two columns, field and latest play still fit');
        }
      }
    }
  }
});

test('only downward necks blend the information strip bottom into the continued team fill', () => {
  const markup = renderScorebug(game, { idPrefix: 'gradient-test' });
  const strip = /<linearGradient id="gradient-test-strip"[^>]*>(.*?)<\/linearGradient>/.exec(markup)[1];
  const stripBottom = [...strip.matchAll(/stop-color="([^"]+)"/g)].at(-1)[1];
  const down = bladeOutline(284, 216, { direction: 'down', joinY: 1.5, neckHeight: 46 });
  assert.equal(down.connector.color, stripBottom);
  assert.equal(down.connector.start, 1.5);
  assert.equal(down.connector.end, down.inset.top - 9);
  assert.ok(down.connector.end >= 47.5, 'the blend ends with the extended neck');
  for (const direction of ['left', 'right', 'up']) assert.equal(bladeOutline(284, 216, { direction }).connector, null);
});

test('only the outer blade perimeter gets a metal stroke in every opening direction', () => {
  const parse = (path) => [...path.matchAll(/[ML]([\d.-]+) ([\d.-]+)/g)].map(([, x, y]) => [Number(x), Number(y)]);
  for (const direction of ['left', 'right', 'up', 'down']) {
    const outline = bladeOutline(284, 216, { direction, joinTop: 50, joinBottom: 130, joinTopX: direction === 'left' ? 280 : 15, joinBottomX: direction === 'left' ? 265 : 1, joinLeft: 60, joinRight: 220, joinY: direction === 'up' ? 215 : 1 });
    assert.ok(outline.path.endsWith('Z'), 'the gradient fill stays closed');
    assert.ok(!outline.borderPath.endsWith('Z'), 'the join has no second outline');
    const fill = parse(outline.path), border = parse(outline.borderPath);
    assert.equal(fill.length, border.length, 'all external corners keep their bevel');
    const expectedJoin = direction === 'up' ? [fill[5], fill[4]] : direction === 'down' ? [fill[1], fill[0]] : [fill[0], fill.at(-1)];
    assert.deepEqual([border[0], border.at(-1)], expectedJoin);
  }
});

test('gradient transforms preserve nonuniform source scaling and standalone fallback stays finite', async () => {
  const source = { gradientX: -230.5, gradientY: 63.25, gradientWidth: 249.48, gradientHeight: 70.56 };
  assert.equal(bladeGradientSpace(284, 216, source).transform, 'translate(-230.5 63.25) scale(249.48 70.56)');
  for (const invalid of [{}, { ...source, gradientHeight: 0 }, { ...source, gradientX: NaN }]) {
    assert.equal(bladeGradientSpace(284, 216, invalid).transform, 'translate(0 0) scale(284 216)');
  }
  const markup = await readFile(new URL('../public/details.html', import.meta.url), 'utf8');
  assert.match(markup, /id="blade-outline" fill="url\(#blade-fill\)"\/>/);
  assert.match(markup, /id="blade-border" fill="none" stroke="url\(#blade-bevel\)"/);
  const css = await readFile(new URL('../public/details.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /stop-color\s*:/, 'CSS must not override the source SVG stop colors');
});
