import test from 'node:test';
import assert from 'node:assert/strict';
import { renderScorebug } from '../public/scorebug.js';
import { referenceGame } from '../public/fixtures.js';

function geometry(markup) {
  return [...markup.matchAll(/<(?:path|image|text|g) class="(?:bug-team-panel|bug-situation-panel|bug-team-logo|bug-score|bug-possession|bug-team-contents)[^"]*"[^>]*>/g)].map(([tag]) => tag);
}

test('moving a status badge below leaves team, possession and information-strip geometry unchanged', () => {
  for (const [orientation, width, height, badgeHeight] of [['horizontal', 600, 138, 24], ['vertical', 160, 348, 19]]) {
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
