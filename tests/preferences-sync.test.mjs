import test from 'node:test';
import assert from 'node:assert/strict';

const KEY='scorebug.preferences.v2',LEGACY_KEY='scorebug.preferences.v1';
let sequence=0;
function environment(seed=[]) {
  const names=['localStorage','window','BroadcastChannel','addEventListener','location','history'];
  const originals=Object.fromEntries(names.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const memory=new Map(seed),writes=[],channels=[],listeners=[];
  let blocked=false;
  class Channel {
    constructor(name){this.name=name;this.sent=[];channels.push(this);}
    postMessage(value){this.sent.push(structuredClone(value));}
  }
  Object.defineProperties(globalThis,{
    localStorage:{configurable:true,value:{
      getItem(key){if(blocked)throw Error('Storage unavailable');return memory.get(key)??null;},
      setItem(key,value){if(blocked)throw Error('Storage unavailable');writes.push([key,value]);memory.set(key,String(value));},
    }},
    window:{configurable:true,value:{}},BroadcastChannel:{configurable:true,value:Channel},
    addEventListener:{configurable:true,value:(name,handler)=>{if(name==='storage')listeners.push(handler);}},
    location:{configurable:true,value:{href:'https://scorebug.test/',search:''}},
    history:{configurable:true,value:{replaceState(){}}},
  });
  return {
    memory,writes,channels,
    async client(){const client=await import(`../public/score-client.js?sync-regression-${++sequence}`);await client.initializePreferences();return client;},
    storage(key,value){for(const listener of listeners)listener({key,newValue:value});},
    blockStorage(){blocked=true;},
    restore(){for(const [key,descriptor] of Object.entries(originals))if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];},
  };
}

test('a legacy tab cannot erase migrated favorites, league, style or driver rows',async()=>{
  const favorite={leagueId:'nfl',teamId:'3',name:'Chicago Bears',abbreviation:'CHI',logo:'/logos/chi.png'};
  const legacy={leagueId:'nba',styleId:'nfl-cbs-eyebar',favorites:[favorite],scale:1.2};
  const env=environment([[LEGACY_KEY,JSON.stringify(legacy)]]);
  try{
    const client=await env.client();
    assert.equal(client.getPreferences().leagueId,'nba');assert.equal(client.getPreferences().styleAuto,false);
    assert.equal(client.getPreferences().favorites[0].teamId,'3');
    assert.equal(env.channels[0].name,KEY);assert.equal(env.memory.get(LEGACY_KEY),JSON.stringify(legacy));
    await client.updatePreferences({leagueId:'f1',gameId:'f1:401000001',racingRows:22});
    const saved=env.memory.get(KEY),count=env.writes.length;
    const oldWrite=JSON.stringify({...legacy,leagueId:'nfl',styleId:'nfl-blades',favorites:[]});
    env.memory.set(LEGACY_KEY,oldWrite);env.storage(LEGACY_KEY,oldWrite);
    assert.equal(env.memory.get(KEY),saved);assert.equal(env.writes.length,count);
    const reload=await env.client();
    assert.equal(reload.getPreferences().leagueId,'f1');assert.equal(reload.getPreferences().gameId,'f1:401000001');
    assert.equal(reload.getPreferences().styleId,'nfl-cbs-eyebar');assert.equal(reload.getPreferences().styleAuto,false);
    assert.equal(reload.getPreferences().racingRows,22);assert.equal(reload.getPreferences().favorites[0].teamId,'3');
    assert.equal(env.writes.length,count,'loading an existing v2 record must not write it back');
  }finally{env.restore();}
});

test('updated windows synchronize in both directions without storage or channel echoes',async()=>{
  const env=environment();
  try{
    const first=await env.client(),second=await env.client();let firstChanges=0,secondChanges=0;
    first.onPreferences(()=>firstChanges++);second.onPreferences(()=>secondChanges++);
    const baseline=env.writes.length;
    await first.updatePreferences({leagueId:'nba',styleId:'nfl-cbs-eyebar',styleAuto:false,racingRows:22});
    const initial=env.memory.get(KEY),initialMessage=env.channels[0].sent.at(-1);
    env.storage(KEY,initial);env.channels[1].onmessage({data:initialMessage});
    assert.deepEqual(second.getPreferences(),first.getPreferences());
    assert.equal(env.writes.length,baseline+1);assert.equal(firstChanges,1);assert.equal(secondChanges,1);
    assert.equal(env.channels[1].sent.length,0,'receiving a preference must not broadcast it again');
    await second.updatePreferences({leagueId:'f1',racingRows:40});
    const latest=env.memory.get(KEY);env.storage(KEY,latest);env.channels[0].onmessage({data:env.channels[1].sent.at(-1)});
    assert.deepEqual(first.getPreferences(),second.getPreferences());assert.equal(first.getPreferences().racingRows,40);
    assert.equal(env.writes.length,baseline+2);assert.equal(firstChanges,2);assert.equal(secondChanges,2);
    // Earlier messages may arrive after a background tab has already received
    // the latest saved selection through the other transport.
    env.storage(KEY,initial);env.channels[0].onmessage({data:initialMessage});env.channels[1].onmessage({data:initialMessage});
    assert.equal(first.getPreferences().leagueId,'f1');assert.equal(second.getPreferences().leagueId,'f1');
    assert.equal(first.getPreferences().racingRows,40);assert.equal(env.memory.get(KEY),latest);
    assert.equal(env.writes.length,baseline+2);assert.equal(firstChanges,2);assert.equal(secondChanges,2);
  }finally{env.restore();}
});

test('storage-only deliveries are read-only and channel sync remains usable when storage is blocked',async()=>{
  const env=environment();
  try{
    const client=await env.client(),baseline=env.writes.length;
    const next={...client.getPreferences(),leagueId:'nba',styleId:'nba-nbc-pods'};
    env.memory.set(KEY,JSON.stringify(next));env.storage(KEY,JSON.stringify(next));
    assert.equal(client.getPreferences().leagueId,'nba');assert.equal(env.writes.length,baseline);
    env.blockStorage();env.channels[0].onmessage({data:{...next,leagueId:'f1',racingRows:22}});
    assert.equal(client.getPreferences().leagueId,'f1');assert.equal(client.getPreferences().racingRows,22);
    assert.equal(env.writes.length,baseline);assert.equal(env.channels[0].sent.length,0);
  }finally{env.restore();}
});
