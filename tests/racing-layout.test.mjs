import test from 'node:test';
import assert from 'node:assert/strict';
import { renderScorebug, scorebugDimensions, SCOREBUG_DIMENSIONS } from '../public/scorebug.js';
import { normalizePreferencePatch, normalizeRacingRows, DEFAULT_RACING_ROWS, MIN_RACING_ROWS, MAX_RACING_ROWS } from '../public/preferences-model.js';
import { referenceForLeague } from '../public/sport-fixtures.js';
import { fitScorebugWidth } from '../public/scorebug-layout.js';

const race = {
  ...referenceForLeague('f1'),
  entries: Array.from({length: 22}, (_, i) => ({
    id: `f1:driver-${i + 1}`, position: i + 1, name: `Driver ${i + 1}`, abbreviation: `D${i + 1}`,
    team: {color: i % 2 ? '#e80020' : '#ff8700'}, gap: i ? `+${(i * 1.234).toFixed(3)}` : 'LEADER',
  })),
};
const rows = svg => [...svg.matchAll(/class="variant-classification-row"[^>]*data-entry-id="([^"]*)"[^>]*data-row-index="(\d+)"[^>]*data-row-x="([\d.]+)"[^>]*data-row-y="([\d.]+)"/g)]
  .map(([, id, index, x, y]) => ({id, index: Number(index), x: Number(x), y: Number(y)}));

test('racing row preferences are bounded, numeric and shared by renderer and settings', () => {
  assert.equal(DEFAULT_RACING_ROWS, 6);
  assert.equal(MIN_RACING_ROWS, 3);
  assert.ok(MAX_RACING_ROWS >= 22);
  for (const value of [3, 6, 20, 22, 40, 60]) {
    assert.equal(normalizePreferencePatch({racingRows: value}).racingRows, value);
    assert.equal(normalizeRacingRows(value), value);
  }
  assert.equal(normalizePreferencePatch({racingRows: 2}).racingRows, 3);
  assert.equal(normalizePreferencePatch({racingRows: 500}).racingRows, MAX_RACING_ROWS);
  assert.equal(normalizePreferencePatch({racingRows: 8.8}).racingRows, 9);
  for (const value of [null, undefined, '22', NaN, Infinity, {}, []]) {
    assert.equal(Object.hasOwn(normalizePreferencePatch({racingRows: value}), 'racingRows'), false);
    assert.equal(normalizeRacingRows(value), DEFAULT_RACING_ROWS);
  }
  assert.deepEqual(normalizePreferencePatch({styleAuto: false, styleId: 'nfl-blades'}), {styleAuto: false, styleId: 'nfl-blades'});
  assert.equal(normalizePreferencePatch({styleAuto: true}).styleAuto, true);
  assert.equal(Object.hasOwn(normalizePreferencePatch({styleAuto: 'false'}), 'styleAuto'), false);
});

test('a full 22-driver grid grows in height with fixed row spacing and preserves every reported entry', () => {
  for (const orientation of ['horizontal', 'vertical']) for (const racingRows of [3, 6, 9, 20, 22]) {
    const options = {orientation, racingRows, styleId: 'f1-rounded-tower'}, dimensions = scorebugDimensions(race, options);
    const svg = renderScorebug(race, options), rendered = rows(svg);
    assert.equal(rendered.length, racingRows);
    assert.deepEqual(rendered.map(row => row.id), race.entries.slice(0, racingRows).map(entry => entry.id));
    assert.match(svg, new RegExp(`viewBox="0 0 ${dimensions.width} ${dimensions.height}"`));
    assert.match(svg, new RegExp(`data-artwork-height="${dimensions.height}"`));
    assert.match(svg, new RegExp(`data-racing-rows="${racingRows}"`));
    assert.equal(dimensions.rowHeight, orientation === 'vertical' ? 24 : 28);
    for (const x of new Set(rendered.map(row => row.x))) {
      const column = rendered.filter(row => row.x === x);
      for (let i = 1; i < column.length; i++) assert.equal(column[i].y - column[i - 1].y, dimensions.rowHeight);
      assert.ok(column.at(-1).y + dimensions.rowHeight < dimensions.height - dimensions.footerHeight + 1);
    }
    assert.match(svg, orientation === 'vertical' ? /font-size:13px[^>]*>D1<\/text>/ : /font-size:14px[^>]*>Driver 1<\/text>/);
    if (orientation === 'vertical') assert.match(svg, /font-size:11px[^>]*>LEADER<\/text>/);
    assert.equal((svg.match(/data-details-side="comparison"/g) || []).length, 1);
    assert.doesNotMatch(svg, /data-team-side=|data-details-side="(?:away|home)"|NaN|undefined/);
  }
});

test('missing classifications never invent drivers or move a pinned window between updates', () => {
  for (const orientation of ['horizontal', 'vertical']) {
    const options = {orientation, racingRows: 22, styleId: 'f1-2026-tower'}, expected = scorebugDimensions(race, options);
    for (const entries of [[], race.entries.slice(0, 4), race.entries]) {
      const game = {...race, entries}, svg = renderScorebug(game, options);
      assert.deepEqual(scorebugDimensions(game, options), expected);
      assert.equal(rows(svg).length, entries.length);
      assert.match(svg, new RegExp(`viewBox="0 0 ${expected.width} ${expected.height}"`));
      if (!entries.length) assert.match(svg, /Classification unavailable|Classification available when reported/);
    }
    assert.deepEqual(scorebugDimensions({leagueId:'f1', sport:'racing', kind:'race'}, options), expected);
  }
});

test('dynamic race bounds include top or bottom source badges without altering row geometry', () => {
  for (const orientation of ['horizontal', 'vertical']) for (const statusPosition of ['above', 'below']) {
    const options = {orientation, racingRows: 22, statusPosition, stale: true, styleId: 'f1-classic-yellow'};
    const dimensions = scorebugDimensions(race, options), svg = renderScorebug(race, options);
    const top = statusPosition === 'below' ? 0 : -dimensions.statusHeight;
    assert.match(svg, new RegExp(`viewBox="0 ${top} ${dimensions.width} ${dimensions.height + dimensions.statusHeight}"`));
    assert.match(svg, /FEED DELAYED/);
    assert.equal(rows(svg).length, 22);
  }
  const huge = {...race, entries: Array.from({length:100}, (_, i) => ({...race.entries[0], id:`f1:${i}`}))};
  assert.equal(rows(renderScorebug(huge, {racingRows: 1000})).length, MAX_RACING_ROWS);
});

test('OS-clamped browser windows fit the entire F1 grid by scaling its host without changing preferences', () => {
  for (const racingRows of [20,22,60]) for (const orientation of ['horizontal','vertical']) for (const scale of [.65,1,1.8]) {
    const preferences = Object.freeze({racingRows,orientation,scale});
    const dimensions = scorebugDimensions(race, preferences);
    const requestedWidth = Math.round((orientation === 'vertical' ? 160 : 520) * scale);
    const availableWidth = requestedWidth - 16;
    const availableHeight = 672 - (orientation === 'vertical' ? 64 : 39);
    const width = fitScorebugWidth(dimensions, {availableWidth,availableHeight});
    assert.ok(width <= availableWidth);
    assert.ok(width * (dimensions.height + dimensions.statusHeight) / dimensions.width <= availableHeight + .000001);
    assert.equal(preferences.scale, scale);
    assert.equal(preferences.racingRows, racingRows);
    const restored = fitScorebugWidth(dimensions, {availableWidth,availableHeight:10000});
    assert.equal(restored, availableWidth, 'expanding the window restores the requested width without a preference write');
  }
  assert.equal(fitScorebugWidth(scorebugDimensions(race,{orientation:'vertical',racingRows:22}), {availableWidth:272,availableHeight:608}), 608*160/623);
});

test('choosing distinct NFL styles for NBA preserves the selected geometry and basketball information', () => {
  const base = referenceForLeague('nba');
  const game = {...base, period:4, clock:'10.3', situation:{shotClock:9}, possessionTeamId:base.away.id,
    away:{...base.away, score:107, timeouts:2, maxTimeouts:7}, home:{...base.home, score:109, timeouts:1, maxTimeouts:7}};
  const styles = ['nfl-blades', 'nfl-cbs-eyebar', 'nfl-nbc-pods', 'nfl-foxbox'];
  for (const orientation of ['horizontal','vertical']) {
    const paths = [];
    for (const styleId of styles) {
      const svg = renderScorebug(game, {styleId, orientation});
      assert.match(svg, new RegExp(`data-style-id="${styleId}"`));
      assert.match(svg, /data-sport="basketball"/);
      assert.match(svg, /data-league-id="nba"/);
      assert.match(svg, /bug-possession--basketball/);
      assert.match(svg, />10\.3<\/text>/);
      assert.match(svg, />9 SHOT<\/text>/);
      assert.match(svg, />107<\/text>/);
      assert.match(svg, />109<\/text>/);
      assert.doesNotMatch(svg, /DOWN|bug-possession--football|BALL [A-Z]+ \d/);
      assert.deepEqual(scorebugDimensions(game, {orientation, racingRows:22}), SCOREBUG_DIMENSIONS[orientation]);
      paths.push(svg.match(/class="bug-team-panel" d="([^"]+)"/)[1]);
    }
    assert.equal(new Set(paths).size, styles.length, `${orientation} styles must have distinct visible panel geometry`);
  }
});
