import { sportFor, getLeague } from './sports.js';
import { statDirection, statLabel, SPORT_METRICS } from './sport-stats.js';
// A small, transparent description of the game in progress. These weights are
// hand chosen, not fitted or calibrated against historical NFL outcomes.
const STAT_METRICS = [
  { key: 'totalYards', weight: 2, scale: 150 },
  { key: 'yardsPerPlay', weight: 2, scale: 2 },
  { key: 'thirdDownEff', weight: 1.5, scale: 25 },
  { key: 'turnovers', weight: 2.5, scale: 2 },
  { key: 'redZoneAttempts', weight: 1, scale: 35 },
  { key: 'possessionTime', weight: 0.5, scale: 600 },
];
const HIGHER = new Set([
  'totalYards', 'netPassingYards', 'rushingYards', 'firstDowns', 'firstDownsPassing',
  'firstDownsRushing', 'firstDownsPenalty', 'yardsPerPlay', 'yardsPerPass', 'yardsPerRushAttempt',
  'thirdDownEff', 'fourthDownEff', 'redZoneAttempts', 'completionAttempts', 'possessionTime', 'defensiveTouchdowns',
]);
const LOWER = new Set(['turnovers', 'interceptions', 'fumblesLost', 'penalties', 'penaltyYards', 'sacksAllowed', 'sackYardsLost']);
const RATIOS = new Set(['thirdDownEff', 'fourthDownEff', 'redZoneAttempts', 'completionAttempts']);
const PREDICTION_METHOD = 'Simple, uncalibrated estimate using score and time, with smaller adjustments for current possession, field position and fresh team stats.';
const PERFORMANCE_METHOD = 'Relative game performance, not a win probability: yards, yards per play, third-down rate, turnovers, red-zone rate and possession time. Missing stats do not count as zero.';
const list = (value) => Array.isArray(value) ? value : [];
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const roundedSigned = (value) => Math.sign(value) * Math.round(Math.abs(value));

function numeric(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !/^-?(?:\d+(?:\.\d+)?|\.\d+)%?$/.test(value.trim())) return null;
  return Number(value.trim().replace(/%$/, ''));
}
function displayed(value) {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const result = String(value).trim();
  return result && !/^(?:[-–—]+|n\/?a)$/i.test(result) ? result : null;
}
function seconds(value) {
  const text=typeof value === 'string' ? value : '';
  const match = /^(\d{1,3}):([0-5]\d(?:\.\d+)?)$/.exec(text);
  if(match)return Number(match[1])*60+Number(match[2]);
  return /^\d{1,2}\.\d+$/.test(text)?Number(text):null;
}
function pair(value) {
  const match = /^(\d+)\s*[-/]\s*(\d+)$/.exec(typeof value === 'string' ? value.trim() : '');
  return match ? [Number(match[1]), Number(match[2])] : null;
}
function rate(value) {
  const parsed = pair(value);
  if (!parsed || parsed[1] === 0 || parsed[0] > parsed[1]) return null;
  // Compare the same rounded percentage that the user sees.
  return Math.round(parsed[0] / parsed[1] * 1000) / 10;
}
function relation(away, home) {
  return away === null || home === null ? null : away > home ? '>' : away < home ? '<' : '=';
}
function comparisonRow(row, sport = 'football') {
  const key = row.key;
  const direction = statDirection(key,sport) || (LOWER.has(key) ? 'lower' : HIGHER.has(key) ? 'higher' : 'neutral');
  let away = displayed(row.away), home = displayed(row.home), awayValue, homeValue;
  let note = direction === 'lower' ? 'Fewer is better' : direction === 'neutral' ? 'Context only' : '';
  if (RATIOS.has(key)) {
    awayValue = rate(away); homeValue = rate(home);
    if (awayValue !== null) away = `${away.replace('-', '/')} · ${awayValue}%`;
    if (homeValue !== null) home = `${home.replace('-', '/')} · ${homeValue}%`;
    note = 'Compared by success rate; no attempts means no rate yet';
  } else if (key === 'possessionTime') {
    awayValue = seconds(away); homeValue = seconds(home);
    note = 'Time of possession';
  } else {
    awayValue = numeric(away); homeValue = numeric(home);
  }
  const comparison = relation(awayValue, homeValue);
  const betterSide = comparison === null || direction === 'neutral' ? null : comparison === '=' ? 'even'
    : ((awayValue > homeValue) === (direction === 'higher') ? 'away' : 'home');
  return { ...row, label:statLabel(row), away, home, awayValue, homeValue, comparison, betterSide, direction, note };
}

/** Mathematical comparison and the favorable side are deliberately separate. */
export function buildComparisonRows(summary, {sport = summary?.sport || 'football'} = {}) {
  const raw = new Map();
  for (const row of [...list(summary?.allTeamStats), ...list(summary?.teamStats)]) {
    if (row && typeof row.key === 'string' && !raw.has(row.key)) raw.set(row.key, row);
  }
  const rows = new Map();
  const add = (row) => { if (!rows.has(row.key)) rows.set(row.key, comparisonRow(row,sport)); };
  for (const row of raw.values()) {
    if (row.key === 'totalPenaltiesYards' || row.key === 'sacksYardsLost') {
      const away = pair(row.away), home = pair(row.home);
      if (!away && !home) { add(row); continue; }
      const columns = row.key === 'totalPenaltiesYards'
        ? [['penalties', 'Penalties'], ['penaltyYards', 'Penalty yards']]
        : [['sacksAllowed', 'Sacks allowed'], ['sackYardsLost', 'Sack yards lost']];
      columns.forEach(([key, label], index) => add({
        key, label, sourceKey: row.key, away: away ? String(away[index]) : null, home: home ? String(home[index]) : null,
      }));
    } else add(row);
  }
  return [...rows.values()];
}

export function getPerformanceScore(rows, { stale = false, sport = 'football' } = {}) {
  let metrics = sport === 'football' ? STAT_METRICS : (SPORT_METRICS[sport] || []).map(([key,weight,scale])=>({key,weight,scale}));
  if (sport === 'hockey' || sport === 'soccer') { const keys=new Set(list(rows).map(r=>r.key)); if(keys.has('shotsTotal'))metrics=metrics.filter(m=>m.key!=='shots'&&m.key!=='shotsOnGoal');else if(keys.has('shotsOnGoal'))metrics=metrics.filter(m=>m.key!=='shots'&&m.key!=='shotsOnTarget'); }
  const byKey = new Map(list(rows).map((row) => [row.key, row]));
  const evidence = [];
  for (const metric of metrics) {
    const row = byKey.get(metric.key);
    if (!row || row.awayValue === null || row.homeValue === null
      || !Number.isFinite(row.awayValue) || !Number.isFinite(row.homeValue)) continue;
    const favorableDifference = (row.awayValue - row.homeValue) * (row.direction === 'lower' ? -1 : 1);
    const strength = Math.tanh(favorableDifference / metric.scale);
    evidence.push({
      key: row.key, label: row.label, side: row.betterSide, away: row.away, home: row.home,
      weight: metric.weight, impact: strength * metric.weight,
      description: row.betterSide === 'even' ? `${row.label}: even` : `${row.label}: ${row.betterSide} has the edge${row.direction === 'lower' ? ' (fewer is better)' : ''}`,
    });
  }
  const coverage = { used: evidence.length, total: metrics.length };
  const drivers = evidence.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
  const available = evidence.length >= 2;
  const totalWeight = evidence.reduce((total, item) => total + item.weight, 0);
  const edge = available ? evidence.reduce((total, item) => total + item.impact, 0) / totalWeight : null;
  const away = edge === null ? null : 50 + roundedSigned(edge * 45);
  return {
    available, away, home: away === null ? null : 100 - away, edge,
    label: 'Game performance', stale: Boolean(stale), coverage, drivers,
    reason: !available ? 'Waiting for at least two comparable team stats.'
      : stale ? 'Relative stat score from the last available totals; those stats are delayed.'
        : `Relative stat score using ${coverage.used} of ${coverage.total} measures. This is not a win probability.`,
    method: sport === 'football' ? PERFORMANCE_METHOD : 'Relative score from available sport-specific measures. Hand-chosen weights; not a win probability. Missing totals are omitted.',
  };
}

function matchesGame(game, summary) {
  if (!game || !summary) return false;
  // Independent score providers may retain their own public game ID while a
  // uniquely matched fixture supplies the ESPN ID used by the details poller.
  if (game.detailsGameId === null) return false;
  const detailsId = game.detailsGameId || game.id;
  if (detailsId && summary.gameId && String(detailsId) !== String(summary.gameId)) return false;
  return ['away', 'home'].every((side) => !game[side]?.id || !summary[side]?.id || String(game[side].id) === String(summary[side].id));
}
function currentPossession(game, summary) {
  if (game.phase !== 'live') return null;
  const freshSummary = matchesGame(game, summary) && !summary.stale && !summary.statsStale && summary.phase === 'live';
  const id = game.possessionTeamId || (freshSummary ? summary.situation?.possessionTeamId : null);
  const side = id && ['away', 'home'].find((name) => String(game[name]?.id) === String(id));
  if (!side) return null;
  let fieldPosition = displayed(game.fieldPosition), yardsToEndzone = null;
  const field = /^([A-Z0-9]{2,4})\s+(\d{1,2})$/.exec(fieldPosition || '');
  if (field && Number(field[2]) <= 50) {
    const own = game[side]?.abbreviation === field[1];
    const opposite = game[side === 'away' ? 'home' : 'away']?.abbreviation === field[1];
    if (own || opposite) yardsToEndzone = own ? 100 - Number(field[2]) : Number(field[2]);
  } else if (fieldPosition === '50') yardsToEndzone = 50;
  if (yardsToEndzone === null && freshSummary && String(summary.situation?.possessionTeamId) === String(id)) {
    const supplied = numeric(summary.situation?.yardsToEndzone);
    if (supplied !== null && supplied >= 0 && supplied <= 100) {
      yardsToEndzone = supplied;
      fieldPosition ||= displayed(summary.situation?.fieldPosition);
    }
  }
  return { side, fieldPosition, yardsToEndzone };
}
function unavailable(reason, stale = false) {
  return { available: false, away: null, home: null, kind: 'unavailable', tie: false, stale,
    label: 'Simple win estimate', reason, method: PREDICTION_METHOD, calibrated: false, drivers: [] };
}

/** Live estimate only; a reported final is returned as a result, not a forecast. */
export function estimateWin(game, summary, { stale = false, performance } = {}) {
  if (!game) return unavailable('Choose a game to see its estimate.');
  if (sportFor(game) !== 'football') return estimateOtherWin(game, summary, {stale,performance});
  if (stale || game.stale) return unavailable('Waiting for a fresh score and game clock.', true);
  const phase = game.phase;
  if (['scheduled', 'postponed', 'canceled', 'delayed', 'suspended', 'unknown'].includes(phase)
    || (game.state === 'pre' && phase !== 'live')) {
    return unavailable(phase === 'scheduled' || game.state === 'pre' ? 'The estimate starts once the game is in progress.' : 'The estimate is paused until live game information returns.');
  }
  const awayScore = numeric(game.away?.score), homeScore = numeric(game.home?.score);
  if (awayScore === null || homeScore === null || awayScore < 0 || homeScore < 0) return unavailable('Waiting for both teams’ scores.');
  const lead = awayScore - homeScore;
  if (phase === 'final' || game.state === 'post') {
    const tie = lead === 0;
    return { available: !tie, away: tie ? null : lead > 0 ? 100 : 0, home: tie ? null : lead < 0 ? 100 : 0,
      kind: 'result', tie, stale: false, label: tie ? 'Final · tie' : 'Final result',
      reason: tie ? 'The game finished tied; there is no winning side.' : 'The game is final. These values describe the result, not a prediction.',
      method: null, calibrated: false, drivers: [],
    };
  }
  if (!['live', 'halftime', 'intermission'].includes(phase) && game.state !== 'in') return unavailable('Waiting for an in-progress game.');
  const period = Number.isInteger(game.period) && game.period > 0 ? game.period : null;
  const overtime = period !== null && period > 4;
  let remaining = null;
  if (phase === 'halftime') remaining = 1800;
  else if (!overtime && period !== null && period <= 4) {
    const time = seconds(game.clock) ?? (phase === 'intermission' ? 0 : null);
    if (time !== null && time <= 900) remaining = (4 - period) * 900 + time;
  }
  if (!overtime && remaining === null) return unavailable('Waiting for the quarter and game clock.');
  if (!overtime && remaining === 0 && lead === 0) return unavailable('The score is tied at 0:00; waiting for overtime or the final result.');
  const possession = currentPossession(game, summary);
  const fieldBonus = possession ? 0.55 + (possession.yardsToEndzone === null ? 0 : 1.65 * clamp((60 - possession.yardsToEndzone) / 60, 0, 1)) : 0;
  const possessionPoints = fieldBonus * (possession?.side === 'away' ? 1 : -1);
  const freshPerformance = performance?.available && !performance.stale && matchesGame(game, summary);
  const statsPoints = freshPerformance ? performance.edge * 2 * (performance.coverage.used / performance.coverage.total)
    * (overtime ? 0.35 : clamp((3600 - remaining) / 900, 0, 1)) : 0;
  const uncertainty = overtime ? 5.5 : 3.5 + 10 * Math.sqrt(remaining / 3600);
  const probability = 1 / (1 + Math.exp(-(lead + possessionPoints + statsPoints) / uncertainty));
  const away = clamp(50 + roundedSigned((probability - 0.5) * 100), overtime ? 5 : 1, overtime ? 95 : 99);
  const drivers = [
    { key: 'score', label: 'Score', side: lead > 0 ? 'away' : lead < 0 ? 'home' : 'even', impact: lead,
      description: lead === 0 ? 'The score is tied.' : `${lead > 0 ? game.away.abbreviation || 'Away' : game.home.abbreviation || 'Home'} leads by ${Math.abs(lead)}.` },
    { key: 'time', label: 'Game clock', side: null, impact: 0,
      description: overtime ? 'Overtime: this model does not simulate the possession rules.'
        : `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')} left in regulation; a score lead carries more weight as time runs out.` },
  ];
  if (possession) drivers.push({ key: 'possession', label: 'Possession', side: possession.side, impact: possessionPoints,
    description: `${game[possession.side]?.abbreviation || possession.side} has the ball${possession.fieldPosition ? ` at ${possession.fieldPosition}` : ''}.` });
  if (freshPerformance) drivers.push({ key: 'teamStats', label: 'Team stats', side: statsPoints > 0 ? 'away' : statsPoints < 0 ? 'home' : 'even', impact: statsPoints,
    description: `${performance.coverage.used} fresh stat measures add a small adjustment.` });
  return {
    available: true, away, home: 100 - away, kind: 'estimate', tie: false, stale: false,
    label: 'Simple win estimate', calibrated: false, method: PREDICTION_METHOD, drivers,
    reason: overtime ? 'Overtime estimate with extra uncertainty; it does not model each overtime possession.'
      : remaining === 0 ? 'The clock shows 0:00; waiting for a confirmed final result.'
        : freshPerformance ? 'Based mainly on the score and time remaining, with smaller possession and stat adjustments.'
          : 'Based on the score, time and available current possession. Delayed or missing team stats are left out.',
  };
}

export function getGameInsights(game, summary, { stale = false } = {}) {
  const details = matchesGame(game, summary) ? summary : null;
  const sport = sportFor(game);
  const rows = buildComparisonRows(details, {sport});
  const performance = getPerformanceScore(rows, { sport, stale: Boolean(stale || game?.stale || details?.stale || details?.statsStale) });
  const prediction = estimateWin(game, details, { stale, performance });
  return { rows, performance, prediction, drivers: prediction.available && prediction.kind === 'estimate' ? prediction.drivers : performance.drivers };
}

function estimateOtherWin(game, summary, {stale=false,performance}={}) {
  const sport=sportFor(game);
  if(stale || game.stale)return unavailable('Waiting for a fresh score.',true);
  if(['race','leaderboard'].includes(game.kind))return unavailable('Timing and standings show the current leader. A two-team win model does not apply here.');
  const a=numeric(game.away?.score),h=numeric(game.home?.score);
  if(a===null || h===null)return unavailable('Waiting for both scores.');
  const lead=a-h;
  if(game.phase==='final'||game.state==='post')return {available:lead!==0,away:lead===0?null:lead>0?100:0,home:lead===0?null:lead<0?100:0,kind:'result',tie:lead===0,label:lead===0?'Final · draw':'Final result',reason:'The event is final; this is its result, not a forecast.',method:null,calibrated:false,drivers:[]};
  if(!['live','halftime','intermission'].includes(game.phase)&&game.state!=='in')return unavailable('The estimate starts once play begins.');
  if(!['basketball','hockey','soccer','rugby','baseball'].includes(sport))return unavailable('Use the stat comparison for this sport. A win estimate is not available.');
  let remaining=null,total=null,uncertainty=null,overtime=false;
  const period=Number(game.period),clock=seconds(game.clock);
  if(sport==='basketball'||sport==='hockey'){
    const periods=getLeague(game.leagueId)?.regulationPeriods||(sport==='hockey'?3:4);
    const duration=sport==='hockey'?1200:game.leagueId==='nba'?720:periods===2?1200:600;
    total=periods*duration;overtime=period>periods;
    if(game.phase==='halftime')remaining=total/2;
    else if(period>0&&period<=periods&&(clock!==null||game.phase==='intermission')&&(clock??0)<=duration)remaining=(periods-period)*duration+(clock??0);
    if(overtime)remaining=clock;
    if(remaining===null)return unavailable('Waiting for the period and game clock.');
    uncertainty=sport==='hockey'?.5+2.4*Math.sqrt(Math.max(0,remaining)/total):2+14*Math.sqrt(Math.max(0,remaining)/total);
  }else if(sport==='soccer'||sport==='rugby'){
    total=sport==='soccer'?5400:4800;
    let elapsed=clock;
    const minute=/^(\d{1,3})[′']?(?:\+(\d+)[′']?)?$/.exec(String(game.clock||''));
    if(elapsed===null&&minute)elapsed=(Number(minute[1])+Number(minute[2]||0))*60;
    if(game.phase==='halftime')elapsed=total/2;
    if(elapsed===null)return unavailable('Waiting for the match clock.');
    if(period>2)return unavailable('Extra time and shootouts are not modeled.');
    remaining=Math.max(0,total-elapsed);
    uncertainty=sport==='rugby'?2+10*Math.sqrt(remaining/total):null;
  }else if(sport==='baseball'){
    if(!Number.isInteger(period)||period<1)return unavailable('Waiting for the inning.');
    const outs=Number.isFinite(game.situation?.outs)?game.situation.outs:0;
    remaining=Math.max(0,9-period+(game.situation?.half==='bottom'?0:.5)+(3-outs)/6);
    total=9;uncertainty=.7+3*Math.sqrt(remaining/9);overtime=period>9;
  }
  if(sport==='soccer'){
    // A simple symmetric Poisson remainder includes the draw outcome explicitly.
    // Equal pre-game strength; only the observed score and remaining time count.
    const lambda=Math.max(.025,1.35*remaining/total), probs=[Math.exp(-lambda)];
    for(let i=1;i<14;i++)probs.push(probs[i-1]*lambda/i);
    let away=0,home=0,draw=0;
    for(let i=0;i<probs.length;i++)for(let j=0;j<probs.length;j++){const p=probs[i]*probs[j];if(lead+i-j>0)away+=p;else if(lead+i-j<0)home+=p;else draw+=p;}
    const sum=away+home+draw;const aPct=Math.round(away/sum*100),hPct=Math.round(home/sum*100);
    return {available:true,away:aPct,home:hPct,draw:Math.max(0,100-aPct-hPct),kind:'estimate',tie:false,stale:false,label:'Simple win estimate',calibrated:false,method:'Uncalibrated Poisson model with equal team strength; observed score and regulation time only, including a draw outcome.',reason:'Rough three-way estimate. It does not know team strength, added time, red-card effects or substitutions.',drivers:[]};
  }
  const stats=performance?.available&&!performance.stale&&matchesGame(game,summary)?performance.edge*(sport==='basketball'?2:sport==='hockey'?.15:1):0;
  const probability=1/(1+Math.exp(-(lead+stats)/Math.max(.3,uncertainty)));
  const away=clamp(Math.round(probability*100),overtime?5:1,overtime?95:99);
  return {available:true,away,home:100-away,kind:'estimate',tie:false,stale:false,label:'Simple win estimate',calibrated:false,method:'Hand-chosen score/time model with a small adjustment from fresh sport-specific stats. It has not been fitted or calibrated.',reason:sport==='baseball'?'Rough score-and-inning estimate; it does not model pitchers, base runners or each remaining plate appearance.':'Rough score-and-time estimate. Team strength and detailed possession sequences are not modeled.',drivers:[{key:'score',label:'Score',side:lead>0?'away':lead<0?'home':'even',impact:lead,description:lead===0?'The score is tied.':`${lead>0?game.away.abbreviation:game.home.abbreviation} leads by ${Math.abs(lead)}.`}]};
}
