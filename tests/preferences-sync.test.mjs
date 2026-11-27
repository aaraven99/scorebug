import test from 'node:test';
import assert from 'node:assert/strict';

const KEY='scorebug.preferences.v2',LEGACY_KEY='scorebug.preferences.v1',STYLES_KEY='scorebug.favorite-styles.v1';
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
    channel(name,index=0){return channels.filter(channel=>channel.name===name)[index];},
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
    const firstChannel=env.channel(KEY,0),secondChannel=env.channel(KEY,1);
    first.onPreferences(()=>firstChanges++);second.onPreferences(()=>secondChanges++);
    const baseline=env.writes.length;
    await first.updatePreferences({leagueId:'nba',styleId:'nfl-cbs-eyebar',styleAuto:false,racingRows:22});
    const initial=env.memory.get(KEY),initialMessage=firstChannel.sent.at(-1);
    env.storage(KEY,initial);secondChannel.onmessage({data:initialMessage});
    assert.deepEqual(second.getPreferences(),first.getPreferences());
    assert.equal(env.writes.length,baseline+1);assert.equal(firstChanges,1);assert.equal(secondChanges,1);
    assert.equal(secondChannel.sent.length,0,'receiving a preference must not broadcast it again');
    await second.updatePreferences({leagueId:'f1',racingRows:40});
    const latest=env.memory.get(KEY);env.storage(KEY,latest);firstChannel.onmessage({data:secondChannel.sent.at(-1)});
    assert.deepEqual(first.getPreferences(),second.getPreferences());assert.equal(first.getPreferences().racingRows,40);
    assert.equal(env.writes.length,baseline+2);assert.equal(firstChanges,2);assert.equal(secondChanges,2);
    // Earlier messages may arrive after a background tab has already received
    // the latest saved selection through the other transport.
    env.storage(KEY,initial);firstChannel.onmessage({data:initialMessage});secondChannel.onmessage({data:initialMessage});
    assert.equal(first.getPreferences().leagueId,'f1');assert.equal(second.getPreferences().leagueId,'f1');
    assert.equal(first.getPreferences().racingRows,40);assert.equal(env.memory.get(KEY),latest);
    assert.equal(env.writes.length,baseline+2);assert.equal(firstChanges,2);assert.equal(secondChanges,2);
  }finally{env.restore();}
});

test('starring a style writes only its dedicated record and never changes the selected game or team favorites',async()=>{
  const favorite={leagueId:'nfl',teamId:'3',name:'Chicago Bears',abbreviation:'CHI'};
  const env=environment([[KEY,JSON.stringify({leagueId:'f1',gameId:'f1:123',styleId:'nfl-cbs-eyebar',styleAuto:false,racingRows:22,favorites:[favorite]})]]);
  try{
    const client=await env.client(),before=client.getPreferences(),base=env.memory.get(KEY),count=env.writes.length;
    await client.updatePreferences({favoriteStyleIds:['nfl-blades','nba-nbc-pods','nfl-blades','made-up-style',42]});
    const expected=['nfl-blades','nba-nbc-pods'];
    assert.deepEqual(client.getPreferences(),{...before,favoriteStyleIds:expected});
    assert.equal(env.memory.get(KEY),base);assert.deepEqual(JSON.parse(env.memory.get(STYLES_KEY)),expected);
    assert.equal(env.writes.length,count+1);assert.equal(env.channel(KEY).sent.length,0);
    assert.deepEqual(env.channel(STYLES_KEY).sent,[expected]);
    const copy=client.getPreferences();copy.favoriteStyleIds.push('f1-rounded-tower');
    assert.deepEqual(client.getPreferences().favoriteStyleIds,expected,'callers must not mutate saved style favorites');
    const reload=await env.client();assert.deepEqual(reload.getPreferences(),client.getPreferences());
  }finally{env.restore();}
});

test('old v2.0.1 preference writes still synchronize ordinary choices without erasing favorite styles',async()=>{
  const favorite={leagueId:'nfl',teamId:'3',name:'Chicago Bears',abbreviation:'CHI'};
  const env=environment();
  try{
    const first=await env.client(),second=await env.client();
    await first.updatePreferences({favoriteStyleIds:['nfl-blades','f1-rounded-tower']});
    env.storage(STYLES_KEY,env.memory.get(STYLES_KEY));
    const stars=env.memory.get(STYLES_KEY),writes=env.writes.length;
    // This full-record write matches v2.0.1: it knows every shared preference,
    // but its normalizer drops the newly introduced favoriteStyleIds property.
    const oldRecord={...JSON.parse(env.memory.get(KEY)),leagueId:'nba',gameId:'nba:4',styleId:'nfl-cbs-eyebar',styleAuto:false,racingRows:22,favorites:[favorite]};
    env.memory.set(KEY,JSON.stringify(oldRecord));env.storage(KEY,JSON.stringify(oldRecord));
    env.channel(KEY,0).onmessage({data:oldRecord});env.channel(KEY,1).onmessage({data:oldRecord});
    for(const client of [first,second]){
      assert.deepEqual(client.getPreferences().favoriteStyleIds,['nfl-blades','f1-rounded-tower']);
      assert.equal(client.getPreferences().leagueId,'nba');assert.equal(client.getPreferences().styleId,'nfl-cbs-eyebar');
      assert.equal(client.getPreferences().racingRows,22);assert.equal(client.getPreferences().favorites[0].teamId,'3');
    }
    assert.equal(env.memory.get(STYLES_KEY),stars);assert.equal(env.writes.length,writes,'receiving old-client records must not echo');
    await second.updatePreferences({racingRows:40});
    assert.equal(Object.hasOwn(JSON.parse(env.memory.get(KEY)),'favoriteStyleIds'),false);
    assert.equal(Object.hasOwn(env.channel(KEY,1).sent.at(-1),'favoriteStyleIds'),false);
    assert.equal(env.memory.get(STYLES_KEY),stars);
    const reload=await env.client();assert.equal(reload.getPreferences().racingRows,40);
    assert.deepEqual(reload.getPreferences().favoriteStyleIds,['nfl-blades','f1-rounded-tower']);
  }finally{env.restore();}
});

test('style favorites synchronize, unstar and reload without echoes or stale-message rollback',async()=>{
  const env=environment();
  try{
    const first=await env.client(),second=await env.client();let changes=0;
    second.onPreferences(()=>changes++);
    const a=env.channel(STYLES_KEY,0),b=env.channel(STYLES_KEY,1),base=env.memory.get(KEY),count=env.writes.length;
    await first.updatePreferences({favoriteStyleIds:['nfl-blades','nba-nbc-pods']});
    const initial=env.memory.get(STYLES_KEY),initialMessage=a.sent.at(-1);
    env.storage(STYLES_KEY,initial);b.onmessage({data:initialMessage});
    assert.deepEqual(second.getPreferences().favoriteStyleIds,initialMessage);assert.equal(changes,1);
    assert.equal(b.sent.length,0);assert.equal(env.writes.length,count+1);
    await second.updatePreferences({favoriteStyleIds:['nba-nbc-pods']});
    const latest=env.memory.get(STYLES_KEY);env.storage(STYLES_KEY,latest);a.onmessage({data:b.sent.at(-1)});
    env.storage(STYLES_KEY,initial);a.onmessage({data:initialMessage});b.onmessage({data:initialMessage});
    assert.deepEqual(first.getPreferences().favoriteStyleIds,['nba-nbc-pods']);assert.deepEqual(second.getPreferences().favoriteStyleIds,['nba-nbc-pods']);
    assert.equal(changes,2);assert.equal(env.writes.length,count+2);assert.equal(env.memory.get(KEY),base);
    await second.updatePreferences({favoriteStyleIds:[]});env.storage(STYLES_KEY,env.memory.get(STYLES_KEY));
    assert.deepEqual(first.getPreferences().favoriteStyleIds,[]);
    const reload=await env.client();assert.deepEqual(reload.getPreferences().favoriteStyleIds,[]);
    assert.equal(env.memory.get(KEY),base);
  }finally{env.restore();}
});

test('favorite-style channel works with blocked storage and base-channel records cannot replace it',async()=>{
  const env=environment();
  try{
    const client=await env.client();env.blockStorage();
    env.channel(STYLES_KEY).onmessage({data:['nfl-blades','nfl-blades','unknown']});
    assert.deepEqual(client.getPreferences().favoriteStyleIds,['nfl-blades']);
    env.channel(KEY).onmessage({data:{leagueId:'nba',favoriteStyleIds:[]}});
    assert.equal(client.getPreferences().leagueId,'nba');assert.deepEqual(client.getPreferences().favoriteStyleIds,['nfl-blades']);
    assert.equal(env.channel(KEY).sent.length,0);assert.equal(env.channel(STYLES_KEY).sent.length,0);
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
