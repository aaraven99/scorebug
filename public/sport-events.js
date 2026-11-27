import { createGameEventTracker as createFootballTracker, selectDemoPlayer as footballDemoPlayer } from './game-events.js';
import { sportFor } from './sports.js';
const event = (kind,title,points=null) => ({kind,title,points});
export const SPORT_EVENTS = Object.freeze({
  football:[event('touchdown','TOUCHDOWN',6),event('field-goal','FIELD GOAL',3),event('safety','SAFETY',2),event('extra-point','EXTRA POINT',1),event('two-point','TWO-POINT CONVERSION',2),event('interception','INTERCEPTION'),event('fumble','FUMBLE RECOVERED'),event('big-play','BIG PLAY')],
  basketball:[event('three-pointer','THREE-POINTER',3),event('two-pointer','TWO POINTS',2),event('free-throw','FREE THROW',1),event('lead-change','LEAD CHANGE'),event('dunk','DUNK',2),event('block','BLOCK'),event('steal','STEAL')],
  baseball:[event('home-run','HOME RUN'),event('grand-slam','GRAND SLAM',4),event('run','RUN SCORED',1),event('lead-change','LEAD CHANGE'),event('strikeout','STRIKEOUT')],
  hockey:[event('goal','GOAL',1),event('power-play','POWER PLAY'),event('lead-change','LEAD CHANGE')],
  soccer:[event('goal','GOAL',1),event('penalty-goal','PENALTY GOAL',1),event('red-card','RED CARD'),event('lead-change','LEAD CHANGE')],
  racing:[event('lead-change','NEW RACE LEADER'),event('safety-car','SAFETY CAR'),event('virtual-safety-car','VIRTUAL SAFETY CAR'),event('yellow-flag','YELLOW FLAG'),event('red-flag','RED FLAG'),event('green-flag','GREEN FLAG'),event('checkered-flag','CHEQUERED FLAG'),event('fastest-lap','FASTEST LAP'),event('session-best','SESSION BEST')],
  tennis:[event('ace','ACE'),event('break','BREAK OF SERVE'),event('set','SET WON'),event('match','MATCH WON')],
  volleyball:[event('point','POINT'),event('ace','SERVICE ACE'),event('block','BLOCK'),event('set','SET WON'),event('match','MATCH WON')],
  rugby:[event('try','TRY'),event('conversion','CONVERSION'),event('penalty','PENALTY GOAL'),event('drop-goal','DROP GOAL'),event('lead-change','LEAD CHANGE')],
  golf:[event('birdie','BIRDIE'),event('eagle','EAGLE'),event('hole-in-one','HOLE IN ONE'),event('lead-change','NEW LEADER')],
  cricket:[event('six','SIX',6),event('four','FOUR',4),event('wicket','WICKET'),event('fifty','HALF CENTURY'),event('century','CENTURY')],
});
export function eventsForSport(sport) { return SPORT_EVENTS[sport] || [event('score','SCORE UPDATE')]; }
const array = value => Array.isArray(value) ? value : [];
const n = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const identity = value => typeof value === 'string' && /^[\w:.-]{1,120}$/.test(value);
const active = game => ['live','halftime','intermission'].includes(game?.phase) || game?.state === 'in';
const scoreOf = game => ({away:n(game?.away?.score),home:n(game?.home?.score)});
const leadOf = scores => scores.away == null || scores.home == null || scores.away === scores.home ? null : scores.away > scores.home ? 'away':'home';
function player(value) {
  if (!value?.name) return null;
  let headshot=null;
  try {const u=new URL(value.headshot); if(u.protocol==='https:' && ['a.espncdn.com','media.formula1.com'].includes(u.hostname) && !u.username && !u.password && !u.port)headshot=u.href;}catch{}
  return {id:value.id||null,name:String(value.name).slice(0,90),headshot};
}
function playKey(play) { return identity(String(play?.id || '')) ? String(play.id) : null; }
function classify(play,sport) {
  if(play.isNoPlay || /\b(?:NO PLAY|overturned|rescinded|disallowed|cancelled)\b/i.test(play.text || '')) return null;
  const text=`${play.scoringType || ''} ${play.type || ''} ${play.text || ''}`;
  const scoring=play.scoringPlay===true;
  if(sport==='basketball'){
    if(scoring && /three[ -]point|3[ -]point|3pt/i.test(text))return event('three-pointer','THREE-POINTER',3);
    if(scoring && /free[ -]throw/i.test(text))return event('free-throw','FREE THROW',1);
    if(scoring && /dunk/i.test(text))return event('dunk','DUNK',2);
    if(scoring && play.scoreValue===2)return event('two-pointer','TWO POINTS',2);
    if(!scoring && /\bblock(?:ed|s)?\b/i.test(play.type||''))return event('block','BLOCK');
    if(!scoring && /\bsteal\b/i.test(play.type||''))return event('steal','STEAL');
  }
  if(sport==='baseball'){
    if(scoring && /grand[ -]slam/i.test(text))return event('grand-slam','GRAND SLAM',4);
    if(scoring && /home[ -]run|homers/i.test(text))return event('home-run','HOME RUN',n(play.scoreValue));
    if(!scoring && /strikeout|strikes out/i.test(play.type||''))return event('strikeout','STRIKEOUT');
    if(scoring)return event('run','RUN SCORED',n(play.scoreValue));
  }
  if(sport==='soccer' || sport==='hockey'){
    if(scoring && /goal/i.test(text))return /penalty/i.test(text) && sport==='soccer'?event('penalty-goal','PENALTY GOAL',1):event('goal','GOAL',1);
    if(sport==='soccer' && /red[ -]card|second yellow/i.test(play.type||''))return event('red-card','RED CARD');
  }
  if(sport==='tennis' || sport==='volleyball'){
    if(/ace/i.test(play.type||''))return event('ace',sport==='tennis'?'ACE':'SERVICE ACE');
    if(/break of serve/i.test(play.type||''))return event('break','BREAK OF SERVE');
    if(/set won|wins (?:the )?set/i.test(play.type||''))return event('set','SET WON');
    if(sport==='volleyball' && /block/i.test(play.type||''))return event('block','BLOCK');
  }
  if(sport==='rugby'){
    if(scoring && /\btry\b/i.test(text))return event('try','TRY',n(play.scoreValue));
    if(scoring && /conversion/i.test(text))return event('conversion','CONVERSION',n(play.scoreValue));
    if(scoring && /drop[ -]goal/i.test(text))return event('drop-goal','DROP GOAL',n(play.scoreValue));
    if(scoring && /penalty/i.test(text))return event('penalty','PENALTY GOAL',n(play.scoreValue));
  }
  if(sport==='golf'){
    if(/hole in one|hole-in-one/i.test(text))return event('hole-in-one','HOLE IN ONE');
    if(/eagle/i.test(play.type||''))return event('eagle','EAGLE');
    if(/birdie/i.test(play.type||''))return event('birdie','BIRDIE');
  }
  return scoring?event('score','SCORE UPDATE',n(play.scoreValue)):null;
}
function ordered(plays){return [...plays].sort((a,b)=>Number.isFinite(a.sequenceNumber)&&Number.isFinite(b.sequenceNumber)?a.sequenceNumber-b.sequenceNumber:/^\d+$/.test(a.id||'')&&/^\d+$/.test(b.id||'')?(BigInt(a.id)<BigInt(b.id)?-1:BigInt(a.id)>BigInt(b.id)?1:0):Date.parse(a.wallclock||'')-Date.parse(b.wallclock||''));}
function flagEvent(flag){const key=String(flag||'').toLowerCase().replaceAll('_','-').replaceAll(' ','-');return ({red:'red-flag','red-flag':'red-flag',yellow:'yellow-flag','yellow-flag':'yellow-flag',sc:'safety-car','safety-car':'safety-car',vsc:'virtual-safety-car','virtual-safety-car':'virtual-safety-car',green:'green-flag','green-flag':'green-flag',chequered:'checkered-flag',checkered:'checkered-flag','checkered-flag':'checkered-flag'})[key]||null;}

/** Sport-specific notices require new, fresh evidence; opening a game is silent. */
export function createMultiSportEventTracker({resumeGapMs=45000,eventMaxAgeMs=90000,...options}={}) {
  const football=createFootballTracker(options);
  let context=null, previous=null, previousAt=null, lastLeader=null, raceLeader=null, lastFlag=null, seen=new Set(), hasPlays=false, pending=[], credits={away:[],home:[]}, high={away:null,home:null}, finalUntil=0, timingMode=null;
  function reset(){football.reset();context=null;previous=null;previousAt=null;lastLeader=null;raceLeader=null;lastFlag=null;seen=new Set();hasPlays=false;pending=[];credits={away:[],home:[]};high={away:null,home:null};finalUntil=0;timingMode=null;}
  function update({game,details=null,contextKey='',now=Date.now(),silent=false}={}){
    if(!game?.id){reset();return [];}
    const sport=sportFor(game);
    if(sport==='football')return football.update({game,details,contextKey,now,silent});
    const matching=details && details.gameId===(game.detailsGameId||game.id) && !details.stale;
    const plays=ordered([...array(matching?details.eventPlays:[]),...(game.lastPlayDetails?[game.lastPlayDetails]:[])].filter(p=>playKey(p)));
    const nextContext=`${contextKey}/${game.leagueId||''}/${game.id}`;
    const scores=scoreOf(game), entries=array(game.entries), leader=entries.find(e=>e.position===1);
    const leaderId=leader?.athlete?.id||leader?.id||null, currentFlag=flagEvent(game.flag);
    const shouldSeed=silent||context!==nextContext||previousAt===null||now<previousAt||now-previousAt>resumeGapMs;
    if(shouldSeed){reset();context=nextContext;previous={...scores,_active:active(game)};previousAt=now;lastLeader=leadOf(scores);raceLeader=leaderId;lastFlag=currentFlag;timingMode=game.openF1SessionKey||null;hasPlays=plays.length>0;for(const p of plays)seen.add(playKey(p));high={...scores};return [];}
    const wasActive=previous._active===undefined?true:previous._active;
    const final=game.state==='post'||game.phase==='final';
    if(final&&wasActive)finalUntil=now+30000;
    const canEmit=active(game)||(final&&now<finalUntil);
    const corrected=['away','home'].some(s=>scores[s]!=null&&previous[s]!=null&&scores[s]<previous[s]);
    const result=[];
    const notice=(kind,teamId,extra={})=>{const spec=eventsForSport(sport).find(e=>e.kind===kind)||event(kind,kind.toUpperCase().replaceAll('-',' '));return {id:`${game.id}:${kind}:${now}:${result.length}`,gameId:game.id,teamId,...spec,detail:'',player:null,...extra};};
    if(['race','leaderboard'].includes(game.kind)){
      if(timingMode!==(game.openF1SessionKey||null)){timingMode=game.openF1SessionKey||null;raceLeader=leaderId;lastFlag=currentFlag;previous={...scores,_active:active(game)};previousAt=now;return [];}
      if(canEmit){
        if(leaderId&&raceLeader&&leaderId!==raceLeader){const qualifying=/qual|practice|shootout/i.test(`${game.sessionType} ${game.sessionName}`);result.push(notice(qualifying?'session-best':'lead-change',leader.team?.id||leaderId,{player:player(leader.athlete||leader),detail:qualifying?'Fastest reported session time.':'Reported classification leader changed.'}));}
        const newFlagEvidence=array(game.raceControl).some(message=>{const at=Date.parse(message.date||message.timestamp||'');return Number.isFinite(at)&&at>previousAt&&at<=now+15000&&now-at<=eventMaxAgeMs;});
        if(currentFlag&&currentFlag!==lastFlag&&(lastFlag||newFlagEvidence))result.push(notice(currentFlag,null,{detail:array(game.raceControl).at(-1)?.message||''}));
      }
      raceLeader=leaderId||raceLeader;lastFlag=currentFlag||lastFlag;
      previous={...scores,_active:active(game)};previousAt=now;return result.slice(-4);
    }
    if(corrected||!canEmit){pending=[];credits={away:[],home:[]};for(const p of plays)seen.add(playKey(p));}
    if(canEmit&&!corrected){
      for(const side of ['away','home']){
        if(scores[side]!=null&&previous[side]!=null&&scores[side]>previous[side]){
          for(let value=previous[side]+1;value<=scores[side]&&credits[side].length<32;value++)credits[side].push({point:value,at:now,generic:high[side]===null||previous[side]>=high[side]});
        }
        credits[side]=credits[side].filter(c=>now-c.at<45000);
      }
      // An entire summary arriving after the scoreboard first loaded is history.
      // Exact score credits can still identify the new score inside that summary.
      for(const play of plays){
        const key=playKey(play);if(seen.has(key))continue;
        seen.add(key);
        const stamp=Date.parse(play.wallclock||'');
        if(Number.isFinite(stamp)&&(now-stamp>eventMaxAgeMs||stamp>now+15000))continue;
        const spec=classify(play,sport);if(!spec)continue;
        const teamId=play.scoringTeamId||play.teamId;
        const side=['away','home'].find(s=>game[s]?.id===teamId);
        if(!side)continue;
        const scoring=play.scoringPlay===true;
        if(scoring){pending.push({play,spec,side,at:now,eligible:hasPlays||(Number.isFinite(stamp)&&stamp>previousAt)});}
        else if((hasPlays||(Number.isFinite(stamp)&&stamp>previousAt))&&!final)result.push(notice(spec.kind,teamId,{...spec,id:`${game.id}:${key}:${spec.kind}`,detail:play.text||'',player:player(play.player)}));
      }
      for(const item of pending){
        const {play,spec,side}=item;const total=n(play.scores?.[side]);
        const points=spec.points || n(play.scoreValue);
        const available=credits[side];
        let consumed=[];
        if(points>0&&total!=null)consumed=available.filter(c=>c.point<=total&&c.point>total-points);
        else if(item.eligible&&points>0&&available.length===points)consumed=[...available];
        else if(item.eligible&&spec.kind==='home-run'&&available.length>0&&available.length<=4)consumed=[...available];
        if(!consumed.length||(points>0&&consumed.length!==points))continue;
        credits[side]=available.filter(c=>!consumed.includes(c));item.done=true;
        let statDetail='';
        if(spec.kind==='three-pointer'){
          const row=array(details?.allTeamStats).find(r=>/threePointFieldGoalPct|threePointPct|threePointPercentage|^3ptPct$/i.test(r.key));
          if(row?.[side]!=null)statDetail=`3PT ${String(row[side]).replace(/%?$/,'%')}`;
        }
        result.push(notice(spec.kind,game[side].id,{...spec,id:`${game.id}:${playKey(play)}:${spec.kind}`,points:consumed.length,detail:play.text||'',statDetail,player:player(play.player)}));
      }
      pending=pending.filter(item=>!item.done&&now-item.at<45000).slice(-32);
      for(const side of ['away','home']){
        const mature=credits[side].filter(c=>c.generic&&now-c.at>=8000);
        if(mature.length){result.push(notice('score',game[side].id,{title:'SCORE UPDATE',points:mature.length}));credits[side]=credits[side].filter(c=>!mature.includes(c));}
      }
      if(['tennis','volleyball'].includes(sport))for(const side of ['away','home']){if(scores[side]!=null&&previous[side]!=null&&scores[side]===previous[side]+1){result.push(notice('set',game[side].id,{detail:'Reported sets won increased.'}));credits[side]=[];}}
      const newLeader=leadOf(scores);
      if(newLeader&&lastLeader&&newLeader!==lastLeader&&['basketball','baseball','hockey','soccer','rugby'].includes(sport))result.push(notice('lead-change',game[newLeader].id));
      if(newLeader)lastLeader=newLeader;
      if(final&&wasActive&&['tennis','volleyball'].includes(sport)&&newLeader)result.push(notice('match',game[newLeader].id));
    }
    if(corrected)lastLeader=leadOf(scores);
    for(const side of ['away','home'])if(scores[side]!=null)high[side]=Math.max(high[side]??scores[side],scores[side]);
    previous={...scores,_active:active(game)};previousAt=now;hasPlays ||= plays.length>0;
    while(seen.size>512)seen.delete(seen.values().next().value);
    return result.slice(-4);
  }
  return {update,reset};
}
export function selectSportDemoPlayer(details,teamId,kind,sport='football') {
  if(sport==='football')return footballDemoPlayer(details,teamId,kind);
  for(const p of array(details?.eventPlays))if((p.scoringTeamId||p.teamId)===teamId&&classify(p,sport)?.kind===kind)return player(p.player);
  return player(array(details?.players).find(p=>p.teamId===teamId));
}
