import { SCOREBUG_STYLES } from '../../public/scorebug-styles.js';
import { FAVORITE_TEAM_INDEX } from '../../public/favorite-team-index.js';
import { localTeamLogo } from '../../public/team-assets.js';
import { MULTISPORT_LOGO_ARTWORK } from '../../public/team-logo-artwork.js';
import { fixtureForLeague } from './fixtures.mjs';

/** Keep a real pointer gesture intact if a saved team's remote logo fails. */
export async function verifyFavoriteRemovalDuringLogoFailure({page,net,pass,engine,equal,truth,prefs,directories}) {
  const original=await prefs(page);
  const bears=directories.nfl?.teams.find(team=>team.name==='Chicago Bears');
  const stars=directories.nwsl?.teams.find(team=>/Chicago (?:Stars|Red Stars)/.test(team.name));
  truth(Boolean(bears?.logo&&stars),'The audited Bears and Chicago Stars fixtures are available');
  // A fresh URL requests the real logo path rather than reusing decoded image
  // data from earlier tests. Only this test's saved favorite uses the query.
  const logo=new URL(bears.logo);logo.searchParams.set('qa-favorite-failure',`${engine}-${pass}`);
  const favorites=[['nfl',{...bears,logo:logo.href}],['nwsl',stars]].map(([leagueId,team])=>({leagueId,teamId:team.id,name:team.name,abbreviation:team.abbreviation,logo:team.logo,color:team.color}));
  let releaseImage,pointerDown=false,requests=0;
  const failureGate=new Promise(resolve=>releaseImage=resolve);
  const match=url=>url.href===logo.href;
  const failLogo=async route=>{
    requests++;await failureGate;
    net.expectedImageFailures.set(route.request().url(),Date.now());
    await route.abort('failed');
  };
  await page.route(match,failLogo);
  try{
    await page.selectOption('#league-select','nba');await page.selectOption('#style-select','nfl-blades');
    // Seed a saved board, then use its actual controls after a real reload.
    // Writing storage alone avoids creating an extra image request in the
    // outgoing document while the request under test is intentionally held.
    await page.evaluate(favorites=>{
      const key='scorebug.preferences.v2',saved=JSON.parse(localStorage.getItem(key)||'{}');
      localStorage.setItem(key,JSON.stringify({...saved,favorites}));
    },favorites);
    await page.reload({waitUntil:'domcontentloaded'});
    const remove=page.getByRole('button',{name:`Remove ${bears.name} from favorites`,exact:true});
    await remove.scrollIntoViewIfNeeded();
    const pending=await remove.locator('..').locator('img').evaluate(image=>!image.complete);
    truth(pending&&requests>0,'The actual favorite-logo request is still pending before pointerdown');
    const before=await remove.boundingBox();truth(Boolean(before),'The Remove button has visible bounds');
    await page.mouse.move(before.x+before.width/2,before.y+before.height/2);
    await page.mouse.down();pointerDown=true;releaseImage();
    await page.waitForFunction(url=>{
      const image=[...document.querySelectorAll('#favorite-chips img')].find(image=>image.src===url);
      return image?.complete&&image.naturalWidth===0;
    },logo.href);
    const after=await remove.boundingBox();
    equal(after,before,'A failed favorite logo must not move or resize the Remove button during a pointer gesture');
    await page.mouse.up();pointerDown=false;
    equal((await prefs(page)).favorites.map(team=>team.teamId),[stars.id],'The original pointerup removes Bears immediately');
    equal(await page.locator('#favorite-chips button').count(),1,'Only the Stars favorite remains in the UI');
    await page.getByRole('button',{name:`Remove ${stars.name} from favorites`,exact:true}).click();
    await page.selectOption('#league-select','nfl');await page.selectOption('#style-select','nfl-blades');
    equal((await prefs(page)).favorites,[],'A second removal and rapid sport/style changes keep both teams removed');
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.querySelector('#league-select')?.options.length>20);
    const restored=await prefs(page);
    equal(restored.favorites,[],'Both removals persist after reload');
    equal([restored.leagueId,restored.styleId],['nfl','nfl-blades'],'The requested sport and style persist with the removals');
    equal(await page.locator('#favorite-chips button').count(),0);
    return {before,after,requests,remainingFavorites:restored.favorites.length};
  }finally{
    releaseImage();if(pointerDown)await page.mouse.up();
    await page.unroute(match,failLogo);
    await page.evaluate(async original=>{await(await import('/score-client.js')).updatePreferences(original,{updateURL:true});},original);
  }
}

/** Real controls and navigation beyond the catalog renderer matrix. */
export async function runExtraFlows({page,context,net,pass,engine,check,equal,truth,prefs,waitBoard,screenshot,directories}) {
  const evidence={localLogos:0,sizeSelections:0,hoverPanels:0,driverSelections:0,mobileWidths:[]};
  const choose=async(leagueId='nfl',styleId='nfl-blades')=>{
    await page.selectOption('#league-select',leagueId);
    await page.selectOption('#style-select',styleId);
    await waitBoard(page,'#scorebug-preview svg.scorebug',leagueId,styleId);
  };
  const current=async()=>{
    await page.locator('#follow-live').click();
    await page.waitForFunction(async()=>{const p=(await import('/score-client.js')).getPreferences();return p.gameId===null&&p.date===null;});
  };
  const openDetails=async side=>{
    const target=page.locator(`#scorebug-preview [data-details-side="${side}"]`);
    await target.scrollIntoViewIfNeeded();
    await target.focus();await page.keyboard.press('Enter');
    await page.waitForFunction(()=>document.querySelector('.details-popover')?.dataset.phase==='open');
    const frame=page.frameLocator('.details-popover iframe');
    await frame.locator(`body[data-side="${side}"]`).waitFor();
    return frame;
  };
  const closeDetails=async()=>{
    await page.frameLocator('.details-popover iframe').locator('#details-close').click();
    await page.locator('.details-popover').waitFor({state:'detached'});
    await page.mouse.move(0,0);
  };

  await check(`p${pass}:all-bundled-logos-decode-and-rams-colors`,async()=>{
    const assets=[...new Set([...FAVORITE_TEAM_INDEX.map(localTeamLogo),...Object.values(MULTISPORT_LOGO_ARTWORK).map(item=>item.file)].filter(path=>path?.startsWith('/logos/')))];
    const results=await page.evaluate(async paths=>Promise.all(paths.map(path=>new Promise(resolve=>{
      const image=new Image(),timer=setTimeout(()=>resolve({path,error:'Image did not load in 8s'}),8000);
      image.onload=()=>{
        clearTimeout(timer);
        const result={path,width:image.naturalWidth,height:image.naturalHeight};
        if(path==='/logos/lar.png'){
          const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
          const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
          const rgba=ctx.getImageData(0,0,canvas.width,canvas.height).data;let blue=0,yellow=0;
          for(let i=0;i<rgba.length;i+=4)if(rgba[i+3]>160){const[r,g,b]=rgba.subarray(i,i+3);if(b>r*1.35&&b>90)blue++;if(r>160&&g>100&&b<r*.65)yellow++;}
          result.bluePixels=blue;result.yellowPixels=yellow;
        }
        resolve(result);
      };
      image.onerror=()=>{clearTimeout(timer);resolve({path,error:'Image decode failed'});};image.src=path;
    }))),assets);
    equal(results.filter(result=>result.error),[],'Every bundled team image must decode');
    truth(results.every(result=>result.width>0&&result.height>0),'Team images have nonzero natural dimensions');
    const rams=results.find(result=>result.path==='/logos/lar.png');
    truth(rams?.bluePixels>1000&&rams?.yellowPixels>1000,'Rams artwork retains both blue and yellow rather than a one-color replacement');
    evidence.localLogos=results.length;
  });

  await check(`p${pass}:live-game-pinning-dates-and-automatic`,async()=>{
    await choose();await current();
    const live=fixtureForLeague('nfl',{directories}),scheduled=fixtureForLeague('nfl',{directories,index:1,variant:'scheduled'});
    const liveButton=page.locator(`#live-games [data-game-id="${live.id}"]`);
    await liveButton.waitFor();await liveButton.click();
    await page.waitForFunction(id=>(document.querySelector('#live-games [aria-pressed="true"]')?.dataset.gameId===id),live.id);
    equal((await prefs(page)).gameId,live.id);
    if(!await page.locator('#other-games').evaluate(node=>node.open))await page.locator('#other-games > summary').click();
    await page.selectOption('#game-select',scheduled.id);
    await page.waitForFunction(id=>document.querySelector('#scorebug-preview svg')?.dataset.gameId===id,scheduled.id);
    equal((await prefs(page)).gameId,scheduled.id);
    await page.locator('#date-input').fill('2026-11-25');await page.locator('#date-input').dispatchEvent('change');
    await page.waitForFunction(async()=>(await import('/score-client.js')).getPreferences().date==='20261125');
    await page.waitForFunction(()=>document.querySelector('#scorebug-preview svg')!==null);
    truth(net.requests.some(request=>request.kind==='scoreboard'&&request.leagueId==='nfl'&&request.date==='20261125'),'Date picker requests the selected dated schedule');
    await page.locator('#week-button').click();await current();
    equal([(await prefs(page)).gameId,(await prefs(page)).date],[null,null]);
    await page.locator('#reference-toggle').click();equal(await page.locator('#phase-badge').innerText(),'SAMPLE');
    equal((await prefs(page)).gameId,null,'Sample preview cannot pin a made-up event');
    await page.locator('#reference-toggle').click();await waitBoard(page,'#scorebug-preview svg','nfl');
    equal(await page.locator('#reference-toggle').getAttribute('aria-pressed'),'false');
  });

  await check(`p${pass}:every-size-step-normal-and-side`,async()=>{
    await choose();
    for(const orientation of ['horizontal','vertical']){
      await page.locator(`button[data-orientation="${orientation}"]`).click();
      for(let step=13;step<=36;step++){
        const scale=step/20;await page.locator('#size-range').fill(String(scale));
        await page.locator('#size-range').dispatchEvent('input');
        await page.waitForFunction(expected=>document.querySelector('#size-value').textContent===`${Math.round(expected*100)}%`,scale);
        equal((await prefs(page)).scale,scale);equal(await page.locator('#scorebug-preview svg').getAttribute('data-orientation'),orientation);
        const bounds=await page.locator('#scorebug-preview svg').boundingBox();truth(bounds?.width>0&&bounds?.height>0,'Every slider step renders visible artwork');evidence.sizeSelections++;
      }
    }
    await page.locator('#size-range').fill('1');await page.locator('#size-range').dispatchEvent('input');
    await page.locator('button[data-orientation="horizontal"]').click();
  });

  await check(`p${pass}:team-and-middle-stats-field-placement-and-keyboard-close`,async()=>{
    await choose();await current();
    for(const orientation of ['horizontal','vertical']){
      await page.locator(`button[data-orientation="${orientation}"]`).click();
      for(const side of ['away','home','comparison']){
        const frame=await openDetails(side);
        await frame.locator('#details-match').filter({hasNotText:'Connecting'}).waitFor();
        equal(await frame.locator('#comparison-stats').isVisible(),side==='comparison');
        equal(await frame.locator('.field-block').isVisible(),side==='comparison','The field belongs in the middle comparison only');
        const bounds=await page.locator('.details-popover').boundingBox(),viewport=page.viewportSize();
        truth(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=viewport.width+1&&bounds.y+bounds.height<=viewport.height+1,'Stats expansion stays inside the viewport');
        await closeDetails();evidence.hoverPanels++;
      }
    }
    await page.locator('button[data-orientation="horizontal"]').click();await choose('nba','nfl-blades');
    const frame=await openDetails('comparison');
    await frame.locator('#comparison-stats').filter({hasText:'Three-point'}).waitFor();
    truth(!(await frame.locator('#comparison-stats').innerText()).includes('Total yards'),'NBA comparison uses basketball statistics');
    if(pass===1)await screenshot(page,'basketball-middle-expansion');
    await closeDetails();evidence.hoverPanels++;
  });

  await check(`p${pass}:favorite-shortcuts-global-enter-and-removal`,async()=>{
    await choose('nba','nfl-blades');await current();
    await page.evaluate(async()=>{await(await import('/score-client.js')).updatePreferences({favorites:[]});});
    if(!await page.locator('#favorite-editor').evaluate(node=>node.open))await page.locator('#favorite-editor > summary').click();
    await page.selectOption('#favorite-league-select','all');
    const game=fixtureForLeague('nba',{directories}),team=game.away;
    await page.locator('#favorite-search').fill(team.name);await page.locator('#favorite-results button').filter({hasText:team.name}).first().click();
    const favorite=page.locator(`#favorite-games [data-game-id="${game.id}"]`);await favorite.waitFor();
    truth(await page.locator(`#live-games [data-game-id="${game.id}"]`).isVisible(),'A live favorite remains in the normal live list');
    await favorite.click();equal((await prefs(page)).gameId,game.id);
    await page.locator('#favorite-chips button').first().click();
    await page.waitForFunction(async()=>(await import('/score-client.js')).getPreferences().favorites.length===0);
    await page.locator('#favorite-search').fill('Chicago Bears');await page.locator('#favorite-search').press('Enter');
    await page.waitForFunction(async()=>(await import('/score-client.js')).getPreferences().favorites.some(team=>team.leagueId==='nfl'&&team.name==='Chicago Bears'));
    equal((await prefs(page)).leagueId,'nba','Saving an NFL team must not switch the watched NBA game');
    await page.locator('#favorite-chips button').first().click();await current();
  });

  await check(`p${pass}:favorite-removal-survives-logo-failure-during-pointer`,async()=>{
    evidence.favoriteRemoval=await verifyFavoriteRemovalDuringLogoFailure({page,net,pass,engine,equal,truth,prefs,directories});
  });

  await check(`p${pass}:style-gallery-search-sport-filter-and-empty-recovery`,async()=>{
    await choose('nba','nfl-blades');
    if(await page.locator('#style-browser').isHidden())await page.locator('#style-browser-toggle').click();
    await page.locator('#all-styles').check();await page.locator('#favorite-styles-only').uncheck();
    await page.locator('#style-search').fill('FOX Blades');
    equal(await page.locator('.style-card').count(),1);equal(await page.locator('.style-card').getAttribute('data-style-id'),'nfl-blades');
    await page.locator('#all-styles').uncheck();equal(await page.locator('.style-card').count(),0);
    await page.locator('.style-gallery-empty button').click();equal(await page.locator('.style-card').count(),SCOREBUG_STYLES.length);
    await page.locator('#all-styles').uncheck();equal(await page.locator('.style-card').count(),SCOREBUG_STYLES.filter(style=>style.sport==='basketball').length);
    await page.locator('#all-styles').check();await page.locator('#style-search').fill('zz-no-style-qa');equal(await page.locator('.style-card').count(),0);
    await page.locator('.style-gallery-empty button').click();equal(await page.locator('.style-card').count(),SCOREBUG_STYLES.length);
    await page.locator('#style-browser-toggle').click();
  });

  await check(`p${pass}:f1-driver-dropdown-and-single-line-name`,async()=>{
    await choose('f1','f1-rounded-tower');
    const driverValues=await page.locator('#demo-team option').evaluateAll(nodes=>nodes.map(node=>node.value));
    equal(driverValues.length,22,'Every reported driver is available to demo');
    for(const value of driverValues){await page.selectOption('#demo-team',value);equal(await page.locator('#demo-team').inputValue(),value);evidence.driverSelections++;}
    await page.selectOption('#demo-team',driverValues[0]);await page.selectOption('#demo-event','lead-change');await page.locator('#demo-play').click();
    const name=page.locator('.score-animation-player-name');await name.waitFor({state:'visible'});
    equal(await name.innerText(),'Kimi Antonelli');
    const geometry=await name.evaluate(node=>{const box=node.getBoundingClientRect(),css=getComputedStyle(node);return{width:box.width,height:box.height,lineHeight:parseFloat(css.lineHeight),scrollWidth:node.scrollWidth,clientWidth:node.clientWidth};});
    truth(geometry.height<=geometry.lineHeight+1&&geometry.scrollWidth<=geometry.clientWidth+1,'Driver name occupies one fitted line');
    if(pass===1)await screenshot(page,'f1-driver-animation');
    await page.locator('.score-animation').waitFor({state:'hidden',timeout:6000});
  });

  await check(`p${pass}:main-phone-layout-and-standby-entry`,async()=>{
    await choose('nba','nfl-blades');await page.locator('button[data-orientation="horizontal"]').click();
    if(await page.locator('#style-browser').isHidden())await page.locator('#style-browser-toggle').click();
    await page.locator('#style-search').fill('Blades');
    for(const width of [320,390,768]){
      await page.setViewportSize({width,height:844});
      const geometry=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth,main:document.querySelector('.app-shell').getBoundingClientRect().right}));
      truth(geometry.scroll<=width+1&&geometry.main<=width+1,`Main page must not overflow at ${width}px: ${JSON.stringify(geometry)}`);
      const button=page.locator('#standby-button');equal(await button.getAttribute('href'),'/standby.html');
      if(pass===1)await screenshot(page,`main-${width}`);evidence.mobileWidths.push(width);
    }
    await page.locator('#style-search').fill('');await page.locator('#style-browser-toggle').click();
    await page.setViewportSize({width:1366,height:900});
    const standalone=await context.newPage();await standalone.goto(new URL('/standby.html',page.url()).href);
    await standalone.locator('#standby-grid').waitFor();equal(await standalone.locator('link[rel="manifest"]').getAttribute('href'),'/standby.webmanifest');
    const response=await standalone.request.get(new URL('/standby.webmanifest',page.url()).href);truth(response.ok(),'Home-screen manifest is served');truth(response.headers()['content-type'].includes('application/manifest+json'),'Manifest has its browser MIME type');
    await standalone.close();await choose();await current();
  });
  return evidence;
}
