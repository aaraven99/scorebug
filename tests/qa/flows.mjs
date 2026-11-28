import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { LEAGUES } from '../../public/sports.js';
import { SCOREBUG_STYLES, defaultStyleForSport } from '../../public/scorebug-styles.js';
import { eventsForSport } from '../../public/sport-events.js';
import { fixtureForLeague, scoreboardForLeague, detailsForGame, fallbackDirectory } from './fixtures.mjs';
import { runExtraFlows } from './extra-flows.mjs';
import { runDelayedReloadFlow } from './delayed-reload.mjs';
import { observeBrowserErrors, finalizeBrowserErrors } from './browser-diagnostics.mjs';

// Instrument only long-lived global targets. DOM listeners on replaced cards are
// expected to disappear with those nodes and are not called leaks by this suite.
function installMetrics(){
  const counts=new Map(),listenerIds=new WeakMap();let nextId=1;
  const add=EventTarget.prototype.addEventListener,remove=EventTarget.prototype.removeEventListener;
  const identity=listener=>{if(!listener||!['function','object'].includes(typeof listener))return'none';if(!listenerIds.has(listener))listenerIds.set(listener,nextId++);return listenerIds.get(listener);};
  const key=(target,type,listener,options)=>`${target===window?'window':'document'}:${type}:${identity(listener)}:${typeof options==='boolean'?options:Boolean(options?.capture)}`;
  const tracked=target=>target===window||target===document;
  EventTarget.prototype.addEventListener=function(type,listener,options){if(tracked(this))counts.set(key(this,type,listener,options),type);return add.call(this,type,listener,options);};
  EventTarget.prototype.removeEventListener=function(type,listener,options){if(tracked(this))counts.delete(key(this,type,listener,options));return remove.call(this,type,listener,options);};
  const nativeInterval=window.setInterval.bind(window),nativeClearInterval=window.clearInterval.bind(window),intervals=new Set();
  window.setInterval=(fn,delay,...rest)=>{const id=nativeInterval(fn,delay,...rest);intervals.add(id);return id;};window.clearInterval=id=>{intervals.delete(id);return nativeClearInterval(id);};
  const fetcher=window.fetch.bind(window),network={started:0,finished:0,active:0,maxActive:0,aborted:0};
  window.fetch=async(...args)=>{network.started++;network.active++;network.maxActive=Math.max(network.maxActive,network.active);try{return await fetcher(...args);}catch(error){if(error.name==='AbortError')network.aborted++;throw error;}finally{network.finished++;network.active--;}};
  window.__qaMetrics=()=>({globalListeners:counts.size,listeners:[...counts.values()].reduce((out,type)=>(out[type]=(out[type]||0)+1,out),{}),activeIntervals:intervals.size,network:{...network}});
  window.__qaAnimationEvents=[];
  for(const type of ['animationstart','animationend','animationcancel'])document.addEventListener(type,event=>{if(event.target?.classList?.contains('score-animation')&&!event.pseudoElement)window.__qaAnimationEvents.push({type,name:event.animationName,kind:event.target.dataset.kind,elapsedTime:event.elapsedTime,at:performance.now()});},true);
  window.__qaHistoryErrors=[];window.__qaHistoryCalls=[];
  const replaceState=history.replaceState.bind(history);history.replaceState=(...args)=>{window.__qaHistoryCalls.push(performance.now());try{return replaceState(...args);}catch(error){window.__qaHistoryErrors.push({name:error.name,message:error.message});throw error;}};
}

function installScreenMocks({wakeMode='success',fullscreenMode='reject'}={}){
  let originalVisibility;
  for(let target=document;target&&!originalVisibility;target=Object.getPrototypeOf(target))originalVisibility=Object.getOwnPropertyDescriptor(target,'visibilityState')?.get;
  const nativeVisibility=()=>originalVisibility?originalVisibility.call(document):'visible';
  let forcedVisibility=null,pageHidden=false,requests=0,releases=0,lastLock=null;
  const visibility=()=>pageHidden?'hidden':forcedVisibility??nativeVisibility();
  Object.defineProperty(document,'visibilityState',{configurable:true,get:visibility});
  Object.defineProperty(document,'hidden',{configurable:true,get:()=>visibility()==='hidden'});
  // Synthetic visibility controls must not keep a real outgoing document alive.
  // WebKit dispatches visibilitychange after pagehide; a permanently "visible"
  // getter made that event restart Standby's feed pool during navigation.
  window.addEventListener('pagehide',event=>{if(event.isTrusted){pageHidden=true;forcedVisibility=null;}},true);
  window.addEventListener('pageshow',event=>{if(event.isTrusted){pageHidden=false;forcedVisibility=null;}},true);
  document.addEventListener('visibilitychange',event=>{if(event.isTrusted)forcedVisibility=null;},true);
  const wake=wakeMode==='unsupported'?undefined:{request:async()=>{
    requests++;if(wakeMode==='reject')throw new DOMException('QA browser permission rejected','NotAllowedError');
    const lock=new EventTarget();lock.released=false;lock.release=async()=>{if(!lock.released){lock.released=true;releases++;lock.dispatchEvent(new Event('release'));}};lastLock=lock;return lock;
  }};
  Object.defineProperty(navigator,'wakeLock',{configurable:true,value:wake});
  Object.defineProperty(document,'fullscreenEnabled',{configurable:true,get:()=>fullscreenMode!=='unsupported'});
  Element.prototype.requestFullscreen=async()=>{if(fullscreenMode!=='success')throw new DOMException('QA full screen rejected','NotAllowedError');Object.defineProperty(document,'fullscreenElement',{configurable:true,value:document.documentElement});document.dispatchEvent(new Event('fullscreenchange'));};
  document.exitFullscreen=async()=>{Object.defineProperty(document,'fullscreenElement',{configurable:true,value:null});document.dispatchEvent(new Event('fullscreenchange'));};
  window.__qaScreen={setVisibility(value){forcedVisibility=value;document.dispatchEvent(new Event('visibilitychange'));},release:()=>lastLock?.release(),state:()=>({requests,releases,visibility:visibility(),active:Boolean(lastLock&&!lastLock.released)})};
}

export async function runFlows({browser,engine,baseURL,passes,outDir,directories,screenshots}){
  const recoveryPNG=await readFile(new URL('../../public/app-icon.png',import.meta.url));
  const started=Date.now(),result={checks:0,assertions:0,failures:[],results:[],network:[],consoleErrors:[],pageErrors:[],directorySearches:0,dropdownSelections:0,animationEvents:0,deviceProfiles:[],directoryCoverage:LEAGUES.map(league=>({leagueId:league.id,auditedFixturePresent:Boolean(directories[league.id]),teams:directories[league.id]?.teams.length??null,coverage:directories[league.id]?.coverage??null})),elapsedMs:0};
  const equal=(actual,expected,message)=>{result.assertions++;assert.deepEqual(actual,expected,message);};
  const truth=(value,message)=>{result.assertions++;assert.ok(value,message);};
  let activePage=null;
  const check=async(id,fn)=>{const start=Date.now();result.checks++;try{await fn();result.results.push({id,passed:true,elapsedMs:Date.now()-start});if(Date.now()-start>2000)console.log(`Flow passed: ${id} (${((Date.now()-start)/1000).toFixed(1)}s)`);}catch(error){const failure={id,message:error.message,stack:error.stack,elapsedMs:Date.now()-start};result.failures.push(failure);result.results.push({...failure,passed:false});console.log(`Flow failure: ${id}: ${error.message.split('\n')[0]}`);if(activePage&&!activePage.isClosed()){try{failure.state=await activePage.evaluate(()=>({url:location.href,savedPreferences:localStorage.getItem('scorebug.preferences.v2'),historyErrors:window.__qaHistoryErrors,animationEvents:window.__qaAnimationEvents}));const file=`screenshots/failure-${result.failures.length}-${engine}.png`;await activePage.screenshot({path:`${outDir}/${file}`,fullPage:true,timeout:5000});screenshots.push({file,kind:'failure',manuallyReviewed:false});}catch{}}await writeFile(`${outDir}/failure-${result.failures.length}.json`,JSON.stringify(failure,null,2));}};
  const screenshot=async(page,name)=>{const file=`screenshots/${name}-${engine}.png`;await page.screenshot({path:`${outDir}/${file}`,fullPage:true});screenshots.push({file,kind:'user-flow',manuallyReviewed:false});};
  const prefs=page=>page.evaluate(async()=> (await import('/score-client.js')).getPreferences());
  const waitBoard=(page,selector,leagueId,styleId)=>page.waitForFunction(({selector,leagueId,styleId})=>{const svg=document.querySelector(selector);return svg?.dataset.leagueId===leagueId&&(!styleId||svg.dataset.styleId===styleId);},{selector,leagueId,styleId},{timeout:8000});
  const makeContext=async({mobile=false,wakeMode,fullscreenMode}={})=>{
    const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1366,height:900},isMobile:mobile,hasTouch:mobile,deviceScaleFactor:1,reducedMotion:'no-preference'});
    await context.addInitScript(installMetrics);if(wakeMode)await context.addInitScript(installScreenMocks,{wakeMode,fullscreenMode});
    await observeBrowserErrors(context,{result,baseURL});
    const net={requests:[],active:0,maxActive:0,teamActive:0,teamMaxActive:0,modes:{},summaryMode:'ok',expectedFailures:new Map(),expectedImageFailures:new Map(),requestFailures:[]};
    context.on('requestfailed',request=>net.requestFailures.push({url:request.url(),errorText:request.failure()?.errorText,at:Date.now()}));
    context.on('page',page=>{page.setDefaultTimeout(6500);page.on('console',message=>{if(message.type()==='error'){const url=message.location().url||page.url(),at=Date.now(),category=at-(net.expectedFailures.get(url)??-Infinity)<15000?'injected-feed-failure':at-(net.expectedImageFailures.get(url)??-Infinity)<2000?'injected-image-failure':/^https:\/\/(?:a\.espncdn\.com|media\.formula1\.com)/.test(url)?'external-image-failure':'unexpected';result.consoleErrors.push({url,message:message.text(),category,at});}});});
    await context.route('**/api/**',async route=>{
      const url=new URL(route.request().url()),leagueId=url.searchParams.get('league')||'nfl',kind=url.pathname.slice(5),mode=net.modes[leagueId]||'ok';
      net.requests.push({kind,leagueId,date:url.searchParams.get('date'),at:Date.now(),url:url.href});net.active++;net.maxActive=Math.max(net.maxActive,net.active);
      if(kind==='teams'){net.teamActive++;net.teamMaxActive=Math.max(net.teamMaxActive,net.teamActive);}
      try{
        if(kind==='teams'){
          await new Promise(resolve=>setTimeout(resolve,10));
          if(mode==='directory-error'){net.expectedFailures.set(url.href,Date.now());return await route.fulfill({status:503,json:{error:'QA directory unavailable'}});}
          const body=directories[leagueId]||fallbackDirectory(leagueId);return await route.fulfill({json:{...body,fetchedAt:new Date().toISOString()}});
        }
        if(mode==='network-error'){net.expectedFailures.set(url.href,Date.now());return await route.abort('internetdisconnected');}
        if(mode==='error'){net.expectedFailures.set(url.href,Date.now());return await route.fulfill({status:503,json:{error:'QA forced feed failure'}});}
        if(mode==='timeout'){net.expectedFailures.set(url.href,Date.now());await new Promise(resolve=>setTimeout(resolve,10500));try{return await route.fulfill({status:503,json:{error:'QA response arrived after client timeout'}});}catch{return;}}
        if(kind==='scoreboard'){
          const body=scoreboardForLeague(leagueId,{directories});
          if(mode==='empty')body.games=[];if(mode==='stale'){body.stale=true;body.feedStatus='cached';body.fetchedAt=new Date(Date.now()-90000).toISOString();}
          return await route.fulfill({json:body});
        }
        if(kind==='game'){
          if(net.summaryMode==='error'){net.expectedFailures.set(url.href,Date.now());return await route.fulfill({status:503,json:{error:'QA details unavailable'}});}
          const game=fixtureForLeague(leagueId,{directories});game.id=url.searchParams.get('id')||game.id;
          const body=detailsForGame(game);if(net.summaryMode==='empty'){body.teamStats=[];body.allTeamStats=[];body.playByPlay=[];}
          return await route.fulfill({json:body});
        }
        return await route.fulfill({status:404,json:{error:'Unexpected QA API route'}});
      }finally{net.active--;if(kind==='teams')net.teamActive--;}
    });
    return {context,net};
  };

  for(let pass=1;pass<=passes;pass++){
    console.log(`Flows ${engine}: pass ${pass}/${passes}`);
    const {context,net}=await makeContext(),page=await context.newPage();activePage=page;
    await page.goto(baseURL);await waitBoard(page,'#scorebug-preview svg.scorebug','nfl');
    const originalMetrics=await page.evaluate(()=>window.__qaMetrics());
    await check(`p${pass}:all-league-style-dropdowns`,async()=>{
      equal(await page.locator('#league-select option').count(),LEAGUES.length,'All supported leagues are selectable');
      for(const league of LEAGUES){
        await page.selectOption('#league-select',league.id);await waitBoard(page,'#scorebug-preview svg.scorebug',league.id);
        const options=await page.locator('#style-select option').evaluateAll(nodes=>nodes.map(node=>node.value));
        equal(new Set(options).size,SCOREBUG_STYLES.length,`${league.id}: all style IDs are selectable`);
        const styles=engine==='webkit'?SCOREBUG_STYLES.filter((_,index)=>index%9===0||index===SCOREBUG_STYLES.length-1):SCOREBUG_STYLES;
        for(const style of styles){await page.selectOption('#style-select',style.id);await waitBoard(page,'#scorebug-preview svg.scorebug',league.id,style.id);const current=await prefs(page);equal([current.leagueId,current.styleId],[league.id,style.id]);result.dropdownSelections++;}
      }
      equal(await page.evaluate(()=>window.__qaHistoryErrors),[],'Rapid real dropdown changes must not exceed the browser History API limit');
    });
    await check(`p${pass}:favorite-style-keyboard-and-persistence`,async()=>{
      await page.selectOption('#league-select','nba');await page.selectOption('#style-select','nfl-blades');await waitBoard(page,'#scorebug-preview svg.scorebug','nba','nfl-blades');
      equal((await page.locator('#style-select option:checked').textContent()).trim(), 'Blades (2020–2022)');
      const before=await prefs(page);await page.locator('#favorite-current-style').focus();await page.keyboard.press('Space');
      await page.waitForFunction(()=>document.querySelector('#favorite-current-style').getAttribute('aria-pressed')==='true');
      const next=await prefs(page);equal(next.favoriteStyleIds,['nfl-blades']);equal([next.leagueId,next.gameId,next.styleId,next.styleAuto],[before.leagueId,before.gameId,before.styleId,before.styleAuto]);
      equal((await page.locator('#style-select option:checked').textContent()).trim(), 'Blades');
      equal((await page.locator('[data-pick-style="nfl-blades"]').textContent()).trim(), 'Blades');
      await page.reload();await waitBoard(page,'#scorebug-preview svg.scorebug','nba','nfl-blades');equal((await prefs(page)).favoriteStyleIds,['nfl-blades']);
      await page.locator('#style-browser-toggle').click();
      equal((await page.locator('.style-card[data-style-id="nfl-blades"] small').textContent()).trim(), '2020–2022');
      await page.locator('#favorite-styles-only').check();equal(await page.locator('.style-card').count(),1);
      truth(await page.locator('.style-card small').isHidden(),'Favorites-only cards show the name without the era');
      await page.locator('.style-card [data-style-action="favorite"]').click();await page.waitForFunction(()=>document.querySelectorAll('.style-card').length===0);
      equal((await prefs(page)).favoriteStyleIds,[]);truth(await page.evaluate(()=>document.activeElement?.id==='favorite-styles-only'),'Focus returns to a stable control after removing the only filtered card');
      await page.locator('#favorite-styles-only').uncheck();await page.locator('#style-browser-toggle').click();
    });
    await check(`p${pass}:global-directory-search-and-favorites`,async()=>{
      await page.locator('#favorite-editor > summary').click();await page.locator('#favorite-search').fill('Chicago Bears');
      await page.waitForFunction(()=>document.querySelector('#favorite-directory-status')?.textContent.includes('30 of 30'),null,{timeout:20000});
      const before=await prefs(page),teamRequests=net.requests.filter(request=>request.kind==='teams').length;let saved=0;
      equal(Object.keys(directories).length,LEAGUES.length,'Every league needs an audited directory fixture; tiny visual fixtures do not satisfy all-team coverage');
      for(const league of LEAGUES){
        const team=directories[league.id]?.teams[0];if(!team){truth(Boolean(directories[league.id]?.coverage),'An empty audited directory must explicitly describe its source coverage');continue;}
        await page.selectOption('#favorite-league-select',league.id);await page.locator('#favorite-search').fill(team.name);
        const button=page.locator('#favorite-results button').filter({hasText:team.name}).first();await button.waitFor();
        await button.click();await page.waitForFunction(async({leagueId,teamId})=>(await import('/score-client.js')).getPreferences().favorites.some(f=>f.leagueId===leagueId&&f.teamId===teamId),{leagueId:league.id,teamId:team.id});
        const current=await prefs(page);equal([current.leagueId,current.gameId,current.styleId],[before.leagueId,before.gameId,before.styleId]);saved++;
      }
      equal((await prefs(page)).favorites.length,saved);truth(net.teamMaxActive<=3,`Directory fetch queue exceeded three concurrent requests: ${net.teamMaxActive}`);
      equal(net.requests.filter(request=>request.kind==='teams').length,teamRequests,'Typing and filtering must not trigger a new request for every query');
      await page.selectOption('#favorite-league-select','all');await page.locator('#favorite-search').fill('Chicago Bears');truth((await page.locator('#favorite-results').innerText()).includes('Chicago Bears'),'Global search finds Bears while watching NBA');
      const allTeams=Object.values(directories).flatMap(directory=>directory.teams);truth(allTeams.length>0,'Audited directory fixtures must be present for the release gate');
      const searchResult=await page.evaluate(async teams=>{const {mergeFavoriteTeams,searchFavoriteTeams,favoriteTeamKey}=await import('/favorite-search.js');const merged=mergeFavoriteTeams(teams),failures=[];for(const team of merged)for(const scope of ['all',team.leagueId]){const found=searchFavoriteTeams(merged,team.name,{leagueId:scope,limit:100}).teams;if(!found.some(candidate=>favoriteTeamKey(candidate)===favoriteTeamKey(team)))failures.push({team:favoriteTeamKey(team),scope});}return{count:merged.length,queries:merged.length*2,failures};},allTeams);
      result.directorySearches+=searchResult.queries;equal(searchResult.failures,[],'Every audited team must be discoverable by full name globally and within its league in the actual browser search module');
      await page.reload();await waitBoard(page,'#scorebug-preview svg.scorebug','nba');equal((await prefs(page)).favorites.length,saved);
      await page.evaluate(async()=>{await(await import('/score-client.js')).updatePreferences({favorites:[]});});
    });
    await check(`p${pass}:popout-shared-style-side-rows-and-game-center`,async()=>{
      await page.selectOption('#league-select','nba');await page.selectOption('#style-select','nfl-blades');await page.locator('button[data-orientation="vertical"]').click();
      const popupPromise=context.waitForEvent('page');await page.locator('#clean-button').click();const popup=await popupPromise;await popup.waitForLoadState('domcontentloaded');await waitBoard(popup,'svg.scorebug','nba','nfl-blades');equal(await popup.locator('svg.scorebug').getAttribute('data-orientation'),'vertical');
      await page.selectOption('#style-select','nfl-cbs-deconstructed');await waitBoard(popup,'svg.scorebug','nba','nfl-cbs-deconstructed');
      await page.selectOption('#league-select','f1');await waitBoard(popup,'svg.scorebug','f1');await page.locator('#racing-rows').fill('22');await page.locator('#racing-rows').dispatchEvent('input');
      await popup.waitForFunction(()=>document.querySelectorAll('.variant-classification-row').length===22);
      await popup.reload();await popup.waitForFunction(()=>document.querySelectorAll('.variant-classification-row').length===22);equal((await prefs(popup)).racingRows,22);
      const centerPromise=context.waitForEvent('page');await page.locator('#game-center-button').click();const center=await centerPromise;await center.waitForLoadState('domcontentloaded');await waitBoard(center,'#center-scorebug svg','f1');truth((await center.locator('#center-comparison').innerText()).includes('Kimi Antonelli'),'Full classification includes the lead driver');
      await center.selectOption('#center-league-select','nba');await waitBoard(center,'#center-scorebug svg','nba');await center.waitForFunction(()=>document.querySelector('#center-comparison').textContent.includes('Three-point percentage'));truth(!(await center.locator('#center-comparison').innerText()).includes('Total yards'),'Basketball details must not contain football yardage');
      for(let repetition=0;repetition<2;repetition++)for(const style of SCOREBUG_STYLES){await center.selectOption('#center-style-select',style.id);result.gameCenterDropdownSelections=(result.gameCenterDropdownSelections||0)+1;}
      await center.selectOption('#center-style-select','nfl-cbs-deconstructed');await waitBoard(center,'#center-scorebug svg','nba','nfl-cbs-deconstructed');await center.reload();await waitBoard(center,'#center-scorebug svg','nba','nfl-cbs-deconstructed');await waitBoard(page,'#scorebug-preview svg','nba','nfl-cbs-deconstructed');await waitBoard(popup,'svg.scorebug','nba','nfl-cbs-deconstructed');
      equal(await center.evaluate(()=>window.__qaHistoryErrors),[],'Game Center shares the bounded URL updater');
      if(pass===1)await screenshot(center,'game-center-basketball');await center.close();await popup.close();await page.locator('button[data-orientation="horizontal"]').click();
    });
    await check(`p${pass}:all-sport-demo-entry-and-exit`,async()=>{
      const testedSports=new Set();
      for(const league of LEAGUES){if(testedSports.has(league.sport))continue;testedSports.add(league.sport);
        await page.selectOption('#league-select',league.id);await waitBoard(page,'#scorebug-preview svg',league.id);
        const options=await page.locator('#demo-event option').evaluateAll(nodes=>nodes.map(node=>node.value));equal(options,eventsForSport(league.sport).map(event=>event.kind));
        const events=eventsForSport(league.sport);await page.evaluate(()=>{window.__qaAnimationEvents=[];});
        for(const [index,event]of events.entries()){
          if(index===0){await page.selectOption('#demo-event',event.kind);await page.locator('#demo-play').click();}
          const overlay=page.locator('.score-animation');await overlay.waitFor({state:'visible'});await page.waitForFunction(kind=>document.querySelector('.score-animation')?.dataset.kind===kind,event.kind);
          equal(await overlay.locator('.score-animation-title').innerText(),event.title);equal(await overlay.getAttribute('data-demo'),'true');
          if(event.scope==='session'){truth(await page.locator('#demo-competitor-control').isHidden(),'Session events hide driver selector');equal(await overlay.locator('.score-animation-player-name,.score-animation-team-name,.score-animation-player-photo').count(),0);}
          await page.waitForFunction(kind=>window.__qaAnimationEvents.some(event=>event.kind===kind&&event.type==='animationend'&&event.name==='score-enter'),event.kind);
          // Queue the next demo through the real UI. Switching to a different
          // sample game would remove/reinsert the host and cancel its CSS timeline.
          const next=events[index+1];if(next){await page.selectOption('#demo-event',next.kind);await page.locator('#demo-play').click();}
          await page.waitForFunction(kind=>window.__qaAnimationEvents.some(event=>event.kind===kind&&event.type==='animationstart'&&event.name==='score-exit'),event.kind,{timeout:5000});
          await page.waitForFunction(kind=>window.__qaAnimationEvents.some(event=>event.kind===kind&&event.type==='animationend'&&event.name==='score-exit'),event.kind,{timeout:5000});
          truth(await page.evaluate(kind=>window.__qaAnimationEvents.some(event=>event.kind===kind&&event.type==='animationend'&&event.name==='score-exit'&&event.elapsedTime>=.25),event.kind),'Every demo must complete its actual260ms CSS exit');
          if(!next)await overlay.waitFor({state:'hidden'});result.animationEvents++;
        }
      }
      // Natural expiry is checked separately, with the original 3s hold intact.
      await page.selectOption('#league-select','nfl');await page.selectOption('#demo-event','touchdown');await page.evaluate(()=>{window.__qaAnimationEvents=[];});await page.locator('#demo-play').click();await page.locator('.score-animation').waitFor({state:'visible'});await page.waitForFunction(()=>window.__qaAnimationEvents.some(event=>event.type==='animationstart'&&event.name==='score-exit'),null,{timeout:5000});await page.locator('.score-animation').waitFor({state:'hidden'});truth(await page.evaluate(()=>window.__qaAnimationEvents.some(event=>event.type==='animationend'&&event.name==='score-exit')),'Natural expiry completes the exit animation');
    });
    await check(`p${pass}:score-feed-failure-stale-reconnect`,async()=>{
      await page.selectOption('#league-select','nba');await waitBoard(page,'#scorebug-preview svg','nba');const before=await page.locator('#scorebug-preview svg .variant-score').allTextContents();
      net.modes.nba='error';await page.locator('#refresh-button').click();await page.waitForFunction(()=>!document.querySelector('#feed-error').hidden);equal(await page.locator('#scorebug-preview svg .variant-score').allTextContents(),before);truth((await page.locator('#scorebug-preview').innerText()).includes('DELAYED'),'The retained scoreboard is labelled delayed');
      net.modes.nba='ok';await page.evaluate(()=>window.dispatchEvent(new Event('online')));await page.waitForFunction(()=>document.querySelector('#feed-error').hidden);await waitBoard(page,'#scorebug-preview svg','nba');
      net.modes.nba='stale';await page.locator('#refresh-button').click();await page.waitForFunction(()=>document.querySelector('#scorebug-preview').textContent.includes('DELAYED'));equal(await page.locator('#scorebug-preview svg .variant-score').allTextContents(),before);
      net.modes.nba='ok';await page.locator('#refresh-button').click();await page.waitForFunction(()=>!document.querySelector('#scorebug-preview').textContent.includes('DELAYED'));
      net.modes.nba='network-error';await page.evaluate(()=>window.dispatchEvent(new Event('online')));await page.waitForFunction(()=>!document.querySelector('#feed-error').hidden);equal(await page.locator('#scorebug-preview svg .variant-score').allTextContents(),before);net.modes.nba='ok';await page.evaluate(()=>window.dispatchEvent(new Event('online')));await page.waitForFunction(()=>document.querySelector('#feed-error').hidden);
      const abortedBefore=(await page.evaluate(()=>window.__qaMetrics())).network.aborted;net.modes.nba='timeout';await page.locator('#refresh-button').click();await page.waitForFunction(()=>!document.querySelector('#feed-error').hidden,null,{timeout:13000});equal(await page.locator('#scorebug-preview svg .variant-score').allTextContents(),before);truth((await page.evaluate(()=>window.__qaMetrics())).network.aborted>abortedBefore,'A hung feed is aborted at the real client request deadline');net.modes.nba='ok';await page.evaluate(()=>window.dispatchEvent(new Event('online')));await page.waitForFunction(()=>document.querySelector('#feed-error').hidden);
    });
    await check(`p${pass}:global-poller-listener-lifecycle`,async()=>{
      await page.selectOption('#league-select','nfl');await page.evaluate(async()=>{await(await import('/score-client.js')).updatePreferences({favorites:[],racingRows:6,orientation:'horizontal'});});
      const baseline=await page.evaluate(()=>window.__qaMetrics());
      for(let cycle=0;cycle<3;cycle++){await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));await page.waitForTimeout(40);const hidden=await page.evaluate(()=>window.__qaMetrics());equal(hidden.network.active,0,'Pagehide aborts active feed requests');await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));await waitBoard(page,'#scorebug-preview svg','nfl');}
      const after=await page.evaluate(()=>window.__qaMetrics());equal(after.listeners,baseline.listeners,'Repeated stop/start must not add global poller listeners');equal(after.activeIntervals,baseline.activeIntervals,'Repeated stop/start must not leak interval timers');
      result.network.push({pass,kind:'main',requests:net.requests.length,maxActive:net.maxActive,teamMaxActive:net.teamMaxActive,before:originalMetrics,baseline,after});
    });
    result.extraFlows??=[];result.extraFlows.push({pass,...await runExtraFlows({page,context,net,pass,engine,check,equal,truth,prefs,waitBoard,screenshot,directories})});
    await context.close();

    const delayed=await makeContext(),delayedPage=await delayed.context.newPage();activePage=delayedPage;
    result.delayedReloads??=[];result.delayedReloads.push(await runDelayedReloadFlow({page:delayedPage,context:delayed.context,baseURL,pass,engine,check,equal,truth,prefs,waitBoard}));
    result.network.push({pass,kind:'delayed-reload',requests:delayed.net.requests.length,maxActive:delayed.net.maxActive,teamMaxActive:delayed.net.teamMaxActive});
    await delayed.context.close();

    const imageTest=await makeContext(),imagePage=await imageTest.context.newPage();activePage=imagePage;
    let imageMode='error';const imageGame=fixtureForLeague('epl',{directories}),imageURLs=new Set([imageGame.away.logo,imageGame.home.logo]);
    await imageTest.context.route(url=>imageURLs.has(url.href),async route=>{
      if(imageMode==='error'){imageTest.net.expectedImageFailures.set(route.request().url(),Date.now());return route.abort('failed');}
      // The app icon is a PNG load fixture, not evidence about an external crest.
      return route.fulfill({contentType:'image/png',headers:{'cache-control':'no-store'},body:recoveryPNG});
    });
    await imagePage.goto(`${baseURL}/widget.html?league=epl&style=nfl-blades`);await waitBoard(imagePage,'svg.scorebug','epl','nfl-blades');
    await check(`p${pass}:failed-svg-logos-fallback-and-recovery`,async()=>{
      await imagePage.waitForFunction(()=>document.querySelectorAll('svg.scorebug image[data-image-state="error"][display="none"]').length===2);
      equal(await imagePage.locator('.bug-team-logo-fallback-label').allTextContents(),[imageGame.away.abbreviation,imageGame.home.abbreviation]);
      equal(await imagePage.locator('svg.scorebug .variant-score').allTextContents(),[String(imageGame.away.score),String(imageGame.home.score)],'Image failure cannot replace the score');
      const labels=await imagePage.locator('.bug-team-logo-fallback-label').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return{width:r.width,height:r.height,fill:getComputedStyle(node).fill};}));
      for(const label of labels)truth(label.width>0&&label.height>0&&label.fill==='rgb(255, 255, 255)','Fallback is a visible readable label');
      if(pass===1)await screenshot(imagePage,'external-logo-fallback');
      imageMode='loaded';const successfulResponses=[...imageURLs].map(url=>imagePage.waitForResponse(response=>response.url()===url&&response.status()===200));await imagePage.reload();await Promise.all(successfulResponses);await waitBoard(imagePage,'svg.scorebug','epl','nfl-blades');
      const decoded=await imagePage.evaluate(async urls=>Promise.all(urls.map(async src=>{const image=new Image();image.src=src;await image.decode();return{width:image.naturalWidth,height:image.naturalHeight};})),[...imageURLs]);for(const image of decoded)truth(image.width>0&&image.height>0,'Successful provider-format PNG response actually decodes');
      equal(await imagePage.locator('svg.scorebug image:not([display="none"])').count(),2,'Fresh successful render displays both SVG images');
      equal(await imagePage.locator('[data-scorebug-image-fallback]').count(),0,'A fresh successful render restores visible images without stale labels');
      result.imageRecovery??=[];result.imageRecovery.push({pass,failedURLs:[...imageURLs],fallbackLabels:labels.length,recoveredImages:2,successfulAsset:'App icon PNG load fixture; bundled team artwork is verified separately'});
    });await imageTest.context.close();

    const partial=await makeContext(),searchPage=await partial.context.newPage();activePage=searchPage;partial.net.modes.epl='directory-error';
    await searchPage.goto(baseURL);await waitBoard(searchPage,'#scorebug-preview svg','nfl');
    await check(`p${pass}:partial-global-directory-failure-and-retry`,async()=>{
      await searchPage.locator('#favorite-editor > summary').click();await searchPage.locator('#favorite-search').fill('Chicago Bears');await searchPage.locator('#favorite-retry').waitFor({state:'visible',timeout:20000});truth((await searchPage.locator('#favorite-results').innerText()).includes('Chicago Bears'),'A failed league directory does not remove teams available from other leagues');
      const before=partial.net.requests.filter(request=>request.kind==='teams').length;partial.net.modes.epl='ok';await searchPage.locator('#favorite-retry').click();await searchPage.waitForFunction(()=>document.querySelector('#favorite-directory-status').textContent.includes('30 of 30'));equal(partial.net.requests.filter(request=>request.kind==='teams').length-before,1,'Retry only reloads the failed league');
      const team=(directories.epl||fallbackDirectory('epl')).teams[0];await searchPage.locator('#favorite-search').fill(team.name);truth((await searchPage.locator('#favorite-results').innerText()).includes(team.name));equal((await prefs(searchPage)).leagueId,'nfl','Global search/retry cannot change the watched league');
    });await partial.context.close();

    const navigation=await makeContext(),navigationPage=await navigation.context.newPage();activePage=navigationPage;
    const otherSlot={id:'slot-b',leagueId:'nba',gameId:'nba:qa2',date:'20261102',styleId:'nba-nbc-pods',racingRows:11};
    await navigation.context.addInitScript(({otherSlot})=>{
      if(location.protocol!=='http:'||localStorage.getItem('scorebug.qa.navigation-seeded'))return;
      localStorage.setItem('scorebug.qa.navigation-seeded','true');
      localStorage.setItem('scorebug.preferences.v2',JSON.stringify({leagueId:'nba',gameId:'nba:qa2',date:'20261101',styleId:'nfl-blades',styleAuto:false,racingRows:6,favorites:[{leagueId:'nfl',teamId:'3',name:'Chicago Bears'}]}));
      localStorage.setItem('scorebug.standby.v1',JSON.stringify({version:1,dimmed:true,slots:[{id:'slot-a',leagueId:'nba',gameId:'nba:qa1',date:null,styleId:'nfl-blades',racingRows:22},otherSlot]}));
    },{otherSlot});
    await navigationPage.goto(`${baseURL}/standby.html`);await waitBoard(navigationPage,'.standby-card:first-child svg.scorebug','nba','nfl-blades');
    await check(`p${pass}:standby-game-center-current-context-roundtrip`,async()=>{
      const details=navigationPage.locator('.slot-details').first(),detailsURL=new URL(await details.getAttribute('href'),baseURL);
      equal(detailsURL.searchParams.get('date'),'');equal(detailsURL.searchParams.get('rows'),'22');
      const start=navigation.net.requests.length;await details.click();await waitBoard(navigationPage,'#center-scorebug svg','nba','nfl-blades');
      const current=await prefs(navigationPage);equal([current.date,current.gameId,current.racingRows],[null,'nba:qa1',22],'A current Standby card cannot inherit the main view’s saved historical date');
      truth(navigation.net.requests.slice(start).filter(request=>request.kind==='scoreboard').every(request=>request.date===null),'Game Center requests the current schedule');
      equal(new URL(await navigationPage.locator('#center-standby').getAttribute('href'),baseURL).searchParams.get('game'),'nba:qa1','A live game link carries the actual selected game');
      await navigationPage.evaluate(({otherSlot})=>localStorage.setItem('scorebug.standby.v1',JSON.stringify({version:1,dimmed:true,slots:[{id:'slot-a',leagueId:'nba',gameId:'nba:qa2',date:'20261101',styleId:'nba-nbc-pods',racingRows:6},otherSlot]})),{otherSlot});
      navigation.net.modes.nba='empty';await navigationPage.locator('#center-automatic').click();await navigationPage.locator('#center-refresh').click();await navigationPage.waitForFunction(()=>document.querySelector('#center-scorebug .empty-note'));
      const url=new URL(await navigationPage.locator('#center-standby').getAttribute('href'),baseURL);equal(url.searchParams.get('game'),'');equal(url.searchParams.get('date'),'');equal(url.searchParams.get('rows'),'22');
      const main=await navigationPage.evaluate(()=>localStorage.getItem('scorebug.preferences.v2'));await navigationPage.locator('#center-standby').click();await navigationPage.locator('.standby-card').first().waitFor();
      const board=await navigationPage.evaluate(()=>JSON.parse(localStorage.getItem('scorebug.standby.v1')));equal([board.slots[0].date,board.slots[0].gameId,board.slots[0].racingRows],[null,null,22]);equal(board.slots[1],otherSlot,'Only the first Standby card receives the entry context');equal(board.dimmed,true);
      equal(await navigationPage.evaluate(()=>localStorage.getItem('scorebug.preferences.v2')),main,'Returning to Standby does not alter the main preferences');
      truth(!new URL(navigationPage.url()).searchParams.has('rows'),'Consumed seed rows cannot overwrite later card edits on reload');
    });await navigation.context.close();

    const mobile=await makeContext({mobile:true,wakeMode:'success',fullscreenMode:'reject'});
    const seededPreferences=JSON.stringify({leagueId:'nfl',gameId:'401700000',styleId:'nfl-blades',styleAuto:false,racingRows:22,scale:1.25,orientation:'vertical',favorites:[{leagueId:'nfl',teamId:'3',name:'Chicago Bears',abbreviation:'CHI'}]});
    await mobile.context.addInitScript(value=>{if(location.protocol==='http:'&&!localStorage.getItem('scorebug.preferences.v2'))localStorage.setItem('scorebug.preferences.v2',value);},seededPreferences);
    const phone=await mobile.context.newPage();activePage=phone;
    await phone.goto(`${baseURL}/standby.html?league=nba&style=nfl-blades&game=nba:qa1`);await waitBoard(phone,'.standby-scorebug svg','nba','nfl-blades');
    result.deviceProfiles.push({pass,engine,viewport:{width:390,height:844},touch:true});
    await check(`p${pass}:standby-independent-slots-and-save`,async()=>{
      truth(!(new URL(phone.url()).searchParams.has('game')),'Seed URL is consumed after initial selection');
      for(let index=1;index<4;index++){await phone.locator('#standby-add').click();await phone.locator('#slot-dialog').waitFor({state:'visible'});await phone.selectOption('#slot-league','nba');await phone.selectOption('#slot-game',index%2?'nba:qa2':'nba:qa1');await phone.selectOption('#slot-style',SCOREBUG_STYLES[index].id);await phone.locator('#slot-done').click();}
      equal(await phone.locator('.standby-card').count(),4);truth(await phone.locator('#standby-add').isDisabled(),'Maximum four cards');
      const state=await phone.evaluate(()=>JSON.parse(localStorage.getItem('scorebug.standby.v1')));equal(state.slots.map(slot=>slot.gameId),['nba:qa1','nba:qa2','nba:qa1','nba:qa2']);equal(new Set(state.slots.map(slot=>slot.styleId)).size,4);
      await phone.reload();await phone.waitForFunction(()=>document.querySelectorAll('.standby-scorebug svg').length===4);equal((await phone.evaluate(()=>JSON.parse(localStorage.getItem('scorebug.standby.v1')))).slots,state.slots);
      equal(await phone.evaluate(()=>localStorage.getItem('scorebug.preferences.v2')),seededPreferences,'Standby choices must not replace saved main-view preferences');
      await phone.locator('.slot-configure').nth(3).click();await phone.locator('#slot-remove').click();equal(await phone.locator('.standby-card').count(),3);
      await phone.locator('#standby-add').click();await phone.selectOption('#slot-league','nba');await phone.locator('#slot-done').click();equal(await phone.locator('.standby-card').count(),4);
    });
    await check(`p${pass}:standby-phone-layout-hide-and-keyboard`,async()=>{
      for(const size of [{width:390,height:844},{width:844,height:390},{width:320,height:568},{width:568,height:320}]){
        await phone.setViewportSize(size);await phone.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        if(size.width<size.height){
          const controls=await phone.locator('.standby-card .slot-heading,.standby-card .slot-footer,.standby-card .slot-details').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect(),c=node.closest('.standby-card').getBoundingClientRect();return{className:node.className,x:r.x,y:r.y,right:r.right,bottom:r.bottom,card:{x:c.x,y:c.y,right:c.right,bottom:c.bottom}};}));
          equal(controls.length,12);for(const bounds of controls)truth(bounds.x>=bounds.card.x-1&&bounds.right<=bounds.card.right+1&&bounds.y>=bounds.card.y-1&&bounds.bottom<=bounds.card.bottom+1,`Visible portrait control must fit its card at ${size.width}px: ${JSON.stringify(bounds)}`);
          if(pass===1)await screenshot(phone,`standby-controls-${size.width}x${size.height}`);
        }
        await phone.locator('#standby-controls-toggle').click();await phone.waitForFunction(()=>document.body.dataset.controls==='hidden');
        const bounds=await phone.locator('.standby-scorebug svg').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect(),card=node.closest('.standby-card').getBoundingClientRect();return{width:r.width,height:r.height,x:r.x,y:r.y,right:r.right,bottom:r.bottom,card:{x:card.x,y:card.y,right:card.right,bottom:card.bottom}};}));
        equal(bounds.length,4);for(const box of bounds){truth(box.width>0&&box.height>0,'Every slot has a rendered board');truth(box.x>=-1&&box.right<=size.width+1&&(size.width<size.height||box.y>=-1&&box.bottom<=size.height+1),`Hidden-controls scorebug exceeds horizontal or landscape viewport at ${size.width}×${size.height}: ${JSON.stringify(box)}`);truth(box.x>=box.card.x-1&&box.right<=box.card.right+1&&box.y>=box.card.y-1&&box.bottom<=box.card.bottom+1,'Scorebug fits inside its card; short portrait layouts may scroll vertically');}
        if(pass===1)await screenshot(phone,`standby-${size.width}x${size.height}`);await phone.keyboard.press('Escape');equal(await phone.locator('body').getAttribute('data-controls'),'visible');
      }
      await phone.setViewportSize({width:844,height:390});await phone.locator('#standby-dim').click();equal(await phone.locator('body').getAttribute('data-dimmed'),'true');await phone.reload();await phone.waitForFunction(()=>document.querySelectorAll('.standby-scorebug svg').length===4);equal(await phone.locator('body').getAttribute('data-dimmed'),'true');
    });
    await check(`p${pass}:standby-pooled-network-and-lifecycle`,async()=>{
      const count=()=>mobile.net.requests.filter(request=>request.kind==='scoreboard').length;
      const before=count();await phone.waitForTimeout(4500);const activeDelta=count()-before;truth(activeDelta>=2&&activeDelta<=3,`Four same-league cards should share a single 2s poll; received ${activeDelta} in 4.5s`);
      const baseline=await phone.evaluate(()=>window.__qaMetrics());
      for(let cycle=0;cycle<3;cycle++){
        await phone.evaluate(()=>window.__qaScreen.setVisibility('hidden'));await phone.waitForTimeout(80);const stopped=count();await phone.waitForTimeout(2150);equal(count(),stopped,'Hidden Standby must stop scoreboard requests');equal((await phone.evaluate(()=>window.__qaMetrics())).network.active,0);
        await phone.evaluate(()=>window.__qaScreen.setVisibility('visible'));await phone.waitForTimeout(80);truth(count()>stopped,'Visibility resume requests immediately');
      }
      await phone.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));await phone.waitForTimeout(80);const stopped=count();await phone.waitForTimeout(2150);equal(count(),stopped,'Pagehide stops feed pools');await phone.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));await phone.waitForTimeout(80);truth(count()>stopped,'Pageshow restarts the feed pool');
      const after=await phone.evaluate(()=>window.__qaMetrics());equal(after.listeners,baseline.listeners,'Visibility cycles must not leak listeners');equal(after.activeIntervals,baseline.activeIntervals,'Visibility cycles must not leak timers');result.network.push({pass,kind:'standby',pooledRequestsIn4500ms:activeDelta,baseline,after,totalRequests:count()});
    });
    await check(`p${pass}:standby-wake-lock-release-resume-and-fullscreen-fallback`,async()=>{
      await phone.locator('#standby-awake').click();await phone.waitForFunction(()=>document.querySelector('#standby-awake').getAttribute('aria-pressed')==='true');equal((await phone.evaluate(()=>window.__qaScreen.state())).requests,1);
      await phone.evaluate(()=>window.__qaScreen.setVisibility('hidden'));await phone.waitForFunction(()=>document.querySelector('#standby-awake-status').textContent.includes('paused'));equal((await phone.evaluate(()=>window.__qaScreen.state())).active,false);
      await phone.evaluate(()=>window.__qaScreen.setVisibility('visible'));await phone.waitForFunction(()=>document.querySelector('#standby-awake').getAttribute('aria-pressed')==='true');equal((await phone.evaluate(()=>window.__qaScreen.state())).requests,2);
      await phone.evaluate(()=>window.__qaScreen.release());await phone.waitForFunction(()=>document.querySelector('#standby-awake-status').textContent.includes('released'));await phone.locator('#standby-awake').click();await phone.waitForFunction(()=>document.querySelector('#standby-awake').getAttribute('aria-pressed')==='true');
      await phone.locator('#standby-fullscreen').click();truth((await phone.locator('#standby-screen-status').innerText()).includes('Add to Home Screen'),'Blocked fullscreen gives actionable iPhone fallback');truth(await phone.locator('#standby-help').isVisible());
      await phone.locator('#standby-awake').click();equal((await phone.evaluate(()=>window.__qaScreen.state())).active,false);
    });
    await check(`p${pass}:standby-retains-score-on-failure-and-recovers`,async()=>{
      const gameIds=await phone.locator('.standby-scorebug svg').evaluateAll(nodes=>nodes.map(node=>node.dataset.gameId));mobile.net.modes.nba='error';await phone.locator('#standby-refresh').click();await phone.waitForFunction(()=>[...document.querySelectorAll('.slot-phase')].every(node=>node.textContent==='DELAYED'));equal(await phone.locator('.standby-scorebug svg').evaluateAll(nodes=>nodes.map(node=>node.dataset.gameId)),gameIds);mobile.net.modes.nba='ok';await phone.locator('#standby-refresh').click();await phone.waitForFunction(()=>![...document.querySelectorAll('.slot-phase')].some(node=>node.textContent==='DELAYED'));
    });
    await mobile.context.close();

    for(const mode of ['unsupported','reject']){
      const attempt=await makeContext({mobile:true,wakeMode:mode,fullscreenMode:'unsupported'}),fallback=await attempt.context.newPage();activePage=fallback;attempt.net.modes.nfl=mode==='unsupported'?'empty':'error';
      await fallback.goto(`${baseURL}/standby.html`);
      await check(`p${pass}:standby-${mode}-permissions-and-initial-${mode==='unsupported'?'empty':'failure'}`,async()=>{
        await fallback.locator('.slot-empty').waitFor();equal(await fallback.locator('.standby-scorebug svg').count(),0,'No invented score while the first feed is empty or unavailable');
        if(mode==='unsupported')truth(await fallback.locator('#standby-awake').isDisabled(),'Unsupported wake lock is disabled');else{await fallback.locator('#standby-awake').click();await fallback.waitForFunction(()=>document.querySelector('#standby-awake-status').textContent.includes('could not'));equal(await fallback.locator('#standby-awake').getAttribute('aria-pressed'),'false');}
        await fallback.locator('#standby-fullscreen').click();truth((await fallback.locator('#standby-screen-status').innerText()).includes('unavailable'));
        attempt.net.modes.nfl='ok';await fallback.locator('#standby-refresh').click();await waitBoard(fallback,'.standby-scorebug svg','nfl');
      });await attempt.context.close();
    }
    console.log(`Flows ${engine}: pass ${pass} complete; ${result.checks} checks, ${result.assertions} assertions, ${result.failures.length} failures.`);
  }
  finalizeBrowserErrors(result,{engine,baseURL});
  const unexpectedConsole=result.consoleErrors.filter(error=>error.category==='unexpected');if(unexpectedConsole.length)result.failures.push({id:'unexpected-console-errors',message:JSON.stringify(unexpectedConsole)});
  result.elapsedMs=Date.now()-started;return result;
}
