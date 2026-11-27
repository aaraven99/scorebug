import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_STANDBY_SLOTS, STANDBY_STORAGE_KEY, normalizeStandbyState, readStandbyState, saveStandbyState, seedStandbyFromURL, standbyFeedKey, standbySelectionKey, standbyGameURL } from '../public/standby-model.js';

const storage = initial => { const values = new Map(Object.entries(initial || {})); return { getItem:key=>values.get(key) ?? null, setItem:(key,value)=>values.set(key,value), values }; };
const nba = { id:'slot-a', leagueId:'nba',gameId:'nba:401001',styleId:'nfl-blades',date:'20261127',racingRows:6 };

test('a Standby board validates slots, caps at four and never accepts a cross-league game', () => {
  const state = normalizeStandbyState({ slots:[nba,{...nba,id:'slot-a',gameId:'cfb:401001'},{...nba,id:'slot-restored-2'},{...nba,id:'slot-a'},nba],dimmed:true });
  assert.equal(state.slots.length, MAX_STANDBY_SLOTS); assert.equal(new Set(state.slots.map(slot=>slot.id)).size,4);
  assert.equal(state.slots[0].gameId,'nba:401001'); assert.equal(state.slots[1].gameId,null); assert.equal(state.dimmed,true);
  assert.equal(normalizeStandbyState({slots:[]}).slots.length,1);
  assert.equal(normalizeStandbyState({slots:[{leagueId:'wrong',gameId:'bad',styleId:'bad',date:'20260230',racingRows:Infinity}]}).slots[0].styleId,'nfl-blades');
});

test('first use reads the selected main game without writing or sharing the main preference record', () => {
  const main=JSON.stringify({...nba,favorites:[{leagueId:'nfl',teamId:'3'}],favoriteStyleIds:['nfl-blades']});
  const store=storage({'scorebug.preferences.v2':main}); const state=readStandbyState(store);
  assert.deepEqual(state.slots[0],nba); assert.equal(store.values.size,1);
  state.slots[0].leagueId='cfb';state.slots[0].gameId='cfb:401002';saveStandbyState(store,state);
  assert.equal(store.getItem('scorebug.preferences.v2'),main);assert.ok(store.getItem(STANDBY_STORAGE_KEY));
  assert.equal(readStandbyState(store).slots[0].leagueId,'cfb');
});

test('an explicit entry URL changes only the first card and validates every query value', () => {
  const original=normalizeStandbyState({slots:[nba,{...nba,id:'slot-b',gameId:'nba:401002'}]});
  const next=seedStandbyFromURL(original,'/standby.html?league=cfb&game=cfb:401900&date=20261128&style=nfl-cbs-eyebar');
  assert.equal(next.slots[0].leagueId,'cfb');assert.equal(next.slots[0].gameId,'cfb:401900');assert.equal(next.slots[0].styleId,'nfl-cbs-eyebar');assert.equal(next.slots[0].date,'20261128');
  assert.deepEqual(next.slots[1],original.slots[1]);assert.equal(original.slots[0].leagueId,'nba');
  const invalid=seedStandbyFromURL(original,'/standby.html?league=cfb&game=nba:401900&style=missing&date=20260230');
  assert.equal(invalid.slots[0].gameId,null);assert.equal(invalid.slots[0].date,null);assert.equal(invalid.slots[0].styleId,'nfl-blades');
});

test('independent selected games share one feed key but have distinct retained-score keys', () => {
  const second={...nba,gameId:'nba:401002',styleId:'nba-nbc-pods'};
  assert.equal(standbyFeedKey(nba),standbyFeedKey(second));assert.notEqual(standbySelectionKey(nba),standbySelectionKey(second));
  assert.notEqual(standbyFeedKey(nba),standbyFeedKey({...nba,date:null}));
  const url=new URL(standbyGameURL(nba,{id:'nba:401999'}),'https://scorebug.test');
  assert.equal(url.pathname,'/game.html');assert.equal(url.searchParams.get('game'),'nba:401999');assert.equal(url.searchParams.get('style'),'nfl-blades');assert.equal(url.searchParams.get('date'),'20261127');
});

test('context links explicitly clear a historical date or pin and preserve driver rows', () => {
  const current={...nba,date:null,gameId:null,racingRows:22};
  const link=new URL(standbyGameURL(current,null),'https://scorebug.test');
  assert.equal(link.searchParams.get('date'),'');assert.equal(link.searchParams.get('game'),'');assert.equal(link.searchParams.get('rows'),'22');
  const original=normalizeStandbyState({slots:[nba,{...nba,id:'slot-b',styleId:'nba-nbc-pods'}],dimmed:true});
  const seeded=seedStandbyFromURL(original,'/standby.html?league=nba&game=&date=&style=nfl-blades&rows=22');
  assert.equal(seeded.slots[0].date,null);assert.equal(seeded.slots[0].gameId,null);assert.equal(seeded.slots[0].racingRows,22);
  assert.deepEqual(seeded.slots[1],original.slots[1]);assert.equal(seeded.dimmed,true);
  assert.equal(seedStandbyFromURL(original,'/standby.html?rows=60').slots[0].racingRows,60);
  assert.equal(seedStandbyFromURL(original,'/standby.html?rows=bad').slots[0].racingRows,nba.racingRows);
});

test('blocked or malformed storage leaves a usable session layout without throwing', () => {
  const blocked={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}};
  assert.equal(readStandbyState(blocked).slots.length,1);assert.equal(saveStandbyState(blocked,{}),false);assert.equal(saveStandbyState(undefined,{}),false);
  const corrupt=storage({[STANDBY_STORAGE_KEY]:'{broken','scorebug.preferences.v2':JSON.stringify(nba)});assert.deepEqual(readStandbyState(corrupt).slots[0],nba);
});
