import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeGameDetails } from '../lib/details.mjs';
import { normalizeGame } from '../lib/nfl.mjs';
import { getGameInsights } from '../public/game-insights.js';
import {
  escapeHTML, latestPlayText, comparisonMarkup, insightsMarkup, quarterMarkup,
  playsMarkup, drivesMarkup, playerStatsMarkup, gameInfoMarkup, updateMarkup,
} from '../public/game-view.js';

const captured = JSON.parse(readFileSync(new URL('./fixtures/espn-rich-v130.json', import.meta.url)));
function fixture() {
  const raw = structuredClone(captured.summary);
  const game = normalizeGame({ id: raw.header.id, competitions: raw.header.competitions });
  return { raw, game, summary: normalizeGameDetails(raw) };
}
const count = (html, pattern) => [...html.matchAll(pattern)].length;
const bodyRows = (html) => [...html.matchAll(/<tr(?:\s[^>]*)?><th scope="row"[\s\S]*?<\/tr>/g)].map((match) => match[0]);

test('the official box score renders every player in every category, both teams, all supplied columns and totals', () => {
  const { game, summary } = fixture();
  const html = playerStatsMarkup(summary.playerStats, game);
  const sections = html.match(/<section class="player-category">[\s\S]*?<\/section>/g);
  assert.equal(sections.length, 10);
  for (const [index, group] of summary.playerStats.entries()) {
    const section = sections[index];
    assert.ok(section.includes(`<h3>${escapeHTML(group.label)}</h3>`));
    assert.ok(section.includes(game.away.name)); assert.ok(section.includes(game.home.name));
    for (const column of group.columns) {
      assert.ok(section.includes(`>${escapeHTML(column.label)}</th>`), `${group.key} has ${column.key}`);
      assert.ok(section.includes(`title="${escapeHTML(column.description || column.label)}"`));
    }
    const athletes = [...group.away.athletes, ...group.home.athletes];
    const totals = ['away', 'home'].filter((side) => group[side].totals.some((value) => value !== null)).length;
    const rows = bodyRows(section);
    assert.equal(rows.length, athletes.length + totals, `${group.key} includes every athlete and supplied total`);
    for (const entry of athletes) {
      const row = rows.find((candidate) => candidate.includes(`<th scope="row">${escapeHTML(entry.player.name)}</th>`));
      assert.ok(row, `${entry.player.name} appears in ${group.key}`);
      const values = [...row.matchAll(/<td>([\s\S]*?)<\/td>/g)].map((match) => match[1]);
      assert.deepEqual(values, entry.values.map((value) => value === null ? '—' : escapeHTML(value)), `${entry.player.name}'s values align with the published columns`);
    }
  }
  assert.ok(html.includes('No player totals reported.'), 'An empty team category is explicitly unavailable.');
});

test('the full play and scoring history render independently of the compact three-play and animation windows', () => {
  const { game, summary } = fixture();
  const plays = playsMarkup(summary.playByPlay, game), scores = playsMarkup(summary.scoringPlays, game, { scoring: true });
  assert.equal(count(plays, /data-play-id=/g), 195);
  assert.equal(count(scores, /data-play-id=/g), 13);
  for (const play of summary.playByPlay) {
    assert.ok(plays.includes(`data-play-id="${play.id}"`));
    assert.ok(plays.includes(escapeHTML(play.text)));
  }
  for (const play of summary.scoringPlays) {
    assert.ok(scores.includes(escapeHTML(play.text)));
    assert.ok(scores.includes(`PHI ${play.scores.away} – ${play.scores.home} DAL`));
  }
  assert.ok(plays.indexOf(summary.playByPlay[0].id) < plays.indexOf(summary.playByPlay.at(-1).id));
});

test('drive history renders all 25 drives, historical positions and results without promoting final drives to current', () => {
  const { game, summary } = fixture();
  const html = drivesMarkup(summary.drives, game);
  assert.equal(bodyRows(html).length, 25);
  for (const drive of summary.drives) {
    assert.ok(html.includes(escapeHTML(drive.description)));
    if (drive.result) assert.ok(html.includes(escapeHTML(drive.result)));
    if (drive.start?.fieldPosition) assert.ok(html.includes(escapeHTML(drive.start.fieldPosition)));
  }
  assert.ok(html.includes('DAL 23 → PHI 0'));
  assert.ok(!html.includes('In progress'));
});

test('quarter scores distinguish real zeroes, missing team values, absent totals, and overtime', () => {
  const { game } = fixture();
  const partial = { quarterScores: [{ period: 1, label: 'Q1', away: 0, home: null }, { period: 5, label: 'OT', away: null, home: 3 }] };
  game.away.score = 0; game.home.score = null;
  const html = quarterMarkup(game, partial), rows = bodyRows(html);
  assert.equal(rows.length, 2);
  assert.ok(rows[0].includes('<td>0</td><td>—</td><td><strong>0</strong></td>'));
  assert.ok(rows[1].includes('<td>—</td><td>3</td><td><strong>—</strong></td>'));
  assert.ok(html.includes('>OT</th>'));
  assert.match(quarterMarkup(game, { quarterScores: [] }), /not been reported/);
});

test('comparison markup keeps arithmetic signs true and highlights lower turnovers and penalties correctly', () => {
  const { game, summary } = fixture();
  const data = { ...summary, allTeamStats: [
    { key: 'turnovers', label: 'Turnovers', away: '2', home: '6' },
    { key: 'totalPenaltiesYards', label: 'Penalties', away: '8-86', home: '10-70' },
    { key: 'thirdDownEff', label: 'Third down', away: '3-10', home: '2-5' },
    { key: 'rushingYards', label: 'Rushing', away: null, home: '70' },
  ], teamStats: [] };
  const rows = bodyRows(comparisonMarkup(game, getGameInsights(game, data)));
  const turnovers = rows.find((row) => row.includes('>Turnovers'));
  assert.match(turnovers, /<td class="stat-better">2<\/td><td class="operator" aria-label="less than">&lt;<\/td><td class="">6<\/td>/);
  assert.ok(turnovers.includes('fewer is better'));
  const penalties = rows.find((row) => row.includes('>Penalties'));
  assert.match(penalties, /stat-better">8<\/td>.*less than">&lt;<\/td><td class="">10<\/td>/);
  const penaltyYards = rows.find((row) => row.includes('>Penalty yards'));
  assert.match(penaltyYards, /<td class="">86<\/td>.*greater than">&gt;<\/td><td class="stat-better">70<\/td>/);
  const conversions = rows.find((row) => row.includes('>Third down'));
  assert.match(conversions, /3\/10 · 30%<\/td>.*less than">&lt;<\/td><td class="stat-better">2\/5 · 40%/);
  const unavailable = rows.find((row) => row.includes('>Rushing'));
  assert.match(unavailable, /aria-label="not comparable">—/);
  assert.ok(!unavailable.includes('stat-better'));
});

test('compact comparison preserves six familiar rows while the dashboard includes the complete reported set', () => {
  const { game, summary } = fixture(), insights = getGameInsights(game, summary);
  assert.equal(bodyRows(comparisonMarkup(game, insights, { compact: true })).length, 6);
  assert.equal(bodyRows(comparisonMarkup(game, insights)).length, insights.rows.length);
  assert.ok(insights.rows.length > 20);
});

test('final ties and missing model inputs show explanatory states instead of a fabricated fifty-fifty chance', () => {
  const { game, summary } = fixture();
  game.home.score = game.away.score;
  const tie = insightsMarkup(game, getGameInsights(game, summary));
  assert.ok(tie.includes('<h3>Final result</h3>'));
  assert.ok(tie.includes('Final · tied game'));
  assert.ok(!tie.includes('>50%</strong>'));
  assert.ok(!tie.includes('<h3>Win estimate</h3>'));
  const live = { ...game, phase: 'live', state: 'in', period: 3, clock: null };
  const unavailable = insightsMarkup(live, getGameInsights(live, summary));
  assert.ok(unavailable.includes('Waiting for the quarter and game clock.'));
  assert.ok(!unavailable.includes('>0%</strong>'));
  const stale = insightsMarkup(live, getGameInsights(live, summary, { stale: true }));
  assert.ok(stale.includes('class="delayed">delayed'));
  assert.ok(stale.includes('Waiting for a fresh score and game clock.'));
});

test('published game information renders reported metadata and never guesses a temperature unit', () => {
  const { game, summary } = fixture();
  const html = gameInfoMarkup(game, summary);
  for (const value of ['AT&amp;T Stadium', 'Arlington', 'Fox', '2026', 'Week 12', 'Officials', 'Adrian Hill', 'Referee']) assert.ok(html.includes(value));
  assert.ok(!html.includes('<dt>Weather</dt>'));
  for (const [unit, expected] of [[null, '62 (unit not supplied)'], ['F', '62°F'], ['°F', '62°F'], ['celsius', '62°C']]) {
    const weather = gameInfoMarkup(game, { gameInfo: { weather: { summary: 'Clear', temperature: 62, unit } } });
    assert.ok(weather.includes(expected), `${String(unit)} renders with one explicit unit`);
    assert.ok(!weather.includes('°°'));
  }
});

test('unsafe provider names, labels, attribute values and play text render as text throughout the dashboard', () => {
  const unsafe = '<svg/onload=alert(1)>"&\'>', encoded = '&lt;svg/onload=alert(1)&gt;&quot;&amp;&#39;&gt;';
  const { raw } = fixture();
  raw.header.competitions[0].competitors[0].team.displayName = unsafe;
  raw.boxscore.teams[0].statistics[0].label = unsafe;
  raw.boxscore.teams[0].statistics.find((stat) => stat.name === 'thirdDownEff').label = unsafe;
  const group = raw.boxscore.players[0].statistics[0];
  group.athletes[0].athlete.displayName = unsafe; group.labels[0] = unsafe; group.descriptions[0] = unsafe; group.athletes[0].stats[0] = unsafe;
  raw.drives.previous[0].description = unsafe; raw.drives.previous[0].plays[0].text = unsafe;
  raw.gameInfo.venue.fullName = unsafe; raw.gameInfo.officials[0].displayName = unsafe;
  const game = normalizeGame({ id: raw.header.id, competitions: raw.header.competitions }), summary = normalizeGameDetails(raw);
  const fragments = [
    playerStatsMarkup(summary.playerStats, game), comparisonMarkup(game, getGameInsights(game, summary)),
    insightsMarkup(game, getGameInsights(game, summary)),
    playsMarkup(summary.playByPlay, game), drivesMarkup(summary.drives, game), gameInfoMarkup(game, summary),
    quarterMarkup(game, { quarterScores: [{ label: unsafe, away: 0, home: null }] }),
  ];
  for (const html of fragments) {
    assert.ok(html.includes(encoded));
    assert.ok(!html.includes(unsafe));
    assert.doesNotMatch(html, /<svg[\s/]|<script|<img[^>]+onerror/i);
  }
  const idAttack = playsMarkup([{ id: '\" onmouseover=\"alert(1)', text: unsafe, type: unsafe }], game);
  assert.ok(idAttack.includes('data-play-id="&quot; onmouseover=&quot;alert(1)"'));
  assert.ok(!idAttack.includes('data-play-id="" onmouseover="'));
});

test('latest reported play favors confirmed newer IDs or sequence rather than the most recently fetched summary', () => {
  const game = { lastPlay: 'New scoreboard play', lastPlayDetails: { id: '99999999999999999999', sequenceNumber: 30 } };
  assert.equal(latestPlayText(game, { lastPlay: { id: '99999999999999999998', sequenceNumber: 29, text: 'Old summary play' } }), 'New scoreboard play');
  assert.equal(latestPlayText(game, { lastPlay: { id: '100000000000000000000', sequenceNumber: 31, text: 'New summary play' } }), 'New summary play');
  assert.equal(latestPlayText({ lastPlay: 'Primary', lastPlayDetails: { sequenceNumber: 10 } }, { lastPlay: { sequenceNumber: 11, text: 'Next' } }), 'Next');
  assert.equal(latestPlayText({ lastPlay: '' }, { lastPlay: { text: 'Only available play' } }), 'Only available play');
});

test('an unchanged live section is not rebuilt and changed markup retains its reading position', () => {
  let writes = 0, html = '';
  const element = { scrollTop: 80, scrollLeft: 12, querySelectorAll: () => [],
    set innerHTML(value) { html = value; writes++; this.scrollTop = 0; this.scrollLeft = 0; }, get innerHTML() { return html; } };
  assert.equal(updateMarkup(element, '<p>First</p>'), true);
  assert.equal(element.scrollTop, 80); assert.equal(element.scrollLeft, 12);
  assert.equal(updateMarkup(element, '<p>First</p>'), false); assert.equal(writes, 1);
  assert.equal(updateMarkup(element, '<p>Updated</p>'), true); assert.equal(writes, 2);
  assert.equal(element.scrollTop, 80); assert.equal(element.scrollLeft, 12);
});
