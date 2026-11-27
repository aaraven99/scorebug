import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreferenceURLSync } from '../public/preference-url.js';

function harness(){
  let url=new URL('https://scorebug.test/?league=nfl&style=nfl-blades'),clock=1000,type='navigate',blocked=false;
  const saved=new Map(),timers=new Map(),writes=[];let nextTimer=0;
  const preferences={leagueId:'nfl',styleId:'nfl-blades',gameId:null,date:null,racingRows:6};
  const options={readPreferences:()=>preferences,locationRef:()=>({href:url.href}),historyRef:()=>({replaceState:(_state,_title,value)=>{if(blocked)throw Object.assign(new Error('History throttled'),{name:'SecurityError'});url=new URL(value);writes.push({url:url.href,at:clock});}}),sessionRef:()=>({getItem:key=>saved.get(key)||null,setItem:(key,value)=>saved.set(key,value),removeItem:key=>saved.delete(key)}),navigationType:()=>type,now:()=>clock,schedule:(fn,delay)=>{const id=++nextTimer;timers.set(id,{fn,at:clock+delay});return id;},cancel:id=>timers.delete(id)};
  const advance=ms=>{clock+=ms;for(const[id,timer]of [...timers])if(timer.at<=clock){timers.delete(id);timer.fn();}};
  return{preferences,writes,timers,saved,options,advance,get url(){return url;},set url(value){url=new URL(value);},set type(value){type=value;},set blocked(value){blocked=value;}};
}

test('rapid selections produce a leading URL write and one latest trailing write',()=>{
  const h=harness(),sync=createPreferenceURLSync(h.options);
  for(let index=0;index<1000;index++){h.preferences.styleId=`style-${index}`;sync.sync();}
  assert.equal(h.writes.length,1);assert.equal(h.timers.size,1);assert.equal(h.url.searchParams.get('style'),'style-0');
  h.advance(250);assert.equal(h.writes.length,2);assert.equal(h.url.searchParams.get('style'),'style-999');assert.equal(h.saved.size,0);
  for(let index=0;index<100;index++){h.preferences.styleId=`later-${index}`;sync.sync();h.advance(10);}
  assert.ok(h.writes.length<=6,'A burst stays below four history calls per second');sync.pause();assert.equal(h.timers.size,0);
});

test('an immediate reload preserves the saved selection while an explicit shared URL still applies',()=>{
  const h=harness(),first=createPreferenceURLSync(h.options);h.preferences.styleId='nba-nbc-pods';first.sync();
  h.preferences.leagueId='nba';h.preferences.styleId='nfl-blades';first.sync();const stale=h.url.href;first.pause();
  assert.equal(h.timers.size,0);assert.equal(h.saved.size,1);
  h.type='reload';const reload=createPreferenceURLSync(h.options);assert.equal(reload.recoverReload(),true);reload.sync();assert.equal(h.url.searchParams.get('league'),'nba');assert.equal(h.url.searchParams.get('style'),'nfl-blades');
  h.blocked=true;h.preferences.styleId='f1-rounded-tower';h.advance(250);reload.sync();reload.pause();h.url='https://scorebug.test/?league=epl&style=soccer-premier-league';h.type='navigate';
  const shared=createPreferenceURLSync(h.options);assert.equal(shared.recoverReload(),false,'Navigating to a share link must not inherit an old pending choice');
  h.url=stale;assert.equal(shared.recoverReload(),false,'The rejected record cannot later override another navigation');
});

test('blocked history writes retry with a bound and pagehide cancels the timer',()=>{
  const h=harness();h.blocked=true;const sync=createPreferenceURLSync(h.options);h.preferences.leagueId='f1';sync.sync();
  assert.equal(h.writes.length,0);assert.equal(h.timers.size,1);assert.equal(h.saved.size,1);
  for(let index=0;index<200;index++){h.preferences.racingRows=index%58+3;sync.sync();}assert.equal(h.timers.size,1);
  sync.pause();assert.equal(h.timers.size,0);h.advance(1000);assert.equal(h.writes.length,0);
  h.type='reload';h.blocked=false;const reload=createPreferenceURLSync(h.options);assert.equal(reload.recoverReload(),true);reload.sync();assert.equal(h.url.searchParams.get('league'),'f1');assert.equal(h.saved.size,0);
});

test('URL selection can introduce and remove fields without dropping unrelated parameters',()=>{
  const h=harness();h.url='https://scorebug.test/?theme=dark&team=CHI';const sync=createPreferenceURLSync(h.options);h.preferences.leagueId='nba';h.preferences.gameId='nba:qa1';sync.include({leagueId:'nba',gameId:'nba:qa1'},{clearTeam:true});sync.sync();
  assert.equal(h.url.searchParams.get('theme'),'dark');assert.equal(h.url.searchParams.get('team'),null);assert.equal(h.url.searchParams.get('game'),'nba:qa1');
  h.preferences.gameId=null;sync.include({gameId:null});sync.sync();h.advance(250);assert.equal(h.url.searchParams.get('game'),null);
});

test('a real preference write retries quota failure after removing only disposable caches',async()=>{
  const keys=['localStorage','sessionStorage','location','history','performance'];
  const originals=Object.fromEntries(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const records=new Map([
    ['scorebug.preferences.v2',JSON.stringify({leagueId:'nfl',styleId:'nfl-blades',styleAuto:false})],
    ['scorebug.favorite-styles.v1','["nfl-blades"]'],['scorebug.standby.v1','{"version":1,"slots":[]}'],
    ['scorebug.favorite-directories.v1','large directory cache'],['scorebug.scoreboards.v1','large score cache'],
  ]),removed=[];let quota=true,attempts=0;
  Object.defineProperties(globalThis,{localStorage:{configurable:true,value:{getItem:key=>records.get(key)||null,setItem:(key,value)=>{if(key==='scorebug.preferences.v2'){attempts++;if(quota){quota=false;throw Object.assign(new Error('Full'),{name:'QuotaExceededError'});}}records.set(key,value);},removeItem:key=>{removed.push(key);records.delete(key);}}},sessionStorage:{configurable:true,value:null},location:{configurable:true,value:{href:'https://scorebug.test/',search:''}},history:{configurable:true,value:{replaceState:()=>{}}}});
  try{const client=await import('../public/score-client.js?qa-quota-recovery');await client.initializePreferences();await client.updatePreferences({leagueId:'nba',favorites:[{leagueId:'nfl',teamId:'3',name:'Chicago Bears'}]});
    assert.equal(attempts,2);assert.deepEqual(removed,['scorebug.favorite-directories.v1','scorebug.scoreboards.v1']);
    assert.equal(JSON.parse(records.get('scorebug.preferences.v2')).leagueId,'nba');assert.equal(JSON.parse(records.get('scorebug.preferences.v2')).favorites[0].teamId,'3');assert.equal(records.get('scorebug.favorite-styles.v1'),'["nfl-blades"]');assert.equal(records.get('scorebug.standby.v1'),'{"version":1,"slots":[]}');
  }finally{for(const[key,descriptor]of Object.entries(originals))if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
});

test('an explicit current-game link clears saved historical context without losing favorites',async()=>{
  const keys=['localStorage','sessionStorage','location','history'],originals=Object.fromEntries(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const saved={leagueId:'nba',gameId:'nba:qa2',date:'20261101',racingRows:6,styleId:'nfl-blades',styleAuto:false,favorites:[{leagueId:'nfl',teamId:'3',name:'Chicago Bears'}]},memory=new Map([['scorebug.preferences.v2',JSON.stringify(saved)]]);
  let url=new URL('https://scorebug.test/game.html?league=nba&game=&date=&rows=22&style=nfl-blades');
  Object.defineProperties(globalThis,{localStorage:{configurable:true,value:{getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,value)}},sessionStorage:{configurable:true,value:null},location:{configurable:true,get:()=>({href:url.href,search:url.search})},history:{configurable:true,value:{replaceState:(_state,_title,next)=>{url=new URL(next);}}}});
  try{const client=await import('../public/score-client.js?qa-current-context');const next=await client.initializePreferences();assert.equal(next.date,null);assert.equal(next.gameId,null);assert.equal(next.racingRows,22);assert.equal(next.favorites[0].teamId,'3');assert.equal(JSON.parse(memory.get('scorebug.preferences.v2')).date,null);}
  finally{for(const[key,descriptor]of Object.entries(originals))if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
});
