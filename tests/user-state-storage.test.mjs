import test from 'node:test';
import assert from 'node:assert/strict';
import {saveUserState} from '../public/user-state-storage.js';
import {saveStandbyState,readStandbyState} from '../public/standby-model.js';

test('Standby saves after cache quota pressure without deleting preferences or favorite styles',()=>{
  const records=new Map([['scorebug.preferences.v2','saved main choices'],['scorebug.favorite-styles.v1','saved style favorites'],['scorebug.favorite-directories.v1','directory cache'],['scorebug.scoreboards.v1','score cache']]);let calls=0;
  const storage={getItem:key=>records.get(key)||null,setItem:(key,value)=>{calls++;if(calls===1)throw Object.assign(new Error('Quota'),{name:'QuotaExceededError'});records.set(key,value);},removeItem:key=>records.delete(key)};
  assert.equal(saveStandbyState(storage,{slots:[{leagueId:'nba',gameId:'nba:qa1',styleId:'nfl-blades'}],dimmed:true}),true);
  assert.equal(readStandbyState(storage).slots[0].gameId,'nba:qa1');assert.equal(readStandbyState(storage).dimmed,true);assert.equal(calls,2);
  assert.equal(records.get('scorebug.preferences.v2'),'saved main choices');assert.equal(records.get('scorebug.favorite-styles.v1'),'saved style favorites');assert.equal(records.has('scorebug.favorite-directories.v1'),false);assert.equal(records.has('scorebug.scoreboards.v1'),false);
});

test('blocked storage stays a visible save failure and never evicts unrelated data',()=>{
  let removed=0,calls=0;const storage={getItem:()=>null,setItem:()=>{calls++;throw Object.assign(new Error('Blocked'),{name:'SecurityError'});},removeItem:()=>removed++};
  assert.equal(saveStandbyState(storage,{slots:[{leagueId:'f1'}]}),false);assert.equal(calls,1);assert.equal(removed,0);assert.equal(saveUserState(null,'key','value'),false);
});

test('a quota failure after the one safe retry remains a failure',()=>{
  let calls=0,removed=[];const storage={getItem:()=>null,setItem:()=>{calls++;throw Object.assign(new Error('Still full'),{name:'QuotaExceededError'});},removeItem:key=>removed.push(key)};
  assert.equal(saveUserState(storage,'scorebug.favorite-styles.v1','[]'),false);assert.equal(calls,2);assert.deepEqual(removed,['scorebug.favorite-directories.v1','scorebug.scoreboards.v1']);
});
