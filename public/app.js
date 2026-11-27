import { renderScorebug } from './scorebug.js';
import { getScorebugStyle, defaultStyleForSport, styleDescription } from './scorebug-styles.js';
import { referenceForLeague } from './sport-fixtures.js';
import { leagueGroups, getLeague, normalizeLeague, sportFor } from './sports.js';
import { normalizeFavorites, normalizeFavoriteStyleIds, gameLeague, normalizeRacingRows, MIN_RACING_ROWS, MAX_RACING_ROWS } from './preferences-model.js';
import { toggleFavoriteStyleIds, styleOptionGroups, filterScorebugStyles } from './style-favorites.js';
import { localTeamLogo } from './team-assets.js';
import { attachDetailsHover } from './details-hover.js';
import { createGameActivity } from './game-activity.js';
import { createScoreAnimations } from './score-animation.js';
import { eventsForSport, selectSportDemoPlayer, isSessionEvent } from './sport-events.js';
import { mountDesktopUpdates } from './desktop-updates.js';
import { createLiveGameList } from './live-games.js';
import { createFavoritesFeed } from './favorites.js';
import { createFavoriteDirectoryStore, favoriteFromTeam, favoriteSearchKey, favoriteTeamKey, searchFavoriteTeams } from './favorite-search.js';
import { widgetPopupSize } from './widget-layout.js';
import { initializePreferences, getPreferences, updatePreferences, onPreferences, selectGame, activeGames, ScoreboardPoller, feedIsStale, checkedAgo, gameLabel } from './score-client.js';

const $ = id => document.getElementById(id);
const desktop = Boolean(window.scorebugDesktop);
let preferences = await initializePreferences();
if (!getLeague(preferences.leagueId)) preferences = await updatePreferences({leagueId:'nfl',gameId:null});
let snapshot = {data:null,error:null,loading:true}, currentSnapshot=snapshot, datedSnapshot=snapshot;
let reference=false, demoReference=false, demoSequence=0, previewContext=null, pipWindow=null, toastTimer, renderedSvg='', lastFavorites='', galleryKey='';
let favoriteStylesKey=null, galleryFavoritesKey='', styleFavoriteWrite=Promise.resolve();
let directory=[], directoryLeague=null, favoriteLeague='all', favoriteAdding=false, favoriteResultsKey='';
const directoryStore=createFavoriteDirectoryStore({onChange:directoryChanged});
const directoryController={abort:()=>directoryStore.stop()};
const animations=createScoreAnimations($('scorebug-preview'));
const activity=createGameActivity({onEvents:(events,game)=>animations.enqueue(events,game),onReset:()=>animations.clear(),onDetails:()=>{renderPreview();renderHealth();}});
const league=()=>getLeague(preferences.leagueId)||getLeague('nfl');
const sampleGame=()=>referenceForLeague(preferences.leagueId,directoryLeague===preferences.leagueId?directory:[]);
const label=(id,value)=>{if($(id).textContent!==value)$(id).textContent=value;};
const race=game=>['race','leaderboard'].includes(game?.kind);
const titleOf=game=>race(game)?game.name||game.sessionName||'Event':`${game?.away?.name||'Away'} at ${game?.home?.name||'Home'}`;
const shortTitle=game=>race(game)?game.name||game.sessionName||'Event':`${game?.away?.abbreviation||'Away'} at ${game?.home?.abbreviation||'Home'}`;
function toast(message){label('toast',message);$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,6500);}
function phaseLabel(game){return game?.isLive?'LIVE':({halftime:'HALFTIME',intermission:'BREAK',final:'FINAL',scheduled:'UPCOMING',delayed:'DELAYED',postponed:'POSTPONED',suspended:'SUSPENDED',canceled:'CANCELED'}[game?.phase]||league().name);}
function updateActivity(){activity.setGame(reference?null:selectGame(snapshot.data?.games,preferences),preferences.date||'current',snapshot.data?.fetchedAt,{sourceId:snapshot.data?.sourceId,stale:snapshot.data?.stale,error:Boolean(snapshot.error)});}
function floatingSize(){return widgetPopupSize(preferences);}
function resizeFloatingWindow(){if(!pipWindow||pipWindow.closed)return;try{const size=floatingSize();pipWindow.resizeTo(size.width,size.height);}catch{}}
function defaultStyle(leagueId){const sport=getLeague(leagueId)?.sport;return defaultStyleForSport(sport);}
function changeSelection(patch){
  reference=false;demoReference=false;animations.clearDemo();
  if(patch.leagueId && patch.leagueId!==preferences.leagueId){patch={gameId:null,date:null,...(preferences.styleAuto!==false?{styleId:defaultStyle(patch.leagueId)}:{}),...patch};previewDetails.close({immediate:true});}
  const url=new URL(location.href);
  for(const [key,param] of [['gameId','game'],['date','date'],['leagueId','league'],['styleId','style']])if(Object.hasOwn(patch,key)){if(patch[key])url.searchParams.set(param,patch[key]);else url.searchParams.delete(param);}
  url.searchParams.delete('team');
  try{history.replaceState(null,'',url);}catch{}
  return updatePreferences(patch);
}
function chooseStyle(styleId){
  previewDetails.close({immediate:true});
  const url=new URL(location.href);url.searchParams.set('style',styleId);
  try{history.replaceState(null,'',url);}catch{}
  return updatePreferences({styleId,styleAuto:false});
}
function toggleStyleFavorite(styleId, remove=false){
  // Serialize rapid clicks, and update only the saved-style list. Watching a
  // game, previewing a sample, and choosing a style are independent actions.
  styleFavoriteWrite=styleFavoriteWrite.then(async()=>{
    const current=normalizeFavoriteStyleIds(getPreferences().favoriteStyleIds);
    const favoriteStyleIds=remove?current.filter(id=>id!==styleId):toggleFavoriteStyleIds(current,styleId);
    await updatePreferences({favoriteStyleIds});
    label('style-favorites-status',`${getScorebugStyle(styleId).name} ${favoriteStyleIds.includes(styleId)?'saved to':'removed from'} your favorite styles.`);
  }).catch(()=>toast('Could not save your favorite styles. Please try again.'));
}
const starIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.78 5.64L21 9.55l-4.5 4.39 1.06 6.2L12 17.21l-5.56 2.93 1.06-6.2L3 9.55l6.22-.91Z"/></svg>';
function favoriteStyleButton(style,saved){
  const button=document.createElement('button');button.type='button';button.className='style-favorite-button';button.innerHTML=starIcon;
  setFavoriteStyleButton(button,style,saved);button.addEventListener('click',()=>toggleStyleFavorite(style.id));return button;
}
function setFavoriteStyleButton(button,style,saved){
  button.setAttribute('aria-pressed',String(saved));button.setAttribute('aria-label',`Favorite ${style.name} style`);
  button.title=`${saved?'Remove':'Add'} ${style.name} ${saved?'from':'to'} favorite styles`;
}
function renderStyleFavorites(){
  const ids=normalizeFavoriteStyleIds(preferences.favoriteStyleIds),key=JSON.stringify(ids),selected=getScorebugStyle(preferences.styleId);
  const current=$('favorite-current-style');if(!current.firstChild)current.innerHTML=starIcon;setFavoriteStyleButton(current,selected,ids.includes(selected.id));
  if(key!==favoriteStylesKey){
    favoriteStylesKey=key;
    const select=$('style-select');select.replaceChildren();
    for(const group of styleOptionGroups(ids)){
      const optgroup=document.createElement('optgroup');optgroup.label=group.label;optgroup.dataset.styleGroup=group.id;
      for(const style of group.styles)optgroup.append(new Option(style.name,style.id));select.append(optgroup);
    }
    const root=$('favorite-style-picks'),active=document.activeElement,wasFocused=root.contains(active),focusedStyle=active?.closest('[data-style-id]')?.dataset.styleId;
    const oldIndex=[...root.children].findIndex(chip=>chip.dataset.styleId===focusedStyle),removing=active?.hasAttribute('data-remove-style');root.replaceChildren();
    for(const id of ids){
      const style=getScorebugStyle(id),chip=document.createElement('span');chip.className='favorite-style-chip';chip.dataset.styleId=id;
      const pick=document.createElement('button');pick.type='button';pick.className='favorite-style-pick';pick.dataset.pickStyle=id;pick.textContent=style.name;pick.setAttribute('aria-label',`Use ${style.name} style`);pick.addEventListener('click',()=>chooseStyle(id));
      const remove=document.createElement('button');remove.type='button';remove.className='favorite-style-remove';remove.dataset.removeStyle=id;remove.textContent='×';remove.setAttribute('aria-label',`Remove ${style.name} from favorite styles`);remove.addEventListener('click',()=>toggleStyleFavorite(id,true));
      chip.append(pick,remove);root.append(chip);
    }
    $('favorite-styles-empty').hidden=ids.length>0;
    if(wasFocused){
      const chip=[...root.children].find(item=>item.dataset.styleId===focusedStyle)||root.children[Math.min(Math.max(0,oldIndex),root.children.length-1)];
      (chip?.querySelector(removing?'[data-remove-style]':'[data-pick-style]')||current).focus({preventScroll:true});
    }
  }
  for(const button of $('favorite-style-picks').querySelectorAll('[data-pick-style]')){
    const active=button.dataset.pickStyle===selected.id;button.setAttribute('aria-pressed',String(active));button.parentElement.dataset.selected=String(active);
  }
}
const chooseGame=game=>changeSelection({leagueId:gameLeague(game),gameId:game.id,date:null});
const liveList=createLiveGameList($('live-games'),{onChoose:chooseGame,onFocusedGameRemoved:()=>$('other-games').querySelector('summary').focus({preventScroll:true})});
const favoriteList=createLiveGameList($('favorite-games'),{onChoose:chooseGame,onFocusedGameRemoved:()=>$('favorite-editor').querySelector('summary').focus({preventScroll:true})});
const favoritesFeed=createFavoritesFeed({onUpdate:()=>renderFavorites()});
function renderFavorites(){
  const favorites=normalizeFavorites(preferences.favorites), encoded=JSON.stringify(favorites);
  if(encoded!==lastFavorites){
    lastFavorites=encoded;const root=$('favorite-chips');root.replaceChildren();
    for(const item of favorites){
      const chip=document.createElement('span');chip.className='favorite-chip';
      if(item.logo){const img=document.createElement('img');img.src=item.logo;img.alt='';img.addEventListener('error',()=>img.hidden=true,{once:true});chip.append(img);}
      chip.append(document.createTextNode(item.name||item.abbreviation||item.teamId));
      const small=document.createElement('small');small.textContent=getLeague(item.leagueId)?.name||item.leagueId;chip.append(small);
      const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label',`Remove ${item.name||item.teamId} from favorites`);remove.addEventListener('click',()=>{updatePreferences({favorites:preferences.favorites.filter(v=>!(v.leagueId===item.leagueId&&v.teamId===item.teamId))});$('favorite-editor').querySelector('summary').focus({preventScroll:true});});chip.append(remove);root.append(chip);
    }
    renderDirectory();
  }
  const {games,unavailable,pending}=favoritesFeed.result();
  favoriteList.render(games,{selectedId:preferences.gameId,showLeague:true});
  label('favorites-count',favorites.length?`${games.length} playing now`:'');
  label('favorites-message',!favorites.length?'Add your teams for a shortcut when they’re playing.':games.length?'Your live favorites. These games also remain in their league’s Live now list.':pending?'Checking your favorite teams…':unavailable?'Some favorite feeds are delayed. Reconnecting automatically.':'None of your favorites are playing live right now.');
}
function favoriteMatches(){
  const query=$('favorite-search').value;
  return searchFavoriteTeams(directoryStore.teams(),query,{leagueId:favoriteLeague,preferredLeagueId:preferences.leagueId,limit:favoriteSearchKey(query)?20:8});
}
function renderDirectory(){
  const query=$('favorite-search').value,hasQuery=Boolean(favoriteSearchKey(query)),matches=favoriteMatches();
  const id=favoriteLeague==='all'?preferences.leagueId:favoriteLeague,state=directoryStore.get(id),name=getLeague(id)?.name||id;
  const root=$('favorite-results'),saved=new Set(normalizeFavorites(preferences.favorites).map(item=>`${item.leagueId}/${item.teamId}`));
  const key=JSON.stringify([favoriteLeague,query,favoriteAdding,matches.teams.map(team=>[favoriteTeamKey(team),team.name,team.abbreviation,team.logo,saved.has(favoriteTeamKey(team))])]);
  if(root&&key!==favoriteResultsKey){
    favoriteResultsKey=key;
    const focusKey=root.contains(document.activeElement)?document.activeElement.dataset.favoriteKey:null;
    root.replaceChildren();
    for(const team of matches.teams){
      const item=document.createElement('li'),button=document.createElement('button'),teamKey=favoriteTeamKey(team),alreadySaved=saved.has(teamKey);
      button.type='button';button.className='favorite-result';button.dataset.favoriteKey=teamKey;button.disabled=alreadySaved||favoriteAdding;
      button.setAttribute('aria-label',`${alreadySaved?'Saved':'Add'} ${team.name} (${getLeague(team.leagueId)?.name||team.leagueId})${alreadySaved?'':' to favorites'}`);
      const logo=localTeamLogo(team);if(logo){const image=document.createElement('img');image.src=logo;image.alt='';image.addEventListener('error',()=>image.hidden=true,{once:true});button.append(image);}
      const title=document.createElement('span');title.className='favorite-result-name';title.textContent=team.name;button.append(title);
      const leagueName=document.createElement('span');leagueName.className='favorite-result-league';leagueName.textContent=getLeague(team.leagueId)?.name||team.leagueId;button.append(leagueName);
      const action=document.createElement('span');action.className='favorite-result-action';action.textContent=alreadySaved?'Saved':'Add';button.append(action);
      button.addEventListener('click',()=>addFavoriteTeam(team));item.append(button);root.append(item);
    }
    if(focusKey){const next=[...root.querySelectorAll('button')].find(button=>button.dataset.favoriteKey===focusKey&&!button.disabled);(next||$('favorite-search')).focus({preventScroll:true});}
  }
  root?.setAttribute('aria-busy',String(state.loading));
  const allSaved=matches.total>0&&matches.total===matches.teams.length&&matches.teams.every(team=>saved.has(favoriteTeamKey(team)));
  let status;
  if(matches.total){
    status=hasQuery?`${matches.total} ${matches.total===1?'match':'matches'}. ${matches.total>matches.teams.length?`Showing the first ${matches.teams.length}. `:''}${allSaved?'Already in your favorites.':'Choose a team to add it.'}`
      :`Showing ${matches.teams.length} of ${matches.total}${favoriteLeague==='all'?'':` ${name}`} teams or competitors. Type a name to narrow the list.`;
  }else if(state.loading)status=`Loading ${name} teams. Keep typing—your search will update when they arrive.`;
  else if(state.error)status=`Could not load ${name} teams. Try loading them again below.`;
  else if(hasQuery)status=`No matches${favoriteLeague==='all'?' in the available teams':` in ${name}`}. Try a shorter name or choose another league.`;
  else status=`The ${name} feed has not supplied a team or competitor list yet.`;
  if(!hasQuery&&favoriteLeague==='all')status+=' NFL, NBA, WNBA, MLB and NHL are ready to search. Choose another league to include its teams.';
  if(matches.total&&state.loading)status+=` Loading more ${name} teams…`;
  if(matches.total&&state.error)status+=` Could not refresh ${name}; the teams shown are still available.`;
  label('favorite-directory-status',status);
  const retry=$('favorite-retry');if(retry){retry.hidden=!state.error||state.loading;retry.textContent=`Try loading ${name} teams again`;}
}
function directoryChanged(id){
  const current=directoryStore.get(preferences.leagueId);directory=current.teams;directoryLeague=current.loadedAt===null?null:preferences.leagueId;
  renderDirectory();
  if(id===preferences.leagueId){if(reference||demoReference)renderPreview();galleryKey='';renderStyleGallery();}
}
function loadDirectory(id=preferences.leagueId,options={}){
  directoryStore.retain([preferences.leagueId,favoriteLeague]);
  const pending=directoryStore.load(id,options);directoryChanged(id);return pending;
}
async function addFavoriteTeam(team){
  if(favoriteAdding)return;
  const favorites=normalizeFavorites(preferences.favorites);
  if(favorites.some(item=>item.leagueId===team.leagueId&&item.teamId===team.id)){toast('That team is already in your favorites.');return;}
  if(favorites.length>=64){toast('You can save up to 64 favorites. Remove one to add another.');return;}
  const item=favoriteFromTeam(team);
  if(!item)return;
  favoriteAdding=true;renderDirectory();
  try{await updatePreferences({favorites:[...favorites,item]});toast(`${team.name} added to favorites.`);$('favorite-search').focus({preventScroll:true});}
  finally{favoriteAdding=false;renderDirectory();}
}
function renderLiveGames(){
  const games=activeGames(currentSnapshot.data?.games),delayed=Boolean(currentSnapshot.error||(currentSnapshot.data&&feedIsStale(currentSnapshot.data)));
  const selected=preferences.gameId||!preferences.date?selectGame(currentSnapshot.data?.games,preferences):null;
  liveList.render(games,{selectedId:selected?.id,delayed});
  label('live-games-count',currentSnapshot.data?`${games.length} ${league().kind==='match'?(games.length===1?'game':'games'):(games.length===1?'session':'sessions')}`:'');
  label('live-games-message',!currentSnapshot.data?currentSnapshot.error?'Unable to check live events. Reconnecting…':'Looking for live events…':delayed?'Feed delayed. Showing the last received events while we reconnect.':games.length?`Live in ${league().name}. Choose an event to keep watching it.`:`No ${league().name} events are live right now. Open Other games for the schedule and results.`);
  $('live-games-message').className=`live-games-message${delayed?' delayed':''}`;
  const automatic=!preferences.gameId&&!preferences.date,pinned=preferences.gameId?selectGame(snapshot.data?.games,preferences):null;
  $('follow-live').setAttribute('aria-pressed',String(automatic));
  label('selection-mode',automatic?'Automatic follows a live favorite in this league first, then another active game.':pinned?`Pinned to ${shortTitle(pinned)}. Choose Automatic to follow live games again.`:preferences.gameId?'Your selected event stays pinned. Choose Automatic to follow live games again.':'Browsing a date. Live now still shows the current events.');
  favoritesFeed.sync(preferences,currentSnapshot);renderFavorites();
}
let demoSport=null,demoGame=null;
function renderDemoControls(game,sample){
  const matchup=game||sampleGame(),sport=sportFor(matchup),select=$('demo-team');
  const key=`${matchup.id}:${(matchup.entries||[]).map(entry=>entry.id).join(',')}`;
  if(demoGame!==key){const old=select.value;select.replaceChildren();if(race(matchup)){for(const entry of (matchup.entries||[]).slice(0,24))select.add(new Option(entry.athlete?.name||entry.name||entry.team?.name||'Competitor',entry.id||entry.athlete?.id||entry.team?.id));if(!select.options.length)select.add(new Option('Session','session'));}else{for(const side of ['away','home'])select.add(new Option(`${side==='away'?'Away':'Home'} · ${matchup[side].abbreviation}`,side));}if([...select.options].some(o=>o.value===old))select.value=old;demoGame=key;}
  if(demoSport!==sport){const control=$('demo-event');control.replaceChildren();for(const spec of eventsForSport(sport))control.add(new Option(spec.title.toLowerCase().replace(/^./,v=>v.toUpperCase()),spec.kind));demoSport=sport;}
  const sessionEvent=isSessionEvent($('demo-event').value,sport);
  $('demo-competitor-control').hidden=sessionEvent;select.disabled=sessionEvent;
  label('demo-competitor-label',sport==='racing'?'Driver':race(matchup)?'Competitor':'Team');
  label('demo-status',`Preview only — live scores stay unchanged.${sample||!game?' Sample data is being shown.':''}`);
}
function renderRacingControls(game){
  const enabled=league().sport==='racing';$('racing-row-controls').hidden=!enabled;
  if(!enabled)return;
  const count=game?.entries?.length||0,rows=normalizeRacingRows(preferences.racingRows);
  const maximum=Math.min(MAX_RACING_ROWS,Math.max(20,count||22,rows));
  $('racing-rows').min=String(MIN_RACING_ROWS);$('racing-rows').max=String(maximum);$('racing-rows').value=String(rows);
  label('racing-rows-value',`${rows} rows`);
  label('racing-rows-note',count?`${Math.min(count,rows)} of ${count} drivers shown. Slide right to show the full field.`:'Show the front runners or expand to the full field. Drivers appear when the feed reports them.');
}
function coverageText(){
  const data=snapshot.data;
  const active=activity.getDisplayGame(selectGame(data?.games,preferences));
  const coverage=active?.coverage||data?.coverage;
  if(typeof coverage==='string')return coverage;
  const note=coverage?.note||coverage?.message||coverage?.description||data?.coverageNote;
  if(note)return `${active?.timingStale?'Timing delayed. ':''}${String(note)}`;
  if(league().id==='f1')return 'Practice, qualifying, sprint and race sessions are listed when scheduled. Public timing may be delayed; gaps, tyres and flags appear only when reported. Genuine live OpenF1 timing requires a configured paid account.';
  return '';
}
function renderHealth(){
  const stale=snapshot.data&&feedIsStale(snapshot.data,Boolean(snapshot.error));
  label('checked-at',snapshot.error||stale?`Reconnecting · ${checkedAgo(snapshot.data).toLowerCase()}`:snapshot.data?.feedStatus==='backup'?`Backup feed · ${checkedAgo(snapshot.data).toLowerCase()}`:checkedAgo(snapshot.data));
  $('feed-health').querySelector('.health-dot').className=`health-dot${snapshot.error||stale?' error':snapshot.data?'':' pending'}`;
  label('coverage-note',coverageText());
  if(stale)renderPreview();
}
function renderPreview(){
  const selected=selectGame(snapshot.data?.games,preferences);if(selected)demoReference=false;
  const sample=reference||demoReference,game=sample?sampleGame():activity.getDisplayGame(selected);
  const context=`${sample?'sample':'live'}:${game?.id||'none'}:${preferences.date||'current'}:${preferences.styleId}`;
  if(context!==previewContext){previewContext=context;animations.clearDemo();}
  const root=$('scorebug-preview');
  if(game){
    const html=renderScorebug(game,{idPrefix:'preview',styleId:preferences.styleId,racingRows:preferences.racingRows,orientation:preferences.orientation,demo:sample,stale:!sample&&(feedIsStale(snapshot.data,Boolean(snapshot.error))||game.timingStale)});
    if(html!==renderedSvg){root.innerHTML=html;renderedSvg=html;}animations.attach(preferences.orientation);
    label('game-title',`${sample?'Sample: ':''}${titleOf(game)}`);label('phase-badge',sample?'SAMPLE':phaseLabel(game));
    $('phase-badge').className=`status-pill${!sample&&game.isLive?' live':''}${!sample&&feedIsStale(snapshot.data,Boolean(snapshot.error))?' error':''}`;
  }else{
    renderedSvg='';root.replaceChildren();const node=document.createElement('div');node.className=`empty-scorebug${snapshot.error?' error':''}`;node.textContent=snapshot.loading?`Connecting to ${league().name}`:snapshot.error?'Unable to reach the score feed':preferences.gameId?'This event is not in the selected schedule':`No ${league().name} events for this date`;root.append(node);
    label('game-title',snapshot.loading?'Finding your game…':'Choose an event above');label('phase-badge',snapshot.error?'OFFLINE':snapshot.loading?'CONNECTING':'NO EVENT');$('phase-badge').className=`status-pill${snapshot.error?' error':''}`;
  }
  label('preview-caption',sample?'Sample data · preview only':race(game)?'Hover the timing area for standings and session details.':'Hover a logo or timeout marks for team stats; hover the middle to compare.');
  $('reference-note').hidden=!sample;$('reference-toggle').setAttribute('aria-pressed',String(sample));label('reference-toggle',sample?'Back to live':'Sample matchup');
  renderDemoControls(game,sample);
  renderRacingControls(game);
}
function renderGames(){
  const games=snapshot.data?.games||[],current=selectGame(games,preferences),select=$('game-select'),options=new Map([...select.options].map(option=>[option.value,option]));
  const desired=games.length?games.map(game=>[game.id,`${gameLabel(game)} · ${phaseLabel(game)}`]):[['',snapshot.loading?'Loading events…':'No events available — try another date']];
  desired.forEach(([value,text],index)=>{const option=options.get(value)||new Option(text,value);if(option.text!==text)option.text=text;if(select.options[index]!==option)select.insertBefore(option,select.options[index]||null);options.delete(value);});for(const option of options.values())option.remove();select.disabled=!games.length;select.value=current?.id||'';
  label('games-count',games.length?`${games.length} EVENTS`:league().name);
  const delayed=snapshot.data&&feedIsStale(snapshot.data,Boolean(snapshot.error));$('feed-error').hidden=!snapshot.error&&!delayed;label('feed-error',snapshot.error||delayed?'Reconnecting automatically. The last received data stays visible and is marked as delayed.':'');
  const teams=$('match-teams');teams.replaceChildren();
  if(current){
    if(race(current))teams.append(document.createTextNode(titleOf(current)));
    else for(const [index,team] of [current.away,current.home].entries()){
      if(index){const versus=document.createElement('span');versus.className='versus';versus.textContent='AT';teams.append(versus);}
      const el=document.createElement('span');el.className='team';const logoPath=localTeamLogo(team);if(logoPath){const logo=document.createElement('img');logo.src=logoPath;logo.alt='';logo.width=31;logo.height=31;logo.addEventListener('error',()=>logo.hidden=true,{once:true});el.append(logo);}el.append(document.createTextNode(team.abbreviation));teams.append(el);
    }
    const time=new Date(current.startTime||'');label('match-meta',[Number.isFinite(time.getTime())?time.toLocaleString(undefined,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):null,current.broadcast,current.venue].filter(Boolean).join(' · '));
    label('last-play',current.lastPlay||(current.state==='pre'?'The scorebug will update automatically when the event starts.':current.status||'Waiting for the next update.'));
    document.title=`${gameLabel(current)} — Scorebug`;
  }else{teams.textContent='Choose an event or use Automatic.';label('match-meta','Choose an event or a different date.');label('last-play',snapshot.loading?'Waiting for the feed…':'No event information available.');document.title='Scorebug — Live sports, your way';}
}
function renderStyleGallery(){
  if($('style-browser').hidden)return;
  const query=$('style-search').value.trim(),all=$('all-styles').checked,favoritesOnly=$('favorite-styles-only').checked,ids=normalizeFavoriteStyleIds(preferences.favoriteStyleIds);
  const key=JSON.stringify([preferences.leagueId,preferences.styleId,query,all,favoritesOnly]),savedKey=JSON.stringify(ids);
  if(key===galleryKey&&savedKey===galleryFavoritesKey)return;
  // A star changes one control, not the 83 SVG previews. Only a favorites-only
  // view needs its card list rebuilt when saved styles change.
  if(key===galleryKey&&!favoritesOnly){
    galleryFavoritesKey=savedKey;
    for(const card of $('style-gallery').querySelectorAll('.style-card'))setFavoriteStyleButton(card.querySelector('[data-style-action="favorite"]'),getScorebugStyle(card.dataset.styleId),ids.includes(card.dataset.styleId));
    return;
  }
  galleryKey=key;galleryFavoritesKey=savedKey;
  const game=sampleGame(),root=$('style-gallery'),active=document.activeElement,focusedCard=active?.closest('.style-card');
  const wasFocused=root.contains(active),focusedStyle=focusedCard?.dataset.styleId,action=active?.dataset.styleAction,oldIndex=[...root.children].indexOf(focusedCard);root.replaceChildren();
  const styles=filterScorebugStyles({favoriteStyleIds:ids,favoritesOnly,allSports:all,sport:league().sport,query});
  for(const style of styles){
    const card=document.createElement('div');card.className='style-card';card.dataset.styleId=style.id;card.dataset.selected=String(style.id===preferences.styleId);
    const button=document.createElement('button');button.type='button';button.className='style-card-select';button.dataset.styleAction='choose';button.setAttribute('aria-pressed',String(style.id===preferences.styleId));button.setAttribute('aria-label',`Use ${style.name} style`);
    const preview=document.createElement('div');preview.className='style-card-preview';preview.setAttribute('aria-hidden','true');preview.innerHTML=renderScorebug(game,{idPrefix:`card-${style.id}`,styleId:style.id,orientation:'horizontal',interactive:false});
    const title=document.createElement('strong');title.textContent=style.name;const subtitle=document.createElement('small');subtitle.textContent=[style.network,style.era].filter(Boolean).join(' · ');
    button.append(preview,title);button.addEventListener('click',()=>chooseStyle(style.id));
    const footer=document.createElement('div');footer.className='style-card-footer';const star=favoriteStyleButton(style,ids.includes(style.id));star.dataset.styleAction='favorite';footer.append(subtitle,star);card.append(button,footer);root.append(card);
  }
  if(!styles.length){
    const empty=document.createElement('div');empty.className='style-gallery-empty';
    const title=document.createElement('strong'),copy=document.createElement('p'),reset=document.createElement('button');reset.type='button';reset.className='secondary-button';
    const noFavorites=favoritesOnly&&!ids.length;title.textContent=noFavorites?'No favorite styles yet.':favoritesOnly?'No favorite styles match.':'No styles match.';
    copy.textContent=noFavorites?'Star a look beside the selector or on any style card. It will be saved here.':'Try a different search, or include styles from all sports.';
    reset.textContent=noFavorites?'Browse all styles':'Clear filters';reset.addEventListener('click',()=>{$('style-search').value='';$('all-styles').checked=true;if(noFavorites)$('favorite-styles-only').checked=false;renderStyleGallery();$('style-search').focus({preventScroll:true});});
    empty.append(title,copy,reset);root.append(empty);
  }
  if(wasFocused){
    const card=[...root.querySelectorAll('.style-card')].find(item=>item.dataset.styleId===focusedStyle)||root.querySelectorAll('.style-card')[Math.min(Math.max(0,oldIndex),styles.length-1)];
    (card?.querySelector(`[data-style-action="${action==='favorite'?'favorite':'choose'}"]`)||$('favorite-styles-only')).focus({preventScroll:true});
  }
}
function renderPreferences(){
  const scale=Number(preferences.scale)||1,vertical=preferences.orientation==='vertical';$('size-range').value=String(scale);label('size-value',`${Math.round(scale*100)}%`);
  for(const button of $('browser-layout-controls').querySelectorAll('button[data-orientation]'))button.setAttribute('aria-pressed',String(button.dataset.orientation===(vertical?'vertical':'horizontal')));
  $('scorebug-preview').style.width=`${(vertical?144:520)*scale}px`;$('preview-stage').dataset.orientation=vertical?'vertical':'horizontal';
  $('date-input').value=preferences.date?`${preferences.date.slice(0,4)}-${preferences.date.slice(4,6)}-${preferences.date.slice(6,8)}`:'';$('snap-checkbox').checked=preferences.snapEnabled!==false;$('lock-checkbox').checked=Boolean(preferences.locked);
  for(const button of $('anchor-grid').querySelectorAll('button'))button.setAttribute('aria-pressed',String(button.dataset.anchor===preferences.anchor));
  renderStyleFavorites();$('league-select').value=preferences.leagueId;$('style-select').value=getScorebugStyle(preferences.styleId)?.id||'nfl-blades';
  label('style-note',styleDescription(preferences.styleId,sampleGame())||'The selected look uses the current sport’s scores and information.');renderStyleGallery();
}
function renderSelectedFeed(state){snapshot=state;renderPreview();renderGames();renderLiveGames();renderHealth();updateActivity();}
const poller=new ScoreboardPoller({leagueId:preferences.leagueId,date:null,onUpdate:state=>{currentSnapshot=state;if(!preferences.date)renderSelectedFeed(state);else renderLiveGames();}});
const datedPoller=new ScoreboardPoller({leagueId:preferences.leagueId,date:preferences.date,onUpdate:state=>{datedSnapshot=state;if(preferences.date)renderSelectedFeed(state);}});
onPreferences(next=>{
  const old=preferences,leagueChanged=old.leagueId!==next.leagueId,sizeChanged=old.orientation!==next.orientation||old.scale!==next.scale||old.racingRows!==next.racingRows||leagueChanged;preferences=next;
  if(leagueChanged||old.date!==next.date||old.gameId!==next.gameId){demoReference=false;animations.clearDemo();previewDetails.close({immediate:true});}
  if(leagueChanged){reference=false;directory=[];directoryLeague=null;currentSnapshot={data:null,error:null,loading:true};datedSnapshot=currentSnapshot;snapshot=currentSnapshot;poller.setContext({leagueId:next.leagueId,date:null});loadDirectory();}
  if(leagueChanged||old.date!==next.date){
    if(next.date){snapshot=datedPoller.leagueId===next.leagueId&&datedPoller.date===next.date?datedSnapshot:{data:null,error:null,loading:true};datedPoller.setContext({leagueId:next.leagueId,date:next.date});datedPoller.start();}
    else{datedPoller.stop();snapshot=currentSnapshot;}$('other-games').open=Boolean(next.date);
  }
  renderPreferences();renderPreview();renderGames();renderLiveGames();renderHealth();updateActivity();if(sizeChanged)resizeFloatingWindow();
});
const previewDetails=attachDetailsHover($('scorebug-preview'),{enabled:()=>!reference&&!demoReference});
function addLeagueOptions(select){
  for(const group of leagueGroups()){
    const optgroup=document.createElement('optgroup');optgroup.label=group.label;optgroup.dataset.leagueGroup=group.id;
    for(const item of group.leagues)optgroup.append(new Option(item.name,item.id));select.append(optgroup);
  }
}
addLeagueOptions($('league-select'));
$('league-select').addEventListener('change',event=>changeSelection({leagueId:normalizeLeague(event.target.value),gameId:null,date:null}));
$('style-select').addEventListener('change',event=>chooseStyle(event.target.value));
$('favorite-current-style').addEventListener('click',()=>toggleStyleFavorite(getScorebugStyle(preferences.styleId).id));
$('style-browser-toggle').addEventListener('click',()=>{const open=$('style-browser').hidden;$('style-browser').hidden=!open;$('style-browser-toggle').setAttribute('aria-expanded',String(open));renderStyleGallery();});
$('style-search').addEventListener('input',renderStyleGallery);$('all-styles').addEventListener('change',renderStyleGallery);$('favorite-styles-only').addEventListener('change',renderStyleGallery);
$('favorite-search').addEventListener('input',renderDirectory);
$('favorite-search').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.isComposing){const team=favoriteMatches().enterTeam;if(team){event.preventDefault();addFavoriteTeam(team);}}});
const favoriteLeagueSelect=$('favorite-league-select');
if(favoriteLeagueSelect){addLeagueOptions(favoriteLeagueSelect);favoriteLeagueSelect.value=favoriteLeague;favoriteLeagueSelect.addEventListener('change',()=>{favoriteLeague=getLeague(favoriteLeagueSelect.value)?favoriteLeagueSelect.value:'all';directoryStore.retain([preferences.leagueId,favoriteLeague]);renderDirectory();if(favoriteLeague!=='all')loadDirectory(favoriteLeague);});}
$('favorite-retry')?.addEventListener('click',()=>loadDirectory(favoriteLeague==='all'?preferences.leagueId:favoriteLeague,{force:true}));
$('favorite-editor').addEventListener('toggle',()=>{if($('favorite-editor').open){renderDirectory();loadDirectory(favoriteLeague==='all'?preferences.leagueId:favoriteLeague);}});
$('follow-live').addEventListener('click',()=>changeSelection({gameId:null,date:null}));
$('game-select').addEventListener('change',event=>changeSelection({gameId:event.target.value||null}));
$('date-input').addEventListener('change',event=>changeSelection({date:event.target.value.replaceAll('-','')||null,gameId:null}));
$('week-button').addEventListener('click',()=>changeSelection({date:null,gameId:null}));
$('size-range').addEventListener('input',event=>updatePreferences({scale:Number(event.target.value)}));
$('racing-rows').addEventListener('input',event=>{previewDetails.close({immediate:true});updatePreferences({racingRows:Number(event.target.value)});});
$('browser-layout-controls').addEventListener('click',event=>{const button=event.target.closest('button[data-orientation]');if(desktop||!button)return;previewDetails.close();updatePreferences({orientation:button.dataset.orientation==='vertical'?'vertical':'horizontal'});});
$('reference-toggle').addEventListener('click',()=>{reference=!(reference||demoReference);demoReference=false;animations.clearDemo();previewDetails.close();renderPreview();updateActivity();});
$('demo-event').addEventListener('change',()=>renderDemoControls(reference||demoReference?sampleGame():activity.getDisplayGame(selectGame(snapshot.data?.games,preferences)),reference||demoReference));
$('demo-play').addEventListener('click',()=>{
  const selected=selectGame(snapshot.data?.games,preferences);if(!selected&&!reference)demoReference=true;renderPreview();previewDetails.close();
  const game=reference||demoReference?sampleGame():activity.getDisplayGame(selected),sport=sportFor(game),spec=eventsForSport(sport).find(event=>event.kind===$('demo-event').value)||eventsForSport(sport)[0];
  const side=$('demo-team').value==='home'?'home':'away',entry=race(game)?game.entries?.find(entry=>(entry.id||entry.athlete?.id||entry.team?.id)===$('demo-team').value):null;
  const sessionEvent=isSessionEvent(spec,sport);
  const teamId=sessionEvent?null:race(game)?entry?.team?.id||entry?.athlete?.id||entry?.id||null:game[side].id,details=activity.getDetails();
  const player=sessionEvent?null:race(game)?entry?.athlete||(entry?.name?{id:entry.id,name:entry.name,headshot:entry.headshot}:null):details?.gameId===(game.detailsGameId||game.id)?selectSportDemoPlayer(details,teamId,spec.kind,sport):null;
  animations.demo({id:`demo:${++demoSequence}`,gameId:game.id,teamId,detail:'Animation preview only.',playId:null,period:null,clock:null,yardsGained:spec.kind==='big-play'?25:null,player,...spec,statDetail:spec.kind==='three-pointer'?'3PT 42.9% · sample':''},game);
});
$('refresh-button').addEventListener('click',()=>{poller.refresh();if(preferences.date)datedPoller.refresh();favoritesFeed.refresh();activity.refresh();});
$('snap-checkbox').addEventListener('change',event=>updatePreferences({snapEnabled:event.target.checked}));$('lock-checkbox').addEventListener('change',event=>updatePreferences({locked:event.target.checked}));
$('anchor-grid').addEventListener('click',event=>{const button=event.target.closest('button[data-anchor]');if(button)updatePreferences({anchor:button.dataset.anchor});});
function viewURL(path){const url=new URL(path,location.href);url.searchParams.set('league',preferences.leagueId);url.searchParams.set('style',preferences.styleId);url.searchParams.set('rows',String(normalizeRacingRows(preferences.racingRows)));if(preferences.gameId)url.searchParams.set('game',preferences.gameId);if(preferences.date)url.searchParams.set('date',preferences.date);return url;}
$('clean-button').addEventListener('click',()=>{if(desktop){updatePreferences({anchor:preferences.anchor||'bottom-center'});toast('The desktop scorebug is ready. Drag it to an edge to snap.');}else window.open(viewURL('/widget.html').href,'_blank','noopener,noreferrer');});
$('game-center-button').addEventListener('click',async()=>{previewDetails.close();if(desktop){try{await window.scorebugDesktop.openGameCenter();}catch{toast('The game center could not open. Try again from the scorebug menu.');}}else window.open(viewURL('/game.html').href,'_blank','noopener,noreferrer');});
async function floatWidget() {
  if (desktop) { await updatePreferences({ anchor: 'bottom-center' }); toast('Scorebug snapped to the bottom center.'); return; }
  if (pipWindow && !pipWindow.closed) { pipWindow.focus(); return; }
  if (!window.documentPictureInPicture?.requestWindow) {
    const size = floatingSize();
    const popup = window.open(viewURL('/widget.html').href, 'scorebug-overlay', `popup,width=${size.width},height=${size.height}`);
    toast(popup ? 'Pin this window with PowerToys: Win + Ctrl + T. The desktop app supports snapping.' : 'Popup blocked. Use Clean view, then pin it with PowerToys.');
    return;
  }
  try {
    // Must stay directly inside the user gesture. PiP owns its own runtime/timers.
    pipWindow = await window.documentPictureInPicture.requestWindow(floatingSize());
    pipWindow.scorebugInitialPreferences = getPreferences();
    const doc = pipWindow.document;
    doc.documentElement.lang = 'en'; doc.title = 'Scorebug — Live sports';
    const base = doc.createElement('base'); base.href = `${location.origin}/`; doc.head.append(base);
    for (const path of ['/widget.css', '/scorebug.css']) { const link = doc.createElement('link'); link.rel = 'stylesheet'; link.href = new URL(path, location.origin).href; doc.head.append(link); }
    doc.body.className = 'widget-page'; doc.body.dataset.pip = 'true';
    const main = doc.createElement('main'); main.id = 'widget-root'; main.className = 'widget-root'; main.setAttribute('aria-label', 'Floating sports scoreboard'); doc.body.append(main);
    const script = doc.createElement('script'); script.type = 'module'; script.src = new URL('/widget-runtime.js', location.origin).href; doc.body.append(script);
    $('float-button-label').textContent = 'Scorebug is floating';
    pipWindow.addEventListener('pagehide', () => { pipWindow = null; $('float-button-label').textContent = 'Float in browser'; }, { once: true });
    toast('Drag the floating scorebug wherever you want. Keep this tab open.');
  } catch (error) { console.warn('Picture-in-Picture:', error.message); toast('The browser could not open a floating window. Try Clean view + PowerToys, or the desktop app.'); }
}
$('float-button').addEventListener('click', floatWidget);
if (desktop) {
  document.body.dataset.mode = 'desktop';
  if ($('page-title')) $('page-title').textContent = 'Scorebug settings';
  $('desktop-controls').hidden = false; $('desktop-banner').hidden = true;
  $('browser-layout-controls').hidden = true;
  $('mode-label').textContent = /Mac/.test(navigator.platform) ? 'Mac app' : 'Windows app'; $('float-button-label').textContent = 'Snap to bottom center';
  $('floating-copy').textContent = 'Transparent and always on top. Drop at a side to turn vertical; top and bottom stay horizontal.';
  $('floating-hint').textContent = 'Hover the scorebug for controls, or right-click it for the full menu. Close this settings window to keep watching.';
  $('clean-button').hidden = true;
} else if (!window.documentPictureInPicture?.requestWindow) {
  $('float-button-label').textContent = 'Open mini window';
  $('floating-hint').textContent = 'Pin it with PowerToys: Win + Ctrl + T. For automatic snapping, use the desktop app.';
}
if (!desktop) $('mode-label').textContent = 'Browser window';

let disposeUpdates=mountDesktopUpdates($('desktop-updates'));
$('other-games').open=Boolean(preferences.date);
renderPreferences();renderLiveGames();renderDirectory();loadDirectory();activity.start();favoritesFeed.start();poller.start();if(preferences.date)datedPoller.start();
let healthTimer=setInterval(()=>{renderHealth();renderFavorites();},1000);
window.addEventListener('pagehide',()=>{poller.stop();datedPoller.stop();favoritesFeed.stop();activity.stop();directoryController?.abort();clearInterval(healthTimer);disposeUpdates();});
window.addEventListener('pageshow',event=>{if(event.persisted){disposeUpdates=mountDesktopUpdates($('desktop-updates'));activity.start();favoritesFeed.start();poller.start();if(preferences.date)datedPoller.start();clearInterval(healthTimer);healthTimer=setInterval(()=>{renderHealth();renderFavorites();},1000);}});
