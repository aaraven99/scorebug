import test from 'node:test';
import assert from 'node:assert/strict';
import { SCOREBUG_STYLES } from '../public/scorebug-styles.js';
import { LEAGUES } from '../public/sports.js';
import { normalizeFavoriteLeagueIds, normalizeFavoriteStyleIds, normalizePreferencePatch } from '../public/preferences-model.js';

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

test('favorite leagues normalize supported league IDs, deduplicate, and preserve their order',()=>{
  const input=['nba','nfl','nba','unknown','NBA',null,{},42];
  assert.deepEqual(normalizeFavoriteLeagueIds(input),['nba','nfl']);
  assert.deepEqual(normalizeFavoriteLeagueIds(LEAGUES.map(league=>league.id)),LEAGUES.map(league=>league.id));
  for(const value of [undefined,null,{},'nba',42])assert.deepEqual(normalizeFavoriteLeagueIds(value),[]);
  assert.deepEqual(normalizePreferencePatch({favoriteLeagueIds:['nhl','mlb','nhl','invalid']}),{favoriteLeagueIds:['nhl','mlb']});
  assert.deepEqual(normalizePreferencePatch({darkMode:true}),{darkMode:true});
});
