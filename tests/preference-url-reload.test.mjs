import test from 'node:test';
import assert from 'node:assert/strict';

const KEY='scorebug.preferences.v2',PENDING='scorebug.pending-url.v1:/game.html';
const fields=['gameId','date','leagueId','styleId','racingRows'];
const saved={gameId:null,date:null,leagueId:'nba',styleId:'nba-nbc-pods',racingRows:6,styleAuto:false,favorites:[]};
let sequence=0;
function ownership(href){
  const context=new URL(href);for(const key of ['game','date','league','style','rows','team'])context.searchParams.delete(key);
  return JSON.stringify({version:2,context:context.href,wanted:href,fields,clearTeam:true,at:Date.now()});
}
function environment({record=JSON.stringify(saved),href='https://scorebug.test/game.html?league=nba&style=nfl-cbs-deconstructed&rows=22&game=nba%3Aqa1&date=20261101&theme=dark#stats',blocked=false}={}){
  const names=['localStorage','sessionStorage','location','history','performance','addEventListener'];
  const originals=Object.fromEntries(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  let url=new URL(href),type='reload',blockReads=blocked,blockWrites=blocked;
  const records=new Map(record===null?[]:[[KEY,record]]),session=new Map([[PENDING,ownership(href)]]),writes=[],listeners=[];
  Object.defineProperties(globalThis,{
    localStorage:{configurable:true,value:{
      getItem(key){if(blockReads)throw Error('Read blocked');return records.get(key)??null;},
      setItem(key,value){if(blockWrites)throw Error('Write blocked');writes.push({key,value});records.set(key,String(value));},
      removeItem(key){if(blockWrites)throw Error('Write blocked');records.delete(key);},
    }},
    sessionStorage:{configurable:true,value:{getItem:key=>session.get(key)??null,setItem:(key,value)=>session.set(key,String(value)),removeItem:key=>session.delete(key)}},
    location:{configurable:true,get:()=>({href:url.href,search:url.search})},
    history:{configurable:true,value:{replaceState:(_state,_title,next)=>{url=new URL(next);}}},
    performance:{configurable:true,value:{getEntriesByType:()=>[{type}]}},
    addEventListener:{configurable:true,value:(name,listener)=>listeners.push({name,listener})},
  });
  return{
    records,session,writes,
    get url(){return url;},set url(value){url=new URL(value);},set type(value){type=value;},
    set blockWrites(value){blockWrites=value;},
    client:()=>import(`../public/score-client.js?owned-url-reload-${++sequence}`),
    restore(){for(const {name,listener}of listeners)if(name==='pagehide')listener();for(const[name,descriptor]of Object.entries(originals))if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];},
  };
}

test('a retained marker cannot discard the URL when the shared record is absent, invalid or inaccessible',async()=>{
  const cases=[
    ['missing',null],['corrupt','{broken'],['array','[]'],['empty','{}'],
    ['missing field',JSON.stringify({...saved,date:undefined})],
    ['invalid game',JSON.stringify({...saved,gameId:'not valid'})],
    ['invalid date',JSON.stringify({...saved,date:'20260230'})],
    ['noncanonical rows',JSON.stringify({...saved,racingRows:2})],
    ['invalid style',JSON.stringify({...saved,styleId:'bad/style'})],
    ['invalid league',JSON.stringify({...saved,leagueId:'bad/league'})],
    ['blocked',JSON.stringify(saved),true],
  ];
  for(const[name,record,blocked]of cases){
    const env=environment({record,blocked});
    try{
      const client=await env.client(),next=await client.initializePreferences();
      assert.deepEqual([next.leagueId,next.styleId,next.racingRows,next.gameId,next.date],['nba','nfl-cbs-deconstructed',22,'nba:qa1','20261101'],name);
      assert.equal(env.url.searchParams.get('theme'),'dark',name);assert.equal(env.url.hash,'#stats',name);
      if(blocked)assert.equal(env.session.has(PENDING),false,'Unavailable persistence cannot claim reload ownership');
    }finally{env.restore();}
  }
});

test('reload applies the latest shared record read after module startup without a write-back echo',async()=>{
  const env=environment();
  try{
    env.records.set('scorebug.favorite-styles.v1','["nfl-blades"]');
    const client=await env.client();assert.equal(client.getPreferences().styleId,'nba-nbc-pods');
    const newer={...saved,styleId:'nfl-cbs-eyebar',gameId:null,date:null,racingRows:40,
      favorites:[{leagueId:'nfl',teamId:'3',name:'Chicago Bears'}]};
    // Another tab writes C while this tab has only read B; its channel callback
    // has not run. Recovery must re-read C instead of matching an old snapshot.
    env.records.set(KEY,JSON.stringify(newer));const next=await client.initializePreferences();
    assert.deepEqual([next.styleId,next.gameId,next.date,next.racingRows],['nfl-cbs-eyebar',null,null,40]);
    assert.equal(next.favorites[0].teamId,'3');assert.deepEqual(next.favoriteStyleIds,['nfl-blades']);
    assert.equal(env.writes.length,0,'Recovery and external reads must never re-persist a stale snapshot');
    assert.equal(env.records.get(KEY),JSON.stringify(newer));assert.equal(env.url.searchParams.get('style'),'nfl-cbs-eyebar');
    assert.equal(env.url.searchParams.has('game'),false);assert.equal(env.url.searchParams.has('date'),false);
  }finally{env.restore();}
});

test('a failed real preference save revokes reload ownership and leaves the selected URL usable',async()=>{
  const env=environment({href:'https://scorebug.test/game.html?league=nba&style=nba-nbc-pods&rows=6'});
  try{
    env.type='navigate';const client=await env.client();await client.initializePreferences();
    assert.equal(env.session.has(PENDING),true);const previous=env.records.get(KEY);env.blockWrites=true;
    await client.updatePreferences({styleId:'nfl-cbs-deconstructed',styleAuto:false},{updateURL:true});
    assert.equal(client.getPreferences().styleId,'nfl-cbs-deconstructed');assert.equal(env.records.get(KEY),previous);
    assert.equal(env.session.has(PENDING),false,'The actual failed save must revoke an older valid marker');
    assert.equal(env.url.searchParams.get('style'),'nfl-cbs-deconstructed');
    env.type='reload';const reloaded=await env.client();assert.equal((await reloaded.initializePreferences()).styleId,'nfl-cbs-deconstructed');
    assert.equal(env.session.has(PENDING),false);env.blockWrites=false;
    await reloaded.updatePreferences({styleId:'nfl-cbs-deconstructed'});
    assert.equal(JSON.parse(env.records.get(KEY)).styleId,'nfl-cbs-deconstructed');assert.equal(env.session.has(PENDING),true);
  }finally{env.restore();}
});
