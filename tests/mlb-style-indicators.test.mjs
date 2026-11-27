import test from 'node:test';
import assert from 'node:assert/strict';
import { renderScorebug } from '../public/scorebug.js';
import { SCOREBUG_STYLES } from '../public/scorebug-styles.js';
import { referenceForLeague } from '../public/sport-fixtures.js';

test('all 83 styles preserve the live baseball count, outs and base occupancy in both orientations',()=>{
  const game={...referenceForLeague('mlb'),id:'mlb:401001',period:7,situation:{half:'top',balls:2,strikes:1,outs:1,onFirst:true,onSecond:false,onThird:true}};
  for(const style of SCOREBUG_STYLES)for(const orientation of ['horizontal','vertical']){
    const svg=renderScorebug(game,{styleId:style.id,orientation,idPrefix:'baseball-check'}),context=`${style.id}/${orientation}`;
    assert.equal((svg.match(/class="variant-diamond"/g)||[]).length,1,context);
    assert.match(svg,/First base occupied, Second base empty, Third base occupied/,context);
    assert.match(svg,/>2–1<\/text>/,context);assert.match(svg,/>1 OUT<\/text>/,context);assert.match(svg,/>TOP 7<\/text>/,context);
  }
});

test('newly adapted baseball indicators preserve unknown occupancy without claiming empty bases',()=>{
  const game={...referenceForLeague('mlb'),id:'mlb:401001',situation:{half:'bottom',balls:0,strikes:0,outs:2}};
  for(const styleId of ['nfl-blades','nfl-fox-compact-box','nba-bally-banner','nba-espn-two-tier','nba-chsn-stack','tennis-wimbledon-green','tennis-wimbledon-purple','tennis-australian-open','tennis-us-open'])for(const orientation of ['horizontal','vertical']){
    const svg=renderScorebug(game,{styleId,orientation});
    assert.match(svg,/Base occupancy unavailable/,`${styleId}/${orientation}`);assert.doesNotMatch(svg,/First base empty/);
  }
});
