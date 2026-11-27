import { renderField } from './field.js';
import { sportFor, formatPeriod, formatSituation } from './sports.js';
import { escapeHTML as e } from './game-view.js';
const list=value=>Array.isArray(value)?value:[];
const show=value=>value==null||value===''?'—':e(value);
export function periodHeading(game){return ({baseball:'By inning',tennis:'By set',volleyball:'By set',soccer:'By half',hockey:'By period',racing:'Session',golf:'Tournament'})[sportFor(game)]||(game?.leagueId==='cbb'?'By half':'By quarter');}
export function renderSportSurface(game){
  if(!game)return '<p class="empty-note">Choose an event to see its current situation.</p>';
  const sport=sportFor(game),s=game.situation||{};
  if(sport==='football')return renderField(game);
  if(sport==='baseball'){
    const bases=[['first',100,78,s.onFirst],['second',60,38,s.onSecond],['third',20,78,s.onThird]];
    const known=bases.some(([,x,y,value])=>typeof value==='boolean');
    return `<div class="baseball-situation"><svg viewBox="0 0 120 136" role="img" aria-label="${e(known?'Reported base runners':'Base runners unavailable')}"><path d="M60 118L20 78L60 38L100 78Z" fill="#34423a" stroke="#d8dfd3" stroke-width="1.5"/>${bases.map(([name,x,y,value])=>`<path d="M${x} ${y-6}l6 6-6 6-6-6Z" fill="${value===true?'#f3ce57':value===false?'#e8ece3':'#68736b'}"><title>${name} base: ${value===true?'occupied':value===false?'empty':'unreported'}</title></path>`).join('')}<path d="M54 114h12v6l-6 5-6-5Z" fill="#fff"/><text x="60" y="17" text-anchor="middle" fill="#eef2e8" font-size="10">${e(formatPeriod(game))}</text></svg><div><strong>${e(formatSituation(game)||'Count unavailable')}</strong><p>${known?bases.filter(([,x,y,v])=>v===true).map(([name])=>`${name} occupied`).join(' · ')||'Bases empty':'Base occupancy has not been reported.'}</p>${s.batter?`<p>Batting · ${e(s.batter)}</p>`:''}${s.pitcher?`<p>Pitching · ${e(s.pitcher)}</p>`:''}</div></div>`;
  }
  if(['race','leaderboard'].includes(game.kind)){
    const leader=list(game.entries).find(entry=>entry.position===1);
    return `<div class="session-summary"><strong>${e(game.sessionName||game.name||'Session')}</strong><p>${e(formatSituation(game)||game.status||'Timing updates as reported.')}</p>${leader?.position?`<p>Leader · ${e(leader.name||leader.athlete?.name||'—')}</p>`:''}${game.circuit?`<p>${e(game.circuit)}</p>`:''}<p class="data-note">${e(game.coverage?.message||'Unreported timing stays unavailable.')}</p></div>`;
  }
  const team=[game.away,game.home].find(team=>team&&team.id===(s.servingTeamId||s.powerPlayTeamId||game.possessionTeamId));
  const role=s.servingTeamId?'Serving':s.powerPlayTeamId?'Power play':'Possession';
  return `<div class="sport-situation"><strong>${e([formatPeriod(game),game.clock].filter(Boolean).join(' · '))}</strong>${team?`<p>${e(role)} · ${e(team.name||team.abbreviation)}</p>`:''}${formatSituation(game)?`<p>${e(formatSituation(game))}</p>`:''}${['soccer','basketball','hockey'].includes(sport)?'<p class="data-note">This feed does not supply continuous ball or player tracking.</p>':''}</div>`;
}
export function classificationMarkup(game,{compact=false}={}){
  const entries=list(game?.entries);if(!entries.length)return '<p class="empty-note">Classification has not been reported for this session.</p>';
  const golf=sportFor(game)==='golf';
  const columns=compact?golf?['score','thru']:['gap','time']:golf?['score','thru','points']:['gap','time','laps','tyre','points','status'];
  const label={gap:'Gap',time:'Best / total time',laps:'Laps',tyre:'Tyre',points:'Points',status:'Status',score:'Score',thru:'Thru'};
  return `<table class="classification-table"><thead><tr><th scope="col">Pos</th><th scope="col">${golf?'Player':'Driver'}</th>${columns.map(key=>`<th scope="col">${label[key]}</th>`).join('')}</tr></thead><tbody>${entries.slice(0,compact?10:300).map(entry=>`<tr><td>${show(entry.positionText||entry.position)}</td><th scope="row">${e(entry.name||entry.athlete?.name||'—')}${!compact&&entry.team?.name?`<small>${e(entry.team.name)}</small>`:''}</th>${columns.map(key=>`<td>${show(key==='tyre'&&typeof entry[key]==='object'?entry[key]?.compound:entry[key])}</td>`).join('')}</tr>`).join('')}</tbody></table>${compact&&entries.length>10?`<p class="data-note">Top 10 of ${entries.length} · all competitors are in Game center.</p>`:''}`;
}
export function raceControlMarkup(game){
  const messages=list(game?.raceControl);
  if(!messages.length)return '<p class="empty-note">No race-control messages have been supplied by this feed.</p>';
  return `<ol class="play-list">${messages.slice(-100).reverse().map(message=>`<li data-play-id="${e(message.id||message.date||message.timestamp||message.message)}"><div class="play-meta"><span>${e(message.date?new Date(message.date).toLocaleTimeString():message.clock||'')}</span><strong>${e(message.flag||message.category||'Race control')}</strong></div><p>${e(message.message||message.text||'Update')}</p></li>`).join('')}</ol>`;
}
export function competitorStatsMarkup(game){
  const entries=list(game?.entries).filter(entry=>list(entry.statistics).length||list(entry.rounds).length);
  if(!entries.length)return '<p class="empty-note">Additional competitor statistics have not been supplied.</p>';
  return entries.map(entry=>`<section class="player-category"><h3>${e(entry.name||entry.athlete?.name||'Competitor')}</h3><div class="table-scroll" tabindex="0" aria-label="${e(entry.name||'Competitor')} statistics"><table><tbody>${list(entry.statistics).map(stat=>`<tr><th scope="row">${e(stat.label||stat.key)}</th><td>${show(stat.value)}</td></tr>`).join('')}${list(entry.rounds).map(round=>`<tr><th scope="row">Round ${e(round.period)}</th><td>${show(round.score)}</td></tr>`).join('')}</tbody></table></div></section>`).join('');
}
