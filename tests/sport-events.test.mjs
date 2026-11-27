import test from 'node:test';
import assert from 'node:assert/strict';
import {createMultiSportEventTracker,eventsForSport,isSessionEvent,selectSportDemoPlayer} from '../public/sport-events.js';
import {referenceForLeague} from '../public/sport-fixtures.js';
const at=Date.parse('2026-11-27T02:00:00Z');
function game(league='nba',away=10,home=12){const base=referenceForLeague(league);return {...base,id:`${league}:4011`,...(base.away?{away:{...base.away,score:away},home:{...base.home,score:home}}:{})};}
function play(g,id,kind,away,home,points){return {id:String(id),type:kind,scoringType:kind,scoringPlay:true,scoreValue:points,teamId:g.away.id,scoringTeamId:g.away.id,scores:{away,home},wallclock:new Date(at+1000).toISOString(),player:{name:'A Player',teamId:g.away.id}};}
const details=(g,plays)=>({gameId:g.id,leagueId:g.leagueId,eventPlays:plays,allTeamStats:[{key:'threePointFieldGoalPct',away:'42.9',home:'33.3'}]});
test('basketball three-pointer and lead change are sport-specific and emitted once after baseline',()=>{
  const tracker=createMultiSportEventTracker(),a=game(),old=play(a,'1','two-pointer',10,12,2);old.wallclock=new Date(at-1000).toISOString();
  assert.deepEqual(tracker.update({game:a,details:details(a,[old]),now:at}),[]);
  const b=game('nba',13,12),newPlay=play(b,'2','three-pointer',13,12,3),events=tracker.update({game:b,details:details(b,[old,newPlay]),now:at+1500});
  assert.deepEqual(events.map(e=>e.kind),['three-pointer','lead-change']);assert.equal(events[0].statDetail,'3PT 42.9%');assert.equal(events[0].player.name,'A Player');
  assert.deepEqual(tracker.update({game:b,details:details(b,[old,newPlay]),now:at+2500}),[]);
});
test('NBA score-only increments never become a football field goal',()=>{
  const tracker=createMultiSportEventTracker(),a=game('nba',10,20);tracker.update({game:a,now:at});
  assert.deepEqual(tracker.update({game:game('nba',13,20),now:at+1000}),[]);
  const events=tracker.update({game:game('nba',13,20),now:at+10000});assert.equal(events[0].kind,'score');assert.equal(events[0].title,'SCORE UPDATE');
});
test('baseball home-run evidence needs score confirmation and reports the batter',()=>{
  const tracker=createMultiSportEventTracker(),a=game('mlb',1,3);tracker.update({game:a,details:details(a,[{id:'1',type:'Out',teamId:a.away.id}]),now:at});
  const homer=play(a,'2','home-run',2,3,1);
  assert.deepEqual(tracker.update({game:a,details:details(a,[homer]),now:at+1000}),[]);
  const events=tracker.update({game:game('mlb',2,3),details:details(a,[homer]),now:at+2000});assert.equal(events[0].kind,'home-run');assert.equal(events[0].player.name,'A Player');
});
test('scores corrected down and restored do not manufacture a new score',()=>{
  const tracker=createMultiSportEventTracker();tracker.update({game:game('nba',13,20),now:at});tracker.update({game:game('nba',10,20),now:at+1000});tracker.update({game:game('nba',13,20),now:at+2000});assert.deepEqual(tracker.update({game:game('nba',13,20),now:at+12000}),[]);
});
test('no historical celebrations when opening a final or resuming after a long polling gap',()=>{
  const tracker=createMultiSportEventTracker(),final={...game('atp',2,0),state:'post',phase:'final'};assert.deepEqual(tracker.update({game:final,now:at}),[]);assert.deepEqual(tracker.update({game:final,now:at+2000}),[]);
  const live=game();tracker.update({game:live,now:at+4000});assert.deepEqual(tracker.update({game:game('nba',90,80),now:at+100000}),[]);
});
test('race classification needs an explicit leader and first paid timing snapshot seeds quietly',()=>{
  const tracker=createMultiSportEventTracker(),g=game('f1');g.entries=g.entries.map(e=>({...e,position:null}));tracker.update({game:g,now:at});
  const changed={...g,entries:[...g.entries].reverse()};assert.deepEqual(tracker.update({game:changed,now:at+1000}),[]);
  const rich={...changed,openF1SessionKey:123,flag:'red',entries:changed.entries.map((e,i)=>({...e,position:i+1}))};assert.deepEqual(tracker.update({game:rich,now:at+2000}),[]);
  const later={...rich,flag:'safety-car'};assert.equal(tracker.update({game:later,now:at+3000})[0].kind,'safety-car');
});
test('race flags need a state transition or new dated race-control evidence, never initial history',()=>{
  const tracker=createMultiSportEventTracker(),g={...game('f1'),flag:null};tracker.update({game:g,now:at});
  const next={...g,flag:'yellow',raceControl:[{id:'new',date:new Date(at+500).toISOString(),message:'Yellow flag'}]};assert.equal(tracker.update({game:next,now:at+1000})[0].kind,'yellow-flag');assert.deepEqual(tracker.update({game:next,now:at+2000}),[]);
});
test('tennis and volleyball sets use reported set totals and a final is announced only on transition',()=>{
  for(const league of ['atp','ncaavb']){const tracker=createMultiSportEventTracker();tracker.update({game:game(league,0,0),now:at});const won=game(league,1,0);assert.equal(tracker.update({game:won,now:at+1000})[0].kind,'set');assert.deepEqual(tracker.update({game:won,now:at+12000}),[]);const final={...won,phase:'final',state:'post'};assert.equal(tracker.update({game:final,now:at+13000})[0].kind,'match');assert.deepEqual(tracker.update({game:final,now:at+14000}),[]);}
});
test('new soccer goal with timestamp can be confirmed even when earlier play history was unavailable',()=>{
  const tracker=createMultiSportEventTracker(),g=game('epl',0,0);tracker.update({game:g,now:at});
  const scored=game('epl',1,0),goal=play(scored,'2','goal',null,null,1);const events=tracker.update({game:scored,details:details(scored,[goal]),now:at+2000});assert.equal(events[0].kind,'goal');
});
test('every sport demo list is separate, and racing includes practice/qualifying timing and flags',()=>{
  assert.ok(eventsForSport('racing').some(e=>e.kind==='session-best'));assert.ok(eventsForSport('racing').some(e=>e.kind==='red-flag'));assert.equal(eventsForSport('basketball').some(e=>e.kind==='field-goal'),false);assert.ok(eventsForSport('baseball').some(e=>e.kind==='home-run'));
});
test('race-control demos are session-wide and never choose a driver from available player data',()=>{
  const globalKinds=['safety-car','virtual-safety-car','yellow-flag','red-flag','green-flag','checkered-flag'];
  const driver={id:'f1:5829',teamId:'f1:mercedes',name:'Kimi Antonelli',headshot:'https://media.formula1.com/antonelli.png'};
  for(const kind of globalKinds){
    const spec=eventsForSport('racing').find(item=>item.kind===kind);
    assert.equal(spec.scope,'session',kind);
    assert.equal(isSessionEvent(spec,'racing'),true,kind);
    assert.equal(isSessionEvent({kind},'racing'),true,`unscoped ${kind}`);
    assert.equal(isSessionEvent(kind,'racing'),true,`string ${kind}`);
    assert.equal(selectSportDemoPlayer({players:[driver]},driver.teamId,kind,'racing'),null,kind);
  }
  for(const kind of ['lead-change','fastest-lap','session-best']){
    assert.equal(isSessionEvent(eventsForSport('racing').find(item=>item.kind===kind),'racing'),false,kind);
    assert.equal(selectSportDemoPlayer({players:[driver]},driver.teamId,kind,'racing').name,'Kimi Antonelli',kind);
  }
  assert.equal(isSessionEvent({kind:'lead-change'},'basketball'),false);
});
test('new race-control evidence retains no driver attribution and still emits only once',()=>{
  const tracker=createMultiSportEventTracker(),g={...game('f1'),flag:'green'};
  tracker.update({game:g,now:at});
  const kinds=['safety-car','virtual-safety-car','yellow-flag','red-flag','green-flag','checkered-flag'];
  for(const [index,kind] of kinds.entries()){
    const current={...g,flag:kind},now=at+(index+1)*2000;
    const notices=tracker.update({game:current,now});
    assert.equal(notices.length,1,kind);
    assert.equal(notices[0].kind,kind);assert.equal(notices[0].scope,'session');
    assert.equal(notices[0].player,null);assert.equal(notices[0].teamId,null);
    assert.deepEqual(tracker.update({game:current,now:now+500}),[],`duplicate ${kind}`);
  }
});
test('a simultaneous race lead change keeps its driver while a safety-car notice remains session-wide',()=>{
  const tracker=createMultiSportEventTracker(),g={...game('f1'),flag:'green'};
  const challenger={...g.entries[1],athlete:{...g.entries[1].athlete,name:'Kimi Antonelli',headshot:'https://media.formula1.com/antonelli.png'}};
  g.entries=[g.entries[0],challenger,...g.entries.slice(2)];
  tracker.update({game:g,now:at});
  const changed={...g,flag:'safety-car',entries:[{...challenger,position:1},{...g.entries[0],position:2},...g.entries.slice(2)]};
  const notices=tracker.update({game:changed,now:at+1000});
  assert.deepEqual(notices.map(item=>item.kind),['lead-change','safety-car']);
  assert.equal(notices[0].scope,'competitor');assert.equal(notices[0].player.name,'Kimi Antonelli');
  assert.equal(notices[0].player.headshot,'https://media.formula1.com/antonelli.png');
  assert.equal(notices[1].scope,'session');assert.equal(notices[1].player,null);assert.equal(notices[1].teamId,null);
  assert.deepEqual(tracker.update({game:changed,now:at+2000}),[]);
});
