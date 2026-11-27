import test from 'node:test';
import assert from 'node:assert/strict';

test('legacy browser styles migrate to a saved choice while new profiles and explicit modes retain their defaults', async () => {
  const originals=Object.fromEntries(['localStorage','location','history'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const memory=new Map(),key='scorebug.preferences.v1';
  Object.defineProperties(globalThis,{
    localStorage:{configurable:true,value:{getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,String(value))}},
    location:{configurable:true,value:{href:'https://scorebug.test/',search:''}},
    history:{configurable:true,value:{replaceState:()=>{}}}
  });
  try {
    const cases=[
      [null,true,'nfl-blades'],[{},true,'nfl-blades'],[{scale:.8},true,'nfl-blades'],
      [{styleId:'nfl-blades'},false,'nfl-blades'],
      [{leagueId:'nba',styleId:'nfl-cbs-eyebar'},false,'nfl-cbs-eyebar'],
      [{leagueId:'f1',styleId:'f1-rounded-tower'},false,'f1-rounded-tower'],
      [{styleId:'nfl-cbs-eyebar',styleAuto:true},true,'nfl-cbs-eyebar'],
      [{styleId:'nfl-cbs-eyebar',styleAuto:false},false,'nfl-cbs-eyebar'],
      [{styleId:'bad/style'},true,'nfl-blades'],
    ];
    for(const [index,[saved,automatic,styleId]] of cases.entries()){
      memory.clear();if(saved!==null)memory.set(key,JSON.stringify(saved));
      const client=await import(`../public/score-client.js?style-migration-${index}`);
      await client.initializePreferences();
      assert.equal(client.getPreferences().styleAuto,automatic,JSON.stringify(saved));
      assert.equal(client.getPreferences().styleId,styleId);
      await client.updatePreferences({racingRows:22});
      assert.equal(JSON.parse(memory.get(key)).styleAuto,automatic);
      const reloaded=await import(`../public/score-client.js?style-migration-reload-${index}`);
      await reloaded.initializePreferences();
      assert.equal(reloaded.getPreferences().styleAuto,automatic);assert.equal(reloaded.getPreferences().styleId,styleId);
      await reloaded.updatePreferences({styleId:'nba-nbc-pods'});
      assert.equal(reloaded.getPreferences().styleAuto,automatic,'a partial style patch must not infer a mode');
    }
  }finally {
    for(const [key,descriptor] of Object.entries(originals))if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];
  }
});

test('a changed cross-sport style replaces an old pop-out URL and survives reload', async () => {
  const originals=Object.fromEntries(['localStorage','location','history'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const memory=new Map();let url=new URL('https://scorebug.test/widget.html?league=nba&style=nba-nbc-pods&rows=6');
  Object.defineProperties(globalThis,{
    localStorage:{configurable:true,value:{getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,String(value))}},
    location:{configurable:true,get:()=>({href:url.href,search:url.search})},
    history:{configurable:true,value:{replaceState:(_state,_title,value)=>{url=new URL(value,url);}}}
  });
  try {
    const client=await import('../public/score-client.js?style-url-initial');
    await client.initializePreferences();
    await client.updatePreferences({styleId:'nfl-blades',styleAuto:false,racingRows:22});
    assert.equal(url.searchParams.get('style'),'nfl-blades');assert.equal(url.searchParams.get('rows'),'22');
    const reloaded=await import('../public/score-client.js?style-url-reload');
    await reloaded.initializePreferences();
    assert.equal(reloaded.getPreferences().leagueId,'nba');assert.equal(reloaded.getPreferences().styleId,'nfl-blades');
    assert.equal(reloaded.getPreferences().styleAuto,false);assert.equal(reloaded.getPreferences().racingRows,22);
    await reloaded.updatePreferences({leagueId:'f1',gameId:null});
    assert.equal(url.searchParams.get('league'),'f1');assert.equal(reloaded.getPreferences().styleId,'nfl-blades');
    const secondReload=await import('../public/score-client.js?style-url-f1-reload');
    await secondReload.initializePreferences();assert.equal(secondReload.getPreferences().leagueId,'f1');assert.equal(secondReload.getPreferences().styleId,'nfl-blades');
    url=new URL('https://scorebug.test/?league=nba&style=nfl-cbs-eyebar&rows=20');
    const sharedLink=await import('../public/score-client.js?style-url-explicit-link');await sharedLink.initializePreferences();
    assert.equal(sharedLink.getPreferences().styleId,'nfl-cbs-eyebar');assert.equal(sharedLink.getPreferences().styleAuto,false);assert.equal(sharedLink.getPreferences().racingRows,20);
  }finally {
    for(const [key,descriptor] of Object.entries(originals))if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];
  }
});
