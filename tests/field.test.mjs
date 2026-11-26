import test from 'node:test';
import assert from 'node:assert/strict';
import { fieldSituation, renderField } from '../public/field.js';

function game(overrides = {}) {
  return {
    phase: 'live',
    away: { id: '3', abbreviation: 'CHI' },
    home: { id: '8', abbreviation: 'DET' },
    possessionTeamId: '3',
    fieldPosition: 'CHI 25',
    downDistance: '1st & 10',
    ...overrides,
  };
}

test('own-territory field position measures progress from the offense end zone', () => {
  for (const fieldPosition of ['CHI 25', 'CHI25', 'chi 25']) {
    const result = fieldSituation(game({ fieldPosition }));
    assert.equal(result.offense.abbreviation, 'CHI');
    assert.equal(result.defense.abbreviation, 'DET');
    assert.equal(result.progress, 25);
    assert.equal(result.firstDown, 35);
  }
});

test('opponent territory and possession changes preserve the schematic attack direction', () => {
  const bears = fieldSituation(game({ fieldPosition: 'DET 38', downDistance: '2nd & 4' }));
  assert.equal(bears.progress, 62);
  assert.equal(bears.firstDown, 66);

  const lions = fieldSituation(game({ possessionTeamId: '8', fieldPosition: 'CHI 38', downDistance: '2nd & 4' }));
  assert.equal(lions.offense.abbreviation, 'DET');
  assert.equal(lions.defense.abbreviation, 'CHI');
  assert.equal(lions.progress, 62);
  assert.equal(lions.firstDown, 66);

  const ownLions = fieldSituation(game({ possessionTeamId: '8', fieldPosition: 'DET 38' }));
  assert.equal(ownLions.progress, 38);
});

test('midfield labels all place the ball halfway down the field', () => {
  for (const fieldPosition of ['50', '50 LINE', '50 YD LINE', '50 YARD LINE', 'midfield', 'CHI 50', 'DET50']) {
    const result = fieldSituation(game({ fieldPosition }));
    assert.ok(result, fieldPosition);
    assert.equal(result.progress, 50, fieldPosition);
    assert.equal(result.firstDown, 60, fieldPosition);
  }
});

test('goal to go ends at the goal line, and missing distance does not invent a first-down line', () => {
  for (const downDistance of ['1st & Goal', '3rd & GOAL']) {
    const result = fieldSituation(game({ fieldPosition: 'DET 7', downDistance }));
    assert.equal(result.progress, 93);
    assert.equal(result.firstDown, 100);
  }
  assert.equal(fieldSituation(game({ fieldPosition: 'DET 3', downDistance: '1st & 10' })).firstDown, 100);
  for (const downDistance of [null, undefined, '', 'Pending next down']) {
    const input = game({ downDistance });
    assert.equal(fieldSituation(input).firstDown, null);
    assert.doesNotMatch(renderField(input), /stroke="#eac15b"/);
  }
});

test('unreported, mismatched, malformed and out-of-range positions never fabricate a field location', () => {
  for (const fieldPosition of [null, undefined, '', ' ', 'GB 20', 'CHI 51', 'DET 99', 'CHI -2', 'CHI 10.5', 'somewhere', 'CHI 20<script>']) {
    const input = game({ fieldPosition });
    assert.equal(fieldSituation(input), null, String(fieldPosition));
    const html = renderField(input);
    assert.match(html, /Waiting for a reported ball position\./);
    assert.doesNotMatch(html, /<svg|<circle/);
  }
  assert.equal(fieldSituation(null), null);
  assert.equal(fieldSituation(game({ possessionTeamId: null })), null);
  assert.equal(fieldSituation(game({ possessionTeamId: '999' })), null);
  assert.doesNotMatch(renderField(null), /<svg|<circle/);
});

test('halftime and non-live phases hide any retained old field position', () => {
  for (const phase of ['halftime', 'intermission', 'scheduled', 'final', 'delayed', 'suspended', 'postponed', 'canceled', 'unknown']) {
    const input = game({ phase });
    assert.equal(fieldSituation(input), null, phase);
    assert.doesNotMatch(renderField(input), /<svg|<circle/, phase);
  }
  assert.match(renderField(game({ phase: 'halftime' })), /HALFTIME/);
  assert.match(renderField(game({ phase: 'halftime' })), /Field position returns when play resumes\./);
});

test('known NFL abbreviation aliases match in either the feed or the team metadata', () => {
  for (const [legacy, canonical] of [['WAS', 'WSH'], ['JAC', 'JAX'], ['LA', 'LAR']]) {
    for (const [teamName, positionName] of [[legacy, canonical], [canonical, legacy]]) {
      const own = game({ away: { id: '3', abbreviation: teamName }, fieldPosition: `${positionName} 23` });
      assert.equal(fieldSituation(own).progress, 23, `${teamName}/${positionName} own territory`);
      const opponent = game({ home: { id: '8', abbreviation: teamName }, fieldPosition: `${positionName} 23` });
      assert.equal(fieldSituation(opponent).progress, 77, `${teamName}/${positionName} opponent territory`);
    }
  }
});

test('field rendering labels the diagram as a schematic and escapes team labels in SVG and attributes', () => {
  const normal = renderField(game());
  assert.match(normal, /role="img"/);
  assert.match(normal, /aria-label="CHI ball at CHI 25; schematic shows offense moving right"/);
  assert.match(normal, /<circle[^>]*cx="115\.5"/);
  assert.match(normal, /stroke="#eac15b"/);

  const html = renderField(game({
    fieldPosition: '50',
    away: { id: '3', abbreviation: 'CHI"><svg onload="alert(1)"> &' },
    home: { id: '8', abbreviation: 'DET</text><script>alert(1)</script>' },
  }));
  assert.match(html, /CHI&quot;&gt;&lt;svg onload=&quot;alert\(1\)&quot;&gt; &amp;/);
  assert.match(html, /DET&lt;\/text&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>|<svg onload=|onload="alert/);
  assert.equal((html.match(/<svg\b/g) || []).length, 1);
});
