import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeFavorites,normalizePreferencePatch,matchesFavorite} from '../public/preferences-model.js';
import {activeGames,selectGame,readCachedScoreboard,writeCachedScoreboard,reconcileGameIdentity,ScoreboardPoller} from '../public/score-client.js';
import {snapshotIsOlder} from '../public/feed-state.js';
import {referenceForLeague} from '../public/sport-fixtures.js';
import {buildComparisonRows,getGameInsights,estimateWin} from '../public/game-insights.js';
import {comparisonMarkup} from '../public/game-view.js';
import {renderSportSurface,classificationMarkup} from '../public/sport-view.js';
const time=Date.parse('2026-11-27T02:00:00Z');
function game(league='nba',id='4011'){const g=referenceForLeague(league);return {...g,id:league==='nfl'?id:`${league}:${id}`,startTime:new Date(time-3600000).toISOString()};}
const storage=()=>{const map=new Map();return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)};};
const board=(g,at=time)=>({leagueId:g.leagueId,games:[g],fetchedAt:new Date(at).toISOString(),sourceId:'site',feedStatus:'primary'});

test('favorites are league-scoped, bounded, deduplicated and preserve legitimate bundled logos',()=>{
  const raw=[{leagueId:'nfl',teamId:'3',name:'Chicago Bears',logo:'/logos/chi.png'},{leagueId:'nba',teamId:'nba:4',name:'Bulls',logo:'/logos/nba/chi.png'},{leagueId:'nba',teamId:'nba:4',name:'Duplicate'},{leagueId:'nba',teamId:'4'},{leagueId:'nhl',teamId:'nba:4'},{leagueId:'nfl',teamId:'not-a-number'}];
  const result=normalizeFavorites(raw);assert.equal(result.length,2);assert.equal(result[0].logo,'/logos/chi.png');assert.equal(result[1].logo,'/logos/nba/chi.png');
  assert.equal(normalizeFavorites([{leagueId:'nba',teamId:'nba:1',logo:'https://evil.invalid/logo.png'}])[0].logo,null);
  assert.equal(normalizePreferencePatch({anchor:null}).anchor,null);
  assert.equal(normalizePreferencePatch({date:'20261332'}).date,null);
  assert.equal(normalizePreferencePatch({date:'20260229'}).date,null);
  assert.equal(normalizePreferencePatch({date:'20280229'}).date,'20280229');
});
test('live favorite is a shortcut and Automatic preference without removing it from the full live list',()=>{
  const first=game('nfl','1'),favorite={...game('nfl','2'),away:{...game('nfl').away,id:'3'}};
  const favorites=[{leagueId:'nfl',teamId:'3'}];
  assert.equal(activeGames([first,favorite]).length,2);
  assert.equal(selectGame([first,favorite],{favorites}),favorite);
  assert.equal(selectGame([first,favorite],{favorites,gameId:'1'}),first);
  assert.equal(matchesFavorite({...favorite,leagueId:'nba'},favorites),false);
});
test('saved snapshots are partitioned by league and race frames do not require fictitious teams',()=>{
  const mem=storage(),nfl=game('nfl'),nba=game('nba'),f1=game('f1');
  assert.equal(writeCachedScoreboard(null,board(nfl),{storage:mem,now:time,leagueId:'nfl'}),true);
  assert.equal(writeCachedScoreboard(null,board(nba),{storage:mem,now:time,leagueId:'nba'}),true);
  assert.equal(writeCachedScoreboard(null,board(f1),{storage:mem,now:time,leagueId:'f1'}),true);
  assert.equal(readCachedScoreboard(null,{storage:mem,now:time,leagueId:'nba'}).games[0].id,nba.id);
  assert.equal(readCachedScoreboard(null,{storage:mem,now:time,leagueId:'f1'}).games[0].home,undefined);
  assert.equal(writeCachedScoreboard(null,board(nba),{storage:mem,now:time,leagueId:'nfl'}),false);
});
test('sport-switch cancels stale requests and only accepts the requested league',async()=>{
  const resolvers=[],updates=[];const poller=new ScoreboardPoller({leagueId:'nfl',storage:storage(),now:()=>time,onUpdate:state=>updates.push(state),fetcher:(url)=>new Promise(resolve=>resolvers.push({url:new URL(url),resolve}))});
  poller.start();poller.setContext({leagueId:'nba',date:null});
  assert.equal(resolvers[1].url.searchParams.get('league'),'nba');
  resolvers[0].resolve(new Response(JSON.stringify(board(game('nfl'))),{status:200}));
  resolvers[1].resolve(new Response(JSON.stringify(board(game('nba'))),{status:200}));
  await new Promise(resolve=>setTimeout(resolve,10));poller.stop();
  assert.equal(updates.filter(state=>state.data).at(-1).data.leagueId,'nba');
  assert.equal(updates.some(state=>state.data?.leagueId==='nfl'),false);
});
test('soccer elapsed clocks advance without being rejected as older countdown clocks',()=>{
  const a={...game('epl'),period:2,clock:'67:00'},b={...a,clock:'68:00'};
  assert.equal(snapshotIsOlder({...board(b,time+2000),sourceId:'backup'},{...board(a),sourceId:'site'},time+2000),false);
  assert.equal(snapshotIsOlder({...board(a,time+2000),sourceId:'backup'},{...board(b),sourceId:'site'},time+2000),true);
});
test('leading-decimal baseball statistics and sport-specific favorable directions remain comparable',()=>{
  const rows=buildComparisonRows({sport:'baseball',allTeamStats:[{key:'batting.avg',label:'AVG',away:'.250',home:'.333'},{key:'pitching.hits',label:'H',away:'3',home:'8'},{key:'fielding.errors',label:'E',away:'0',home:'2'}]});
  assert.equal(rows[0].awayValue,.25);assert.equal(rows[0].comparison,'<');assert.equal(rows[0].betterSide,'home');assert.equal(rows[1].betterSide,'away');assert.equal(rows[2].betterSide,'away');
});
test('compact NBA comparison uses basketball metrics with made percentage next to the metric',()=>{
  const g=game(),summary={gameId:g.id,away:g.away,home:g.home,sport:'basketball',allTeamStats:[{key:'threePointFieldGoalPct',away:'42.9',home:'31.3'},{key:'turnovers',away:'2',home:'6'}]};
  const insights=getGameInsights(g,summary);const html=comparisonMarkup(g,insights,{compact:true});
  assert.match(html,/Three-point percentage/);assert.match(html,/42.9/);assert.doesNotMatch(html,/Total yards/);assert.equal(insights.rows.find(row=>row.key==='turnovers').betterSide,'away');
});
test('soccer estimate includes draws and accepts actual stoppage-time clocks',()=>{
  const g={...game('epl'),period:2,clock:"90'+2'",away:{...game('epl').away,score:1},home:{...game('epl').home,score:1}};
  const estimate=estimateWin(g,null);assert.equal(estimate.available,true);assert.ok(estimate.draw>90);assert.equal(estimate.away+estimate.home+estimate.draw,100);assert.equal(estimate.calibrated,false);
});
test('basketball fractional late-game clock and college half clocks have their own regulation lengths',()=>{
  assert.equal(estimateWin({...game(),period:4,clock:'0:00.8'},null).available,true);
  assert.equal(estimateWin({...game('cbb'),period:2,clock:'17:44'},null).available,true);
  assert.equal(estimateWin({...game('f1')},null).available,false);
});
test('sport surfaces never draw an NFL field for basketball and handle absent race positions',()=>{
  assert.doesNotMatch(renderSportSurface(game('nba')),/First down|yards/i);
  assert.match(renderSportSurface(game('mlb')),/first base: occupied/i);
  assert.match(classificationMarkup({...game('f1'),entries:[{id:'f1:1',name:'<driver>',position:null,gap:null}]}),/&lt;driver&gt;/);
  assert.doesNotMatch(classificationMarkup({...game('f1'),entries:[{id:'f1:1',name:'<driver>',position:null,gap:null}]}),/<driver>/);
  assert.doesNotMatch(renderSportSurface({...game('f1'),entries:[{id:'f1:2',name:'Second driver',position:2}]}),/Leader/);
});
