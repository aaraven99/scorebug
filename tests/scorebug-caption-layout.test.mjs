import test from 'node:test';
import assert from 'node:assert/strict';
import { renderScorebug } from '../public/scorebug.js';
import { SCOREBUG_STYLES } from '../public/scorebug-styles.js';
import { referenceForLeague } from '../public/sport-fixtures.js';
import { teamLogoPresentation } from '../public/team-assets.js';

const attribute = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]+)"`))?.[1];

test('team captions remain below visible logo artwork in banners, pods and side layouts', () => {
  let checked = 0;
  for (const leagueId of ['nfl', 'nba', 'wnba', 'mlb']) {
    const game = referenceForLeague(leagueId);
    for (const style of SCOREBUG_STYLES) for (const orientation of ['horizontal', 'vertical']) {
      const svg = renderScorebug(game, { styleId: style.id, orientation });
      for (const [, side, body] of svg.matchAll(/<g class="bug-team bug-team--(away|home)"[^>]*>([\s\S]*?)<\/g>/g)) {
        const logo = body.match(/<image\b[^>]*class="bug-team-logo[^>]*>/)?.[0];
        const caption = body.match(/<text\b[^>]*class="variant-text variant-team-abbreviation"[^>]*>/)?.[0];
        if (!logo || !caption) continue;
        const artwork = teamLogoPresentation({ ...game[side], leagueId, sport: game.sport });
        const bottom = Number(attribute(logo, 'y')) + Number(attribute(logo, 'height')) * artwork.bounds[3] / artwork.size[1];
        // An 11px caption can use 12px above its baseline in fallback fonts.
        const captionTop = Number(attribute(caption, 'y')) - 12;
        assert.ok(captionTop - bottom >= 2, `${leagueId}/${style.id}/${orientation}/${side}: logo ends ${bottom}, caption begins ${captionTop}`);
        checked++;
      }
    }
  }
  assert.ok(checked > 200, `Only ${checked} captions were checked`);
});

test('curved basketball BONUS labels stay above their timeout rails', () => {
  for (const leagueId of ['nba', 'wnba', 'cbb', 'wcbb']) {
    const base = referenceForLeague(leagueId);
    const game = { ...base, situation: { ...base.situation, awayBonus: true, homeBonus: true } };
    const svg = renderScorebug(game, { styleId: 'nfl-netflix-christmas' });
    const labels = [...svg.matchAll(/<text[^>]*class="variant-text variant-bonus"[^>]*>/g)].map(match => Number(attribute(match[0], 'y')));
    const rails = [...svg.matchAll(/<g class="variant-timeouts"[^>]*>([\s\S]*?)<\/g>/g)].map(match => Math.min(...[...match[1].matchAll(/<rect\b[^>]*>/g)].map(rect => Number(attribute(rect[0], 'y')))));
    assert.equal(labels.length, 2, leagueId);
    assert.equal(rails.length, 2, leagueId);
    labels.forEach((baseline, index) => assert.ok(baseline + 2 < rails[index], `${leagueId}: BONUS crosses timeout rail`));
  }
});

test('Shield and adapted Blades timeout rectangles stay inside their slanted panels', () => {
  const polygon = path => {
    const tokens = path.match(/[MLHVZ]|-?\d+(?:\.\d+)?/g), points = [];
    let x = 0, y = 0;
    while (tokens.length) {
      const command = tokens.shift();
      if (command === 'M' || command === 'L') { x = Number(tokens.shift()); y = Number(tokens.shift()); }
      else if (command === 'H') x = Number(tokens.shift());
      else if (command === 'V') y = Number(tokens.shift());
      else if (command === 'Z') break;
      else assert.fail(`Unexpected panel path command: ${command}`);
      points.push([x, y]);
    }
    return points;
  };
  const contains = (points, x, y) => {
    const crosses = points.map(([a, b], index) => {
      const [c, d] = points[(index + 1) % points.length];
      return (c - a) * (y - b) - (d - b) * (x - a);
    });
    return crosses.every(value => value >= -.001) || crosses.every(value => value <= .001);
  };
  for (const leagueId of ['nba', 'wnba', 'ncaavb']) for (const styleId of ['nfl-tnf-shield', 'nfl-blades']) for (const orientation of ['horizontal', 'vertical']) {
    const game = referenceForLeague(leagueId), count = game.sport === 'basketball' ? 7 : 2;
    for (const side of ['away', 'home']) game[side] = { ...game[side], timeouts: count, maxTimeouts: count };
    const svg = renderScorebug(game, { styleId, orientation });
    const panels = [...svg.matchAll(/<path class="bug-team-panel" d="([^"]+)"/g)].map(match => polygon(match[1]));
    const rails = [...svg.matchAll(/<g class="variant-timeouts"[^>]*>([\s\S]*?)<\/g>/g)];
    assert.equal(panels.length, 2); assert.equal(rails.length, 2);
    rails.forEach((rail, index) => {
      for (const [rect] of rail[1].matchAll(/<rect\b[^>]*>/g)) {
        const x = Number(attribute(rect, 'x')), y = Number(attribute(rect, 'y'));
        const width = Number(attribute(rect, 'width')), height = Number(attribute(rect, 'height'));
        for (const [px, py] of [[x, y], [x + width, y], [x, y + height], [x + width, y + height]]) {
          assert.ok(contains(panels[index], px, py), `${leagueId}/${styleId}/${orientation}/${index}: timeout corner ${px}, ${py} escapes panel`);
        }
      }
    });
  }
});
