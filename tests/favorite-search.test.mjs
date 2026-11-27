import test from 'node:test';
import assert from 'node:assert/strict';
import { FAVORITE_TEAM_INDEX } from '../public/favorite-team-index.js';
import { createFavoriteDirectoryStore, favoriteFromTeam, favoriteSearchKey, favoriteTeamKey, mergeFavoriteTeams, searchFavoriteTeams } from '../public/favorite-search.js';
import { matchesFavorite, normalizeFavorites } from '../public/preferences-model.js';
const bears = FAVORITE_TEAM_INDEX.find(team => team.leagueId === 'nfl' && team.id === '3');
const response = (leagueId, teams, status = 200) => new Response(JSON.stringify({ leagueId, teams }), { status, headers: { 'Content-Type': 'application/json' } });
const deferred = () => { let resolve, reject; const promise = new Promise((ok, fail) => { resolve=ok; reject=fail; }); return {promise,resolve,reject}; };
const nextTurn = () => new Promise(resolve => setImmediate(resolve));

test('the instant index contains all 139 verified major-league teams with valid distinct favorite identities', () => {
  assert.deepEqual(Object.fromEntries(['nfl','nba','wnba','mlb','nhl'].map(id => [id,FAVORITE_TEAM_INDEX.filter(team=>team.leagueId===id).length])), {nfl:32,nba:30,wnba:15,mlb:30,nhl:32});
  assert.equal(new Set(FAVORITE_TEAM_INDEX.map(favoriteTeamKey)).size,139);
  for(const team of FAVORITE_TEAM_INDEX){const favorite=favoriteFromTeam(team);assert.equal(favorite.leagueId,team.leagueId);assert.equal(favorite.teamId,team.id);assert.ok(favorite.logo.startsWith('/logos/'));}
  assert.equal(bears.name,'Chicago Bears');assert.equal(favoriteFromTeam(bears).logo,'/logos/chi.png');
});

test('actual Bears search terms match immediately regardless of case, accents, punctuation or spacing', () => {
  for(const query of ['ChicagoBears','Chicago Bears','  cHiCaGo   bEaRs  ','Chicago-Bears','Chícago Béars','Bears','NFL Bears','bears chicago']){
    const result=searchFavoriteTeams(FAVORITE_TEAM_INDEX,query,{preferredLeagueId:'f1'});
    assert.equal(result.teams[0]?.id,'3',query);assert.equal(result.teams[0]?.leagueId,'nfl',query);assert.equal(result.enterTeam?.id,'3',query);
  }
  assert.equal(favoriteSearchKey('  São–Paulo '),'saopaulo');
  assert.equal(searchFavoriteTeams(FAVORITE_TEAM_INDEX,'ChicagoBears',{leagueId:'nba'}).total,0);
  assert.equal(searchFavoriteTeams(FAVORITE_TEAM_INDEX,'ChicagoBears',{leagueId:'nfl'}).total,1);
});

test('shared abbreviations remain distinct and Enter cannot choose an arbitrary team', () => {
  const query=searchFavoriteTeams(FAVORITE_TEAM_INDEX,'CHI',{preferredLeagueId:'nba'});
  assert.equal(query.teams[0].name,'Chicago Bulls');assert.equal(query.enterTeam,null);
  assert.ok(query.teams.some(team=>team.name==='Chicago Bears'));assert.ok(query.teams.some(team=>team.name==='Chicago Sky'));assert.ok(query.teams.some(team=>team.name==='Chicago Blackhawks'));
  assert.equal(searchFavoriteTeams(FAVORITE_TEAM_INDEX,'',{limit:8}).teams.length,8);
  assert.equal(searchFavoriteTeams(FAVORITE_TEAM_INDEX,'',{limit:8}).enterTeam,null);
  assert.equal(searchFavoriteTeams(FAVORITE_TEAM_INDEX,'nonsense team').total,0);
});

test('fresh loaded metadata wins over the index while invalid IDs and other-league substitutions are rejected', () => {
  const refreshed={...bears,color:'#010203',shortName:'Bears'};
  const values=mergeFavoriteTeams(FAVORITE_TEAM_INDEX,[refreshed,{...bears,leagueId:'nba'},null,{id:'999',leagueId:'fake',name:'Unknown'}]);
  assert.equal(values.length,139);assert.equal(values.find(team=>favoriteTeamKey(team)==='nfl/3').color,'#010203');
  assert.equal(favoriteFromTeam({...bears,leagueId:'nba'}),null);
});

test('fast keystrokes use local results throughout an in-flight directory request without extra fetches', async () => {
  const pending=deferred(), calls=[];
  const store=createFavoriteDirectoryStore({fetcher:(url)=>{calls.push(url);return pending.promise;}});
  const loading=store.load('nfl');assert.equal(store.get('nfl').loading,true);
  for(let i=1;i<='ChicagoBears'.length;i++){
    const found=searchFavoriteTeams(store.teams(),'ChicagoBears'.slice(0,i),{preferredLeagueId:'f1'});
    assert.ok(found.teams.some(team=>team.id==='3'));
  }
  assert.equal(calls.length,1);assert.equal(store.load('nfl'),loading);
  pending.resolve(response('nfl',[bears]));await loading;
  assert.equal(store.get('nfl').loading,false);assert.equal(store.get('nfl').error,null);
  await store.load('nfl');assert.equal(calls.length,1);store.stop();
});

test('a failed directory leaves the Bears searchable and an explicit retry recovers', async () => {
  let fail=true,calls=0;
  const store=createFavoriteDirectoryStore({fetcher:async()=>{calls++;if(fail)throw Error('Offline');return response('nfl',[bears]);}});
  await store.load('nfl');assert.match(store.get('nfl').error.message,/Could not load/);assert.equal(store.get('nfl').loading,false);
  assert.equal(searchFavoriteTeams(store.teams(),'ChicagoBears').teams[0].id,'3');
  fail=false;await store.load('nfl',{force:true});assert.equal(calls,2);assert.equal(store.get('nfl').error,null);assert.equal(store.get('nfl').teams.length,1);store.stop();
});

test('empty supplied directories stay empty and a wrong-league response never leaks into search', async () => {
  const store=createFavoriteDirectoryStore({fetcher:async(url)=>url.includes('f1')?response('f1',[]):response('nba',[bears])});
  await store.load('f1');assert.equal(store.get('f1').error,null);assert.equal(store.get('f1').teams.length,0);assert.notEqual(store.get('f1').loadedAt,null);
  await store.load('epl');assert.ok(store.get('epl').error);assert.equal(store.get('epl').teams.length,0);assert.equal(store.teams().length,139);store.stop();
});

test('switching search leagues cancels irrelevant work and a late response cannot overwrite the newer directory', async () => {
  const calls=[];
  const store=createFavoriteDirectoryStore({fetcher:(url,options)=>{const p=deferred();calls.push({url,options,...p});return p.promise;}});
  const old=store.load('epl');store.retain(['f1']);const current=store.load('f1');
  assert.equal(calls[0].options.signal.aborted,true);assert.equal(store.get('epl').loading,false);
  calls[0].resolve(response('epl',[{id:'epl:1',leagueId:'epl',name:'Late fixture team'}]));
  calls[1].resolve(response('f1',[{id:'f1:1',leagueId:'f1',name:'Current fixture driver'}]));
  await Promise.all([old,current]);assert.equal(store.get('epl').teams.length,0);assert.equal(store.get('epl').error,null);
  assert.equal(store.get('f1').teams[0].name,'Current fixture driver');assert.equal(store.teams().some(team=>team.name==='Late fixture team'),false);store.stop();
});

test('a forced retry supersedes a prior request and cached data survives a subsequent timeout', async () => {
  const calls=[];let clock=0;
  const store=createFavoriteDirectoryStore({now:()=>clock,cacheTtlMs:10,timeoutMs:50,fetcher:(url,{signal})=>{const p=deferred();calls.push(p);signal.addEventListener('abort',()=>p.reject(new DOMException('aborted','AbortError')),{once:true});return p.promise;}});
  const first=store.load('nfl'),retry=store.load('nfl',{force:true});
  calls[1].resolve(response('nfl',[bears]));await Promise.all([first,retry]);assert.equal(store.get('nfl').teams[0].name,'Chicago Bears');assert.equal(store.get('nfl').error,null);
  clock=20;await store.load('nfl');assert.match(store.get('nfl').error.message,/too long/);assert.equal(store.get('nfl').loading,false);assert.equal(store.get('nfl').teams[0].name,'Chicago Bears');store.stop();
});

test('Bears selected while watching F1 persist, deduplicate, reload and remove without changing the watched game', async () => {
  const originalStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),originalLocation=Object.getOwnPropertyDescriptor(globalThis,'location');
  const memory=new Map();
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,String(value))}});
  Object.defineProperty(globalThis,'location',{configurable:true,value:{search:'?league=f1&game=f1:401839142'}});
  try{
    const client=await import('../public/score-client.js?favorite-search-add');await client.initializePreferences();
    const selected=searchFavoriteTeams(FAVORITE_TEAM_INDEX,'ChicagoBears',{preferredLeagueId:client.getPreferences().leagueId}).enterTeam;
    const item=favoriteFromTeam(selected);await client.updatePreferences({favorites:[item,item]});
    assert.equal(client.getPreferences().favorites.length,1);assert.equal(client.getPreferences().favorites[0].leagueId,'nfl');assert.equal(client.getPreferences().leagueId,'f1');assert.equal(client.getPreferences().gameId,'f1:401839142');
    const reload=await import('../public/score-client.js?favorite-search-reload');await reload.initializePreferences();
    assert.equal(reload.getPreferences().favorites[0].teamId,'3');assert.equal(reload.getPreferences().leagueId,'f1');
    const fixture={leagueId:'nfl',id:'123',away:{id:'3'},home:{id:'8'}};
    assert.equal(matchesFavorite(fixture,reload.getPreferences().favorites),true);assert.equal(normalizeFavorites(reload.getPreferences().favorites).length,1);
    await reload.updatePreferences({favorites:reload.getPreferences().favorites.filter(favorite=>favorite.teamId!=='3')});
    const removed=await import('../public/score-client.js?favorite-search-removed');await removed.initializePreferences();assert.deepEqual(removed.getPreferences().favorites,[]);assert.equal(removed.getPreferences().gameId,'f1:401839142');
  }finally{
    if(originalStorage)Object.defineProperty(globalThis,'localStorage',originalStorage);else delete globalThis.localStorage;
    if(originalLocation)Object.defineProperty(globalThis,'location',originalLocation);else delete globalThis.location;
    await nextTurn();
  }
});
