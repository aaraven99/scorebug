import test from 'node:test';
import assert from 'node:assert/strict';
import { SCOREBUG_STYLES } from '../public/scorebug-styles.js';
import { filterScorebugStyles, styleOptionGroups, toggleFavoriteStyleIds } from '../public/style-favorites.js';

test('saving and removing styles keeps their order and does not mutate the saved list', () => {
  const original = Object.freeze(['nfl-blades', 'f1-rounded-tower']);
  assert.deepEqual(toggleFavoriteStyleIds(original, 'nba-nbc-pods'), ['nfl-blades', 'f1-rounded-tower', 'nba-nbc-pods']);
  assert.deepEqual(toggleFavoriteStyleIds(original, 'nfl-blades'), ['f1-rounded-tower']);
  assert.deepEqual(toggleFavoriteStyleIds(original, 'unknown-look'), original);
  assert.deepEqual(original, ['nfl-blades', 'f1-rounded-tower']);
  assert.deepEqual(toggleFavoriteStyleIds(['unknown-look', 'nfl-blades', 'nfl-blades'], 'f1-rounded-tower'), original);
});

test('favorite styles move to the first selector group without duplicating or dropping any style', () => {
  const favoriteIds = ['f1-rounded-tower', 'nba-nbc-pods', 'nfl-blades'];
  const groups = styleOptionGroups(favoriteIds), values = groups.flatMap(group => group.styles.map(style => style.id));
  assert.equal(groups[0].label, 'Favorite styles');
  assert.deepEqual(groups[0].styles.map(style => style.id), favoriteIds);
  assert.equal(values.length, SCOREBUG_STYLES.length);
  assert.equal(new Set(values).size, SCOREBUG_STYLES.length);
  assert.deepEqual(new Set(values), new Set(SCOREBUG_STYLES.map(style => style.id)));
  assert.ok(groups.every(group => group.styles.length > 0));
  assert.equal(styleOptionGroups([]).some(group => group.id === 'favorites'), false);
});

test('all styles can be saved and still appear exactly once in the selector', () => {
  const ids = SCOREBUG_STYLES.map(style => style.id), groups = styleOptionGroups(ids);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].styles.map(style => style.id), ids);
  assert.equal(filterScorebugStyles({favoriteStyleIds:ids,favoritesOnly:true}).length, ids.length);
});

test('gallery favorites, sport and search filters intersect without changing saved styles', () => {
  const favoriteStyleIds = Object.freeze(['nfl-blades', 'nba-nbc-pods', 'f1-rounded-tower']);
  assert.deepEqual(filterScorebugStyles({ favoriteStyleIds, favoritesOnly:true, allSports:false, sport:'basketball' }).map(style => style.id), ['nba-nbc-pods']);
  assert.deepEqual(filterScorebugStyles({ favoriteStyleIds, favoritesOnly:true, allSports:true, sport:'basketball', query:'  FOX blades  ' }).map(style => style.id), ['nfl-blades']);
  assert.deepEqual(filterScorebugStyles({ favoriteStyleIds, favoritesOnly:true, allSports:false, sport:'basketball', query:'Blades' }), []);
  assert.equal(filterScorebugStyles({ favoriteStyleIds, favoritesOnly:false }).length, SCOREBUG_STYLES.length);
  assert.deepEqual(favoriteStyleIds, ['nfl-blades', 'nba-nbc-pods', 'f1-rounded-tower']);
});

test('empty and invalid saved lists never masquerade as the default style', () => {
  assert.deepEqual(filterScorebugStyles({ favoriteStyleIds:['missing-style', null, 1], favoritesOnly:true }), []);
  assert.deepEqual(filterScorebugStyles({ favoritesOnly:true }), []);
  assert.deepEqual(toggleFavoriteStyleIds(null, 'missing-style'), []);
  assert.equal(styleOptionGroups(['missing-style']).some(group => group.id === 'favorites'), false);
});
