import test from 'node:test';
import assert from 'node:assert/strict';
import { renderScorebug } from '../public/scorebug.js';
import { referenceGame } from '../public/fixtures.js';
import { referenceForLeague } from '../public/sport-fixtures.js';

const luminance=hex=>hex.replace('#','').match(/../g).map(value=>parseInt(value,16)/255).reduce((total,channel,index)=>total+(channel<=.04045?channel/12.92:((channel+.055)/1.055)**2.4)*[.2126,.7152,.0722][index],0);
const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);};

test('vertical minimalist scores and timeout marks use the actual dark panel foreground',()=>{
  for(const styleId of ['nfl-fox-minimalist','nfl-fox-minimalist-logos']){
    const svg=renderScorebug(referenceGame,{styleId,orientation:'vertical'});
    assert.match(svg,/data-team-side="away"[^>]*data-team-fill="#18212b"[^>]*data-team-ink="#ffffff"/);
    assert.equal((svg.match(/class="variant-text variant-score"[^>]*fill:#ffffff/g)||[]).length,2,styleId);
    assert.ok(contrast('#18212b','#ffffff')>10);
    const rails=[...svg.matchAll(/class="variant-timeouts"[\s\S]*?<\/g>/g)].map(match=>match[0]);
    assert.ok(rails.length>0);for(const rail of rails)assert.doesNotMatch(rail,/fill="#080c08"/);
  }
});

test('a pale team color on a pale customized NBA home panel receives readable score ink',()=>{
  const base=referenceForLeague('nba');
  for(const color of ['#ffffff','#f2e7db','#f6e33f','#27f4d2']){
    const svg=renderScorebug({...base,home:{...base.home,color}},{styleId:'nba-nbc-pods'});
    const match=svg.match(/data-team-side="home"[^>]*data-team-fill="(#[a-f0-9]{6})"[^>]*data-team-border="[^"]+"[^>]*data-team-ink="(#[a-f0-9]{6})"/i);
    assert.ok(match);assert.ok(contrast(match[1],match[2])>=4.5,`${color}: ${match[1]} / ${match[2]}`);
  }
});

test('racing rank numerals contrast with their reported constructor colors',()=>{
  const base=referenceForLeague('f1');
  const game={...base,entries:['#27f4d2','#ff8000','#ffffff','#e80020'].map((color,index)=>({...base.entries[index],team:{...base.entries[index].team,color}}))};
  for(const styleId of ['f1-rounded-tower','f1-slanted-strips','f1-white-red']){
    const svg=renderScorebug(game,{styleId,orientation:'vertical'});
    assert.equal((svg.match(/class="variant-classification-row"/g)||[]).length,4,styleId);
    for(const [,row] of svg.matchAll(/<g class="variant-classification-row"[^>]*>([\s\S]*?)<\/g>/g)){
      const fills=[...row.matchAll(/<path[^>]*fill="(#[a-f0-9]{6})"/gi)].map(match=>match[1]);
      const ink=row.match(/<text[^>]*style="[^"]*fill:(#[a-f0-9]{6})/i)?.[1];
      assert.ok(ink&&fills[1]);assert.ok(contrast(fills[1],ink)>=4.5,`${styleId}: ${fills[1]} / ${ink}`);
    }
  }
});

test('a passive golf leaderboard directs phone users to Game stats instead of requiring hover',()=>{
  const base=referenceForLeague('pga'),game={...base,entries:Array.from({length:12},(_,index)=>({...base.entries[0],id:`pga:${index}`,position:index+1}))};
  const passive=renderScorebug(game,{styleId:'golf-pga-mini',interactive:false});
  assert.match(passive,/>12 players · Game stats<\/text>/);
  const interactive=renderScorebug(game,{styleId:'golf-pga-mini'});
  assert.match(interactive,/>12 players · hover for full standings<\/text>/);
});
