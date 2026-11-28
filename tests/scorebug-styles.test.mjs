import test from 'node:test';
import assert from 'node:assert/strict';
import { SCOREBUG_STYLES, DEFAULT_STYLE, getScorebugStyle, defaultStyleForSport } from '../public/scorebug-styles.js';
import { renderScorebug } from '../public/scorebug.js';
import { localTeamLogo, teamLogoPresentation } from '../public/team-assets.js';
import { referenceGame } from '../public/fixtures.js';
const nba={...referenceGame,id:'nba:123',leagueId:'nba',sport:'basketball',period:4,clock:'0:17.2',downDistance:undefined,fieldPosition:undefined,situation:{shotClock:9},away:{id:'nba:4',leagueId:'nba',sport:'basketball',name:'Chicago Bulls',abbreviation:'CHI',score:107,color:'#ce1141',timeouts:2,logo:'https://a.espncdn.com/i/teamlogos/nba/500/chi.png'},home:{id:'nba:2',leagueId:'nba',sport:'basketball',name:'Boston Celtics',abbreviation:'BOS',score:109,color:'#007a33',timeouts:1,logo:'https://a.espncdn.com/i/teamlogos/nba/500/bos.png'}};
const race={id:'f1:999',leagueId:'f1',sport:'racing',kind:'race',state:'in',phase:'live',sessionName:'Sprint qualifying',lap:7,totalLaps:null,flag:'red-flag',entries:[{id:'1',position:1,name:'Lando Norris',abbreviation:'NOR',team:{color:'#F47600'},time:'1:32.735'},{id:'2',position:2,name:'Charles Leclerc',abbreviation:'LEC',team:{color:'#ED1131'},gap:'+0.129'}]};

test('the catalogue covers every score/timing reference and excludes the TV multiview interface',()=>{
 assert.equal(SCOREBUG_STYLES.length,83);
 assert.equal(new Set(SCOREBUG_STYLES.map(s=>s.id)).size,83);
 assert.deepEqual(SCOREBUG_STYLES.map(s=>s.referenceNumber),Array.from({length:84},(_,i)=>i+1).filter(n=>n!==67));
 assert.equal(getScorebugStyle('nonexistent').id,DEFAULT_STYLE);
 assert.equal(new Set(SCOREBUG_STYLES.map(style=>style.name)).size,83);
 for(const style of SCOREBUG_STYLES){
  assert.ok(style.name&&style.network&&style.era&&style.referencePage);
  assert.doesNotMatch(style.name,/\b(?:FOX|CBS|NBC|ESPN|TNT|Netflix|YouTube)\b/i);
 }
 assert.equal(getScorebugStyle('nfl-blades').name,'Blades');
 assert.equal(getScorebugStyle('nfl-cbs-eyebar').name,'Deconstructed Pod');
 assert.equal(defaultStyleForSport('basketball'),'nba-nbc-pods');
});

test('every reference works in normal and side layouts with the selected sport and exact game context',()=>{
 for(const style of SCOREBUG_STYLES)for(const orientation of ['horizontal','vertical']){
  const svg=renderScorebug(nba,{styleId:style.id,orientation,idPrefix:'test'});
  assert.match(svg,/data-game-id="nba:123"/);
  assert.match(svg,/data-league-id="nba"/);
  assert.match(svg,/data-sport="basketball"/);
  assert.match(svg,new RegExp(`data-style-id="${style.id}"`));
  assert.match(svg,orientation==='vertical'?/viewBox="0 0 160 290"/:/viewBox="0 0 600 138"/);
  assert.doesNotMatch(svg,/NaN|Infinity|undefined/);
  assert.doesNotMatch(svg,/DOWN —|Down and distance|ball at|bug-possession--football/i);
  assert.match(svg,/107/);assert.match(svg,/109/);assert.match(svg,/0:17\.2/);
  for(const side of ['away','home','comparison'])assert.equal((svg.match(new RegExp(`data-details-side="${side}"`,'g'))||[]).length,1,`${style.id} ${orientation} ${side}`);
  const passive=renderScorebug(nba,{styleId:style.id,orientation,interactive:false});
  assert.doesNotMatch(passive,/role="button"|data-details-side=/);
 }
});

test('team artwork cannot cross leagues when abbreviations collide',()=>{
 const bears={...referenceGame.home,abbreviation:'CHI',leagueId:'nfl'};
 assert.equal(localTeamLogo(bears),'/logos/chi.png');
 assert.notEqual(localTeamLogo(nba.away),'/logos/chi.png');
 assert.notDeepEqual(teamLogoPresentation(nba.away).size,[4096,4096]);
 assert.equal(localTeamLogo({leagueId:'nba',abbreviation:'EVIL',logo:'https://evil.espncdn.com/track.png'}),null);
 assert.equal(localTeamLogo({leagueId:'nba',abbreviation:'EVIL',logo:'https://a.espncdn.com.evil.example/logo.png'}),null);
});

test('timing layouts render reported sessions and classifications without inventing home and away drivers',()=>{
 for(const style of SCOREBUG_STYLES)for(const orientation of ['horizontal','vertical']){
  const svg=renderScorebug(race,{styleId:style.id,orientation,idPrefix:'race'});
  assert.match(svg,/Sprint qualifying/);assert.match(svg,/NOR|Lando Norris/);assert.match(svg,/red.flag/i);
  assert.match(svg,/1:32\.735/);assert.match(svg,/\+0\.129/);
  assert.doesNotMatch(svg,/data-team-side=|Away 0|Home 0|Quarter|DOWN|time?outs remaining/i);
  assert.equal((svg.match(/data-details-side="comparison"/g)||[]).length,1);
 }
});

test('only known baseball base occupancy is described as empty or occupied',()=>{
 const base={...nba,id:'mlb:1',leagueId:'mlb',sport:'baseball',clock:'',period:5,situation:{half:'top',balls:2,strikes:1,outs:1,bases:{first:true,second:false,third:false}}};
 const known=renderScorebug(base,{styleId:'mlb-fox-logo-pod'});
 assert.match(known,/First base occupied, Second base empty, Third base empty/);
 assert.match(known,/TOP 5/);assert.match(known,/2–1/);
 const unknown=renderScorebug({...base,situation:{half:'top'}},{styleId:'mlb-fox-logo-pod'});
 assert.match(unknown,/Base occupancy unavailable/);
 assert.doesNotMatch(unknown,/First base empty/);
});

test('hostile names and intervals remain SVG text and cannot create attributes or markup',()=>{
 const malicious='"><script>alert(1)</script>';
 for(const game of [{...nba,away:{...nba.away,name:malicious,abbreviation:malicious}},{...race,sessionName:malicious,entries:[{...race.entries[0],name:malicious,gap:malicious}]}]) {
  const svg=renderScorebug(game,{styleId:game.kind==='race'?'f1-rounded-tower':'nba-nbc-pods'});
  assert.doesNotMatch(svg,/<script>|onerror=/);
  assert.match(svg,/&lt;script&gt;/);
 }
});

test('pregame, stale, empty, and final games have honest labels in all style families',()=>{
 for(const style of SCOREBUG_STYLES){
  for(const game of [null,{...nba,state:'pre',phase:'scheduled',startTime:'2026-11-27T18:00:00Z'},{...nba,state:'post',phase:'final'}]){
   const svg=renderScorebug(game,{styleId:style.id,stale:true});
   assert.match(svg,/FEED DELAYED/);assert.doesNotMatch(svg,/NaN|undefined|Infinity/);
   if(game?.state==='post')assert.match(svg,/FINAL/);
   if(game===null)assert.match(svg,/SELECT A GAME/);
  }
 }
});

test('fractional basketball clocks and added-time soccer clocks retain their source precision',()=>{
 for(const orientation of ['horizontal','vertical']){
  const basketball=renderScorebug({...nba,clock:'10.3'},{styleId:'nba-nbc-pods',orientation});
  assert.match(basketball,/>10\.3<\/text>/);
  const soccer=renderScorebug({...nba,id:'epl:1',leagueId:'epl',sport:'soccer',clock:"90'+2'",situation:{}},{styleId:'soccer-premier-league',orientation});
  assert.match(soccer,/>90&#39;\+2&#39;<\/text>/);
 }
});

test('a partly unknown base state does not silently turn unknown bases into empty bases',()=>{
 const svg=renderScorebug({...nba,leagueId:'mlb',sport:'baseball',period:7,situation:{half:'top',bases:[true,null,false]}},{styleId:'mlb-fox-logo-pod'});
 assert.match(svg,/First base occupied, Second base unknown, Third base empty/);
});

test('the 2026 Connecticut Sun mark remains available after the provider hides inactive team-directory entries',()=>{
 assert.equal(localTeamLogo({leagueId:'wnba',sport:'basketball',abbreviation:'CON'}),'/logos/wnba/connecticut.png');
 const geometry=teamLogoPresentation({leagueId:'wnba',sport:'basketball',abbreviation:'CON'});
 assert.deepEqual(geometry.size,[500,500]);assert.ok(geometry.bounds[2]>geometry.bounds[0]);
});

test('a chequered flag cannot accidentally match the word red, and penalty results remain visible',()=>{
 const finalRace=renderScorebug({...race,flag:'chequered',state:'post',phase:'final'},{styleId:'f1-rounded-tower'});
 assert.match(finalRace,/aria-label="chequered"/);assert.doesNotMatch(finalRace,/fill="#dc3036"/);
 const soccer=renderScorebug({...nba,leagueId:'epl',sport:'soccer',state:'post',phase:'final',situation:{shootout:{away:4,home:3}}},{styleId:'soccer-premier-league'});
 assert.match(soccer,/FINAL · PENS 4–3/);
 const scheduled=renderScorebug({...nba,state:'pre',phase:'scheduled',startTime:null},{styleId:'nba-nbc-pods'});
 assert.match(scheduled,/SCHEDULED/);assert.doesNotMatch(scheduled,/1969|1970/);
});
