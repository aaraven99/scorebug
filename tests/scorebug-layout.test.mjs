import test from 'node:test';
import assert from 'node:assert/strict';
import { renderScorebug, SCOREBUG_DIMENSIONS, teamPalette } from '../public/scorebug.js';
import { referenceGame } from '../public/fixtures.js';
import { canonicalNFLTeam, NFL_TEAMS } from '../lib/thescore.mjs';

function geometry(markup) {
  return [...markup.matchAll(/<(?:path|image|text|g) class="(?:bug-team-panel|bug-situation-panel|bug-team-logo|bug-score|bug-possession|bug-team-contents)[^"]*"[^>]*>/g)].map(([tag]) => tag);
}

test('moving a status badge below leaves team, possession and information-strip geometry unchanged', () => {
  for (const [orientation, dimensions] of Object.entries(SCOREBUG_DIMENSIONS)) {
    const { width, height, statusHeight: badgeHeight } = dimensions;
    const options = { orientation, idPrefix: 'layout-test' };
    const normal = renderScorebug(referenceGame, options);
    for (const badge of [{ stale: true }, { demo: true }, { stale: true, demo: true }]) {
      const above = renderScorebug(referenceGame, { ...options, ...badge });
      const below = renderScorebug(referenceGame, { ...options, ...badge, statusPosition: 'below' });
      assert.match(above, new RegExp(`viewBox="0 -${badgeHeight} ${width} ${height + badgeHeight}"`));
      assert.match(below, new RegExp(`viewBox="0 0 ${width} ${height + badgeHeight}"`));
      assert.match(below, /data-status-position="below"/);
      assert.match(below, new RegExp(`class="bug-status-flag" transform="translate\\(0 ${height + badgeHeight}\\)"`));
      assert.deepEqual(geometry(below), geometry(normal));
      assert.deepEqual(geometry(above), geometry(normal));
      assert.equal((below.match(/class="bug-status-flag"/g) || []).length, 1);
    }
    const noBadge = renderScorebug(referenceGame, { ...options, statusPosition: 'below' });
    assert.match(noBadge, new RegExp(`viewBox="0 0 ${width} ${height}"`));
    assert.doesNotMatch(noBadge, /class="bug-status-flag"/);
  }
});

function paths(markup, className) {
  return [...markup.matchAll(new RegExp(`<path class="${className}"[^>]*>`, 'g'))]
    .map(([tag]) => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value])));
}

function polygon(path) {
  const tokens = path.match(/[MHLVZ]|-?\d+(?:\.\d+)?/g);
  const points = [];
  let x = 0, y = 0;
  for (let index = 0; index < tokens.length;) {
    const command = tokens[index++];
    if (command === 'M' || command === 'L') [x, y] = [Number(tokens[index++]), Number(tokens[index++])];
    else if (command === 'H') x = Number(tokens[index++]);
    else if (command === 'V') y = Number(tokens[index++]);
    else if (command === 'Z') break;
    else assert.fail(`Unsupported polygon command: ${command}`);
    points.push([x, y]);
  }
  return points;
}

function near(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < .00001, `${label}: ${actual} differs from ${expected}`);
}

function edgeAt(first, second, y) {
  return first[0] + (second[0] - first[0]) * (y - first[1]) / (second[1] - first[1]);
}

test('the dark strip continues the team-panel edges without a new angle or protruding corner', () => {
  for (const orientation of Object.keys(SCOREBUG_DIMENSIONS)) {
    const markup = renderScorebug(referenceGame, { orientation });
    const panels = paths(markup, 'bug-team-panel').map(({ d }) => polygon(d));
    const [strip] = paths(markup, 'bug-situation-panel').map(({ d }) => polygon(d));
    const slope = orientation === 'vertical' ? 1 / 12 : 3 / 14;
    for (const [topLeft, topRight, bottomRight, bottomLeft] of [...panels, strip]) {
      near((topLeft[0] - bottomLeft[0]) / (bottomLeft[1] - topLeft[1]), slope, `${orientation} left slope`);
      near((topRight[0] - bottomRight[0]) / (bottomRight[1] - topRight[1]), slope, `${orientation} right slope`);
    }
    const leftPanel = orientation === 'vertical' ? panels[1] : panels[0];
    const rightPanel = panels[1];
    for (const point of [strip[0], strip[3]]) near(point[0], edgeAt(leftPanel[0], leftPanel[3], point[1]), `${orientation} left edge`);
    for (const point of [strip[1], strip[2]]) near(point[0], edgeAt(rightPanel[1], rightPanel[2], point[1]), `${orientation} right edge`);
    assert.equal(strip[0][1] - rightPanel[3][1], 5, 'the separating gap stays even');
  }
});

test('the side view is compact while retaining a dedicated panel for each team and game situation', () => {
  const { width, height } = SCOREBUG_DIMENSIONS.vertical;
  assert.equal(width, 160);
  assert.ok(height <= 348 * .85, 'side view must be at least 15% shorter than the previous layout');
  const markup = renderScorebug(referenceGame, { orientation: 'vertical' });
  const panels = paths(markup, 'bug-team-panel').map(({ d }) => polygon(d));
  for (const [topLeft, , , bottomLeft] of panels) assert.equal(bottomLeft[1] - topLeft[1], 96);
  assert.equal(panels[1][0][1] - panels[0][3][1], 7);
  const [strip] = paths(markup, 'bug-situation-panel').map(({ d }) => polygon(d));
  assert.equal(strip[3][1] + 2, height, 'the exported height matches the painted strip and its bottom margin');
  assert.match(markup, /class="bug-vertical-clock"/);
  assert.match(markup, /class="bug-vertical-down/);
  assert.match(markup, /class="bug-vertical-field"/);
});

function luminance(hex) {
  const [red, green, blue] = hex.slice(1).match(/../g).map((part) => {
    const channel = parseInt(part, 16) / 255;
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  });
  return red * .2126 + green * .7152 + blue * .0722;
}

test('all 32 teams use their solid palette, a darker outline, and readable text for expanded stats', () => {
  assert.equal(Object.keys(NFL_TEAMS).length, 32);
  for (const abbreviation of Object.keys(NFL_TEAMS)) {
    const team = canonicalNFLTeam(abbreviation);
    for (const orientation of Object.keys(SCOREBUG_DIMENSIONS)) {
      const markup = renderScorebug({ ...referenceGame, away: team, home: team }, { orientation });
      const panels = paths(markup, 'bug-team-panel');
      for (const [index, side] of ['away', 'home'].entries()) {
        const { fill, border, ink } = teamPalette(team, side);
        assert.equal(panels[index].fill, fill, `${abbreviation} ${side} fill`);
        assert.equal(panels[index].stroke, border, `${abbreviation} ${side} border`);
        const background = luminance(fill), foreground = luminance(ink);
        if (background > 0) assert.ok(luminance(border) < background, `${abbreviation} has a darker team-colored outline`);
        else assert.equal(border, fill, 'a black team retains its black outline');
        const contrast = (Math.max(background, foreground) + .05) / (Math.min(background, foreground) + .05);
        assert.ok(contrast >= 4.5, `${abbreviation} small-text contrast is ${contrast.toFixed(2)}`);
      }
      assert.doesNotMatch(markup, /class="(?:bug-team-panel|bug-situation-panel)"[^>]*fill="url\(/);
      assert.doesNotMatch(markup, /id="[^"]+-(?:away|home|bevel|strip)"/);
      assert.match(markup, /data-team-fill="#[a-f\d]{6}" data-team-border="#[a-f\d]{6}" data-team-ink="#[a-f\d]{6}"/i);
    }
  }
  assert.equal(teamPalette(canonicalNFLTeam('SF'), 'away').fill, '#b3995d');
  assert.equal(teamPalette(canonicalNFLTeam('KC'), 'home').fill, '#e31837');
});

function detailsTargets(markup) {
  return [...markup.matchAll(/<g class="bug-details-target[^>]*data-details-side="([^"]+)"[^>]*>([\s\S]*?)<\/g>/g)]
    .map(([tag, side, contents]) => ({ side, tag, regions: paths(contents, 'bug-hover-region').map(({ d }) => polygon(d)) }));
}

function contains(points, [x, y]) {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const [xi, yi] = points[index], [xj, yj] = points[previous];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

test('only the logo/timeout areas and the clock are semantic details targets', () => {
  const hitCases = {
    horizontal: {
      away: [[110, 46], [23, 50]],
      home: [[488, 46], [579, 50]],
      comparison: [[292, 112]],
      none: [[241, 46], [349, 46], [185, 46], [413, 46], [215, 15], [34, 112], [167, 115], [510, 112]],
    },
    vertical: {
      away: [[86, 22], [17, 50]],
      home: [[86, 125], [150, 153]],
      comparison: [[76, 240]],
      none: [[80, 78], [80, 181], [84, 50], [84, 153], [80, 60], [76, 218], [76, 263], [76, 280]],
    },
  };
  for (const [orientation, cases] of Object.entries(hitCases)) {
    const markup = renderScorebug(referenceGame, { orientation });
    const targets = detailsTargets(markup);
    assert.deepEqual(targets.map(({ side }) => side), ['away', 'home', 'comparison']);
    assert.equal((markup.match(/role="button"/g) || []).length, 3);
    for (const { tag } of targets) {
      assert.match(tag, /role="button" tabindex="0" aria-label="[^"]+"/);
      assert.match(tag, /aria-haspopup="dialog" aria-expanded="false"/);
    }
    for (const [group] of markup.matchAll(/<g class="bug-team bug-team--[^>]*>/g)) assert.doesNotMatch(group, /role=|tabindex=/);
    for (const [side, points] of Object.entries(cases)) {
      for (const point of points) {
        const hit = targets.find(({ regions }) => regions.some((region) => contains(region, point)))?.side || 'none';
        assert.equal(hit, side, `${orientation}: ${point} should target ${side}`);
      }
    }
    const passive = renderScorebug(referenceGame, { orientation, interactive: false });
    assert.doesNotMatch(passive, /data-details-side=|role="button"|tabindex=/);
    assert.equal((passive.match(/data-team-side=/g) || []).length, 2, 'passive views keep paint/geometry anchors');
  }
});
