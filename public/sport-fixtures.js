import { referenceGame } from './fixtures.js';
import { getLeague } from './sports.js';
const side = (leagueId,id,name,abbreviation,color,score,extra={}) => ({id:`${leagueId}:${id}`,name,abbreviation,color,score,...extra});
const fixtures = {
  nba:[['13','Los Angeles Lakers','LAL','#552583'],['2','Boston Celtics','BOS','#007a33']],
  wnba:[['14','Seattle Storm','SEA','#2c5234'],['6','Las Vegas Aces','LV','#c8102e']],
  mlb:[['10','New York Yankees','NYY','#132448'],['19','Los Angeles Dodgers','LAD','#005a9c']],
  nhl:[['4','Chicago Blackhawks','CHI','#cf0a2c'],['5','Detroit Red Wings','DET','#ce1126']],
  epl:[['359','Arsenal','ARS','#ef0107'],['363','Chelsea','CHE','#034694']],
  ucl:[['86','Real Madrid','RMA','#f6f6f6'],['382','Manchester City','MCI','#6cabdd']],
  atp:[['s1','Player One','ONE','#204e35'],['s2','Player Two','TWO','#303d72']],
};
export function referenceForLeague(leagueId='nfl', teams=[]) {
  const league = getLeague(leagueId) || getLeague('nfl');
  if (league.id === 'nfl') return {...referenceGame, leagueId:'nfl',sport:'football', fieldPosition:'KC 37'};
  const base = {id:`reference-${league.id}`,leagueId:league.id,sport:league.sport,kind:league.kind,state:'in',phase:'live',isLive:true,status:'Sample · not live data',startTime:null,period:2,clock:'6:42',lastPlay:'',situation:{}};
  if (['race','leaderboard'].includes(league.kind)) {
    const golf = league.sport === 'golf';
    const entries = (teams.length ? teams.slice(0,8) : [
      {id:`${league.id}:s1`,name:golf?'Player One':'Lando Norris',abbreviation:golf?'ONE':'NOR',color:'#ff8000'},
      {id:`${league.id}:s2`,name:golf?'Player Two':'Max Verstappen',abbreviation:golf?'TWO':'VER',color:'#3671c6'},
      {id:`${league.id}:s3`,name:golf?'Player Three':'Charles Leclerc',abbreviation:golf?'THR':'LEC',color:'#e80020'},
      {id:`${league.id}:s4`,name:golf?'Player Four':'George Russell',abbreviation:golf?'FOU':'RUS',color:'#27f4d2'},
      {id:`${league.id}:s5`,name:golf?'Player Five':'Oscar Piastri',abbreviation:golf?'FIV':'PIA',color:'#ff8000'},
    ]).map((team,index)=>({id:team.id,position:index+1,athlete:{id:team.id,name:team.name,abbreviation:team.abbreviation},team:{id:team.id,name:team.name,abbreviation:team.abbreviation,color:team.color||'#467165'},gap:index?`+${(index*1.842).toFixed(3)}`:'Leader',interval:index?'+1.842':null,laps:23,lapTime:'1:24.312',score:golf?`${-9+index}`:null,status:'Running'}));
    return {...base,name:golf?'Sample leaderboard':'Sample race',sessionName:golf?'Round 2':'Race',sessionType:golf?'round':'race',lap:golf?null:23,totalLaps:golf?null:58,flag:golf?null:'green',entries,clock:null};
  }
  const sport = league.sport;
  const values = sport === 'basketball'?[82,79]:sport === 'baseball'?[3,2]:sport === 'hockey'?[2,1]:sport === 'tennis'?[1,1]:sport === 'volleyball'?[2,1]:sport === 'football'?[21,17]:sport === 'rugby'?[17,12]:[2,1];
  const fallback = fixtures[league.id] || [['sample-away','Away team','AWY','#244a70'],['sample-home','Home team','HME','#9a2933']];
  const real = teams.filter(t=>t && t.name && t.id).slice(0,2);
  const pair = ['away','home'].map((_,i)=>real[i]?{...real[i],score:values[i]}:side(league.id,...fallback[i],values[i]));
  if (['nba','mlb','nhl'].includes(league.id)) pair.forEach((team,i)=>{ if (!team.logo && fixtures[league.id]) team.logo=`https://a.espncdn.com/i/teamlogos/${league.id}/500/${fallback[i][0]}.png`; });
  const game={...base,away:pair[0],home:pair[1],name:`${pair[0].name} at ${pair[1].name}`,possessionTeamId:pair[0].id};
  if(sport==='football'){game.away.timeouts=2;game.home.timeouts=3;game.downDistance='2ND & 6';game.fieldPosition=`${game.home.abbreviation} 34`;}
  if(sport==='basketball'){game.period=league.regulationPeriods===2?2:3;game.away.timeouts=4;game.home.timeouts=3;game.situation={shotClock:18,bonusTeamId:game.home.id};}
  if(sport==='baseball'){game.clock=null;game.period=7;game.situation={half:'top',balls:2,strikes:1,outs:1,onFirst:true,onSecond:false,onThird:true};}
  if(sport==='hockey'){game.situation={powerPlayTeamId:game.away.id,powerPlayTime:'1:12'};}
  if(['soccer','rugby'].includes(sport)){game.clock='67:24';game.situation={};}
  if(sport==='tennis'){game.clock=null;game.period=3;game.situation={pointScore:'30–15',servingTeamId:game.away.id};game.away.linescores=[6,3,4];game.home.linescores=[4,6,3];}
  if(sport==='volleyball'){game.clock=null;game.period=4;game.situation={pointScore:'19–17',servingTeamId:game.away.id};game.away.linescores=[25,21,25,19];game.home.linescores=[20,25,23,17];}
  return game;
}
