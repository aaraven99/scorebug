/** A reload can already be in flight while the outgoing page keeps receiving
 * selections from another window. Exercise that interval with real controls. */
export async function runDelayedReloadFlow({page,context,baseURL,pass,engine,check,equal,truth,prefs,waitBoard}) {
  const evidence={engine,pass,outgoingWrites:[]};
  await check(`p${pass}:delayed-reload-keeps-latest-shared-selection-and-explicit-links`,async()=>{
    let center,releaseResponse,reloadOutcome,holdDocument;
    const observedWrites=[],observers=new Set();
    const origin=new URL(baseURL).origin,initialStyle='f1-2026-tower',finalStyle='nfl-cbs-deconstructed';
    const documentURL=url=>url.origin===origin&&url.pathname==='/game.html';
    try{
      await page.goto(baseURL);
      await waitBoard(page,'#scorebug-preview svg.scorebug','nfl');
      await page.selectOption('#league-select','f1');await waitBoard(page,'#scorebug-preview svg.scorebug','f1');
      await page.locator('#racing-rows').fill('22');await page.locator('#racing-rows').dispatchEvent('input');
      await page.selectOption('#league-select','nba');await page.selectOption('#style-select',initialStyle);
      await waitBoard(page,'#scorebug-preview svg.scorebug','nba',initialStyle);

      const opened=context.waitForEvent('page');await page.locator('#game-center-button').click();center=await opened;
      await center.waitForLoadState('domcontentloaded');await waitBoard(center,'#center-scorebug svg','nba',initialStyle);
      await center.waitForFunction(style=>new URL(location.href).searchParams.get('style')===style,initialStyle,{timeout:8000});
      equal((await prefs(center)).racingRows,22,'Game Center starts with the selected full-grid row preference');
      const outgoingDocument=`delayed-reload-${engine}-${pass}`;
      await center.exposeBinding('__qaDelayedReloadWrite',(_source,value)=>{
        observedWrites.push(value);for(const observer of [...observers])observer(value);
      });
      await center.evaluate(value=>{
        window.__qaDelayedReloadDocument=value;
        const replace=history.replaceState;
        history.replaceState=function(...args){
          const result=replace.apply(this,args);
          // Chromium may defer external evaluate calls until navigation commits.
          // Observe the outgoing document from its own actual history updates.
          queueMicrotask(()=>{
            const state={at:Date.now(),href:location.href,documentId:window.__qaDelayedReloadDocument,styleId:document.querySelector('#center-scorebug svg')?.dataset.styleId,savedStyle:JSON.parse(localStorage.getItem('scorebug.preferences.v2')).styleId};
            window.__qaDelayedReloadWrite(state).catch(()=>{});
          });
          return result;
        };
      },outgoingDocument);
      const waitForWrite=style=>new Promise((resolve,reject)=>{
        let timer;
        const observe=value=>{
          if(value.documentId!==outgoingDocument||new URL(value.href).searchParams.get('style')!==style||value.styleId!==style||value.savedStyle!==style)return;
          clearTimeout(timer);observers.delete(observe);resolve(value);
        };
        timer=setTimeout(()=>{observers.delete(observe);reject(Error(`No outgoing history write for ${style}: ${JSON.stringify(observedWrites)}`));},8000);
        observers.add(observe);for(const value of observedWrites)observe(value);
      });

      const responseGate=new Promise(resolve=>releaseResponse=resolve);
      holdDocument=async route=>{
        evidence.heldRequests=(evidence.heldRequests||0)+1;
        evidence.requestURL=route.request().url();evidence.requestedAt=Date.now();
        await responseGate;await route.continue();
      };
      await center.route(documentURL,holdDocument);
      const requested=center.waitForRequest(request=>request.isNavigationRequest()&&request.frame()===center.mainFrame()&&documentURL(new URL(request.url())),{timeout:8000});
      // Keep the normal page.reload wrapper so the strict navigation/error
      // ledger observes the real request, history writes and eventual commit.
      reloadOutcome=center.reload({waitUntil:'domcontentloaded',timeout:8000}).then(()=>({}),error=>({error}));
      const request=await requested;
      equal(new URL(request.url()).searchParams.get('style'),initialStyle,'The reload has requested the older style before subsequent choices');

      for(const style of ['nfl-cbs-eyebar','soccer-premier-league',finalStyle]){
        await page.selectOption('#style-select',style);await waitBoard(page,'#scorebug-preview svg.scorebug','nba',style);
        const observed=await waitForWrite(style);
        equal([observed.documentId,observed.styleId,observed.savedStyle],[outgoingDocument,style,style],'Each URL write belongs to the outgoing document and its newest saved selection');
        evidence.outgoingWrites.push(observed);
      }
      equal(evidence.outgoingWrites.length,3,'More than one outgoing URL update occurs after the reload request');
      equal(evidence.heldRequests,1,'The original Game Center document response remains held throughout the choices');
      evidence.releasedAt=Date.now();releaseResponse();
      const completion=await reloadOutcome;if(completion.error)throw completion.error;
      await center.unroute(documentURL,holdDocument);holdDocument=null;
      await center.waitForFunction(()=>document.querySelector('#center-scorebug svg'),null,{timeout:8000});
      evidence.reloaded=await center.evaluate(()=>({href:location.href,navigationType:performance.getEntriesByType('navigation')[0]?.type,saved:JSON.parse(localStorage.getItem('scorebug.preferences.v2')),sameOutgoingDocument:Boolean(window.__qaDelayedReloadDocument),svgStyle:document.querySelector('#center-scorebug svg')?.dataset.styleId}));
      await waitBoard(center,'#center-scorebug svg','nba',finalStyle);
      await waitBoard(page,'#scorebug-preview svg.scorebug','nba',finalStyle);
      const reloaded=await prefs(center),shared=await prefs(page);
      for(const [label,value]of [['reloaded Game Center',reloaded],['main window',shared]])equal([value.leagueId,value.styleId,value.racingRows,value.gameId,value.date],['nba',finalStyle,22,null,null],`${label} keeps the latest shared context after the delayed reload`);
      equal(evidence.reloaded.navigationType,'reload');equal(evidence.reloaded.sameOutgoingDocument,false,'The assertion inspects the replacement document');
      equal([evidence.reloaded.saved.styleId,evidence.reloaded.saved.racingRows],[finalStyle,22]);

      // Reuse this same tab, including its session storage. A fresh link must
      // override the old owned-intent marker rather than inherit its choices.
      const explicit=new URL('/game.html',baseURL);
      for(const [key,value]of Object.entries({league:'nba',style:'nba-nbc-pods',rows:'6',game:'',date:''}))explicit.searchParams.set(key,value);
      await center.goto(explicit.href);await waitBoard(center,'#center-scorebug svg','nba','nba-nbc-pods');
      await waitBoard(page,'#scorebug-preview svg.scorebug','nba','nba-nbc-pods');
      const linked=await prefs(center);
      equal([linked.leagueId,linked.styleId,linked.racingRows,linked.gameId,linked.date],['nba','nba-nbc-pods',6,null,null],'A fresh explicit share link wins in the same tab');
      equal((await prefs(page)).styleId,'nba-nbc-pods','The explicit selection synchronizes back to the main window');
      evidence.explicit=await center.evaluate(()=>({href:location.href,navigationType:performance.getEntriesByType('navigation')[0]?.type,saved:JSON.parse(localStorage.getItem('scorebug.preferences.v2'))}));
      equal(evidence.explicit.navigationType,'navigate');
      equal([evidence.explicit.saved.styleId,evidence.explicit.saved.racingRows],['nba-nbc-pods',6]);
    }finally{
      releaseResponse?.();if(reloadOutcome)await reloadOutcome;
      if(center&&!center.isClosed()){if(holdDocument)await center.unroute(documentURL,holdDocument);await center.close();}
    }
  });
  return evidence;
}
