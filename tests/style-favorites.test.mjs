import test from 'node:test';
import assert from 'node:assert/strict';
import { SCOREBUG_STYLES } from '../public/scorebug-styles.js';
import { normalizeFavoriteStyleIds, normalizePreferencePatch } from '../public/preferences-model.js';

test('favorite styles normalize known catalog IDs in saved order without changing the input',()=>{
  const input=Object.freeze(['f1-rounded-tower','nfl-blades','f1-rounded-tower','unknown','NFL-BLADES','nfl-blades ',null,{},42]);
  assert.deepEqual(normalizeFavoriteStyleIds(input),['f1-rounded-tower','nfl-blades']);
  for(const value of [undefined,null,{},'nfl-blades',42])assert.deepEqual(normalizeFavoriteStyleIds(value),[]);
  const all=SCOREBUG_STYLES.map(style=>style.id);
  assert.equal(all.length,83);
  assert.deepEqual(normalizeFavoriteStyleIds([...all,...all]),all,'every catalog style can be saved, with no arbitrary small cap');
});

test('starring scorebug styles is an independent preference patch',()=>{
  assert.deepEqual(normalizePreferencePatch({favoriteStyleIds:['nfl-blades','unknown']}),{favoriteStyleIds:['nfl-blades']});
  assert.deepEqual(normalizePreferencePatch({favoriteStyleIds:[]}),{favoriteStyleIds:[]});
  assert.deepEqual(normalizePreferencePatch({leagueId:'nba',styleId:'nfl-cbs-eyebar',styleAuto:false,racingRows:22}),
    {leagueId:'nba',styleId:'nfl-cbs-eyebar',styleAuto:false,racingRows:22});
});
