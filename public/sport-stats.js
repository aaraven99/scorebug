import { sportFor } from './sports.js';
export const SPORT_STAT_KEYS = Object.freeze({
  football:['totalYards','netPassingYards','rushingYards','thirdDownEff','turnovers','possessionTime'],
  basketball:['fieldGoalPct','threePointFieldGoalPct','freeThrowPct','totalRebounds','assists','turnovers','steals','blocks','pointsInPaint','fastBreakPoints','largestLead'],
  baseball:['batting.runs','batting.hits','batting.homeRuns','batting.walks','batting.strikeouts','fielding.errors','batting.avg','batting.onBasePct','batting.slugAvg','hits','runs','errors'],
  hockey:['shotsTotal','shots','shotsOnGoal','powerPlayPercentage','powerPlayGoals','hits','blockedShots','faceoffPercent','faceoffsWon','giveaways','takeaways','penaltyMinutes'],
  soccer:['possessionPct','possession','shotsOnTarget','shotsOnGoal','totalShots','foulsCommitted','yellowCards','redCards','cornerKicks','offsides','saves'],
  tennis:['aces','doubleFaults','firstServePercentage','firstServePointsWon','breakPointsWon','winners','unforcedErrors','totalPointsWon'],
  volleyball:['kills','hittingPercentage','assists','serviceAces','digs','blocks','errors'],
  rugby:['tries','conversions','penaltyGoals','meters','possession','tackles','turnoversConceded','penaltiesConceded'],
  cricket:['runs','wickets','runRate','boundaries','extras'],
});
const lower = new Set(['turnovers','errors','doubleFaults','unforcedErrors','fouls','foulsCommitted','personalFouls','yellowCards','redCards','offsides','giveaways','penaltyMinutes','penaltiesConceded','turnoversConceded']);
const neutral = new Set(['possession','possessionPct','foulsDrawn','attempts','leftOnBase']);
export function statPriority(gameOrSport) { return SPORT_STAT_KEYS[typeof gameOrSport==='string'?gameOrSport:sportFor(gameOrSport)] || []; }
export function statDirection(key,sport='football') {
  if(sport==='football')return null;
  if(sport==='baseball' && key.includes('.')){const [category,name]=key.split('.');if(category==='fielding')return name==='errors'?'lower':'neutral';if(category==='pitching')return ['earnedRuns','hits','walks','homeRuns','ERA','era'].includes(name)?'lower':['strikeouts'].includes(name)?'higher':'neutral';if(category==='batting')return ['strikeouts'].includes(name)?'lower':['runs','hits','homeRuns','walks','avg','battingAvg','onBasePct','slugAvg','RBIs','rbi','doubles','triples','stolenBases'].includes(name)?'higher':'neutral';}
  if(lower.has(key))return 'lower';
  if(neutral.has(key))return 'neutral';
  if(sport==='baseball' && ['strikeouts','walks'].includes(key))return 'neutral';
  if(statPriority(sport).includes(key) || /(?:Pct|Percentage|Percent)$/.test(key) || ['points','rebounds','defensiveRebounds','offensiveRebounds','blockedShots','saves','totalPoints','shotsOnGoal'].includes(key))return 'higher';
  return 'neutral';
}
export const SPORT_METRICS = Object.freeze({
  basketball:[['fieldGoalPct',2,15],['threePointFieldGoalPct',1.2,15],['totalRebounds',1.2,12],['assists',1,10],['turnovers',1.4,8],['steals',.7,5],['blocks',.7,5]],
  baseball:[['batting.hits',2,6],['batting.homeRuns',1.5,3],['fielding.errors',1,3],['batting.avg',1,.15],['batting.onBasePct',1.2,.2]],
  hockey:[['shotsTotal',2,15],['shotsOnGoal',2,15],['shots',2,15],['powerPlayPercentage',1,35],['faceoffPercent',.5,20],['giveaways',.5,10],['blockedShots',.5,10]],
  soccer:[['shotsOnTarget',2,5],['shotsOnGoal',2,5],['totalShots',.8,10],['redCards',1.4,1],['cornerKicks',.4,6]],
  tennis:[['firstServePercentage',1,20],['firstServePointsWon',1,20],['breakPointsWon',2,3],['unforcedErrors',1.2,15],['winners',1,15],['aces',.5,8]],
  volleyball:[['kills',1.5,15],['hittingPercentage',2,.2],['serviceAces',1,5],['blocks',1,6],['errors',1.5,10]],
  rugby:[['tries',2,3],['meters',1,200],['tackles',.5,40],['turnoversConceded',1,5],['penaltiesConceded',1,6]],
});

export function statLabel(row){
  const [category,key]=String(row?.key||'').includes('.')?row.key.split('.'):[null,row?.key];
  const labels={hits:'Hits',runs:'Runs',homeRuns:'Home runs',strikeouts:'Strikeouts',walks:'Walks',errors:'Errors',avg:'Batting average',battingAvg:'Batting average',onBasePct:'On-base percentage',slugAvg:'Slugging percentage',RBI:'Runs batted in',RBIs:'Runs batted in',rbi:'Runs batted in',atBats:'At-bats',earnedRuns:'Earned runs',ERA:'ERA',era:'ERA',fieldGoalPct:'Field goal percentage',threePointFieldGoalPct:'Three-point percentage',threePointFieldGoalsMade:'Three-pointers made',freeThrowPct:'Free throw percentage',totalRebounds:'Rebounds',shotsTotal:'Shots',faceoffsWon:'Faceoffs won'};
  const label=labels[key]||row?.label||String(key||'').replace(/([a-z])([A-Z])/g,'$1 $2');
  return category==='pitching'?`Pitching · ${label}`:category==='fielding'?`Fielding · ${label}`:label;
}
