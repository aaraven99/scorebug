// WebKit reports some refused fetches from an outgoing document as JavaScript
// console errors. Playwright 1.65.1 forwards those as pageerror (issue #43120).
// Keep that native diagnostic distinct from an actual uncaught JavaScript error.
// A real ErrorEvent or unhandled rejection always remains fatal.
const STORAGE_KEY='scorebug.qa.native-errors.v1';

export function installNativeErrorProbe({storageKey}){
  const documentId=`${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const state={documentId,persistenceReady:false};window.__qaNativeErrorProbe=state;
  try{if(localStorage.getItem(storageKey)===null)localStorage.setItem(storageKey,'[]');state.persistenceReady=true;}catch{}
  const send=value=>{try{Promise.resolve(window.__qaNativeDiagnostic(value)).catch(()=>{});}catch{}};
  const report=(kind,value)=>{
    const record={id:`${documentId}-${++sequence}`,documentId,kind,at:Date.now(),url:location.href,...value};
    try{const saved=JSON.parse(localStorage.getItem(storageKey)||'[]');saved.push(record);localStorage.setItem(storageKey,JSON.stringify(saved));}catch{state.persistenceReady=false;}
    send({type:'error',record});
  };
  let sequence=0;
  window.addEventListener('error',event=>{if(event instanceof ErrorEvent)report('error',{name:event.error?.name||'Error',message:event.message,stack:event.error?.stack||'',filename:event.filename});},true);
  window.addEventListener('unhandledrejection',event=>report('unhandledrejection',{name:event.reason?.name||'',message:String(event.reason?.message??event.reason),stack:event.reason?.stack||''}),true);
  send({type:'ready',documentId,persistenceReady:state.persistenceReady});
}

export function classifyBrowserError(error,{engine,baseURL,navigations=[],nativeErrors=[]}={}){
  const unexpected=reason=>({category:'unexpected',reason});
  if(engine!=='webkit')return unexpected('Not the WebKit native diagnostic');
  if(nativeErrors.length)return unexpected('A native DOM uncaught error was observed');
  if(!error.nativeProbeReady)return unexpected('Native DOM error telemetry was not verified');
  const line=String(error.stack||'').split('\n')[0];
  const match=/^Fetch API cannot load (https?:\/\/\S+) due to access control checks\.$/.exec(line);
  if(!match)return unexpected('Native Fetch signature does not match');
  let url,origin;try{url=new URL(match[1]);origin=new URL(baseURL).origin;}catch{return unexpected('Invalid diagnostic URL');}
  const caller={'/api/scoreboard':'/score-client.js:','/api/game':'/game-details-client.js:'}[url.pathname];
  if(url.origin!==origin||!caller||url.username||url.password||url.hash)return unexpected('Diagnostic is not an observed same-origin score API');
  if(error.name!==`Fetch API cannot load ${url.protocol.slice(0,-1)}`||error.message!==`${url.href.slice(url.protocol.length+1)} due to access control checks.`)return unexpected('Playwright error fields do not match the native diagnostic');
  if(!/\bat unknown \(web-inspector:\/\/bootstrap\.js:\d+:\d+\)/.test(error.stack)||!error.stack.includes(new URL(caller,baseURL).href))return unexpected('Native WebKit fetch stack does not match the observed endpoint and caller');
  const navigation=navigations.find(value=>value.id===error.navigationId&&value.pageId===error.pageId);
  if(!navigation||navigation.kind!=='reload'||navigation.outcome!=='completed')return unexpected('No successful explicit reload for this page');
  if(!(navigation.startedAt<=error.at&&error.at<=navigation.finishedAt))return unexpected('Diagnostic occurred outside the explicit reload');
  const sameDocument=value=>{try{const candidate=new URL(value),previous=new URL(navigation.fromURL);candidate.hash='';previous.hash='';return candidate.origin===origin&&candidate.href===previous.href;}catch{return false;}};
  const request=navigation.requests.find(value=>sameDocument(value.url)&&navigation.startedAt<=value.at);
  const commit=request&&navigation.commits.find(value=>request.at<=value.at);
  if(!request||!commit||!sameDocument(commit.url)||error.at<request.at||error.at>commit.at||commit.at>navigation.finishedAt)return unexpected('Diagnostic is outside an observed main-document request-to-first-commit interval');
  return {category:'webkit-navigation-cancellation',reason:'Native WebKit refused an outgoing-document score fetch between an observed reload request and first commit; no DOM uncaught error was reported.',source:'https://github.com/microsoft/playwright/issues/43120',navigationId:navigation.id,requestURL:url.href};
}

export async function observeBrowserErrors(context,{result,baseURL}){
  result.pageErrors??=[];result.nativeErrors??=[];result.navigationLedger??=[];result.diagnosticProbeFailures??=[];result.browserRequestFailures??=[];
  const contextId=result.diagnosticContexts=(result.diagnosticContexts||0)+1;
  const pages=new Map(),seenErrors=new Set();let pageSequence=0;
  const nativeError=record=>{if(!seenErrors.has(record.id)){seenErrors.add(record.id);result.nativeErrors.push(record);}};
  await context.exposeBinding('__qaNativeDiagnostic',({page},value)=>{
    const state=pages.get(page);if(!state)return;
    if(value.type==='ready'){state.documentId=value.documentId;state.nativeProbeReady=value.persistenceReady;}
    else if(value.type==='error')nativeError({...value.record,pageId:state.id});
  });
  await context.addInitScript(installNativeErrorProbe,{storageKey:STORAGE_KEY});
  const collect=async page=>{
    if(page.isClosed()||!page.url().startsWith(`${new URL(baseURL).origin}/`))return;
    try{
      const captured=await page.evaluate(storageKey=>({probe:window.__qaNativeErrorProbe,errors:JSON.parse(localStorage.getItem(storageKey)||'[]')}),STORAGE_KEY);
      if(!captured.probe?.persistenceReady)result.diagnosticProbeFailures.push({pageId:pages.get(page)?.id,url:page.url(),message:'Native DOM error persistence was unavailable'});
      for(const error of captured.errors)nativeError(error);
    }catch(error){result.diagnosticProbeFailures.push({pageId:pages.get(page)?.id,url:page.url(),message:error.message});}
  };
  context.on('page',page=>{
    const state={id:`context-${contextId}-page-${++pageSequence}`,activeNavigation:null,nativeProbeReady:false,documentId:null};pages.set(page,state);
    page.on('pageerror',error=>result.pageErrors.push({pageId:state.id,url:page.url(),message:error.message,name:error.name,stack:error.stack,at:Date.now(),documentId:state.documentId,nativeProbeReady:state.nativeProbeReady,navigationId:state.activeNavigation?.id||null}));
    page.on('requestfailed',request=>result.browserRequestFailures.push({pageId:state.id,url:request.url(),errorText:request.failure()?.errorText,at:Date.now()}));
    page.on('request',request=>{if(state.activeNavigation&&request.isNavigationRequest()&&request.frame()===page.mainFrame())state.activeNavigation.requests.push({url:request.url(),at:Date.now()});});
    page.on('framenavigated',frame=>{if(state.activeNavigation&&frame===page.mainFrame())state.activeNavigation.commits.push({url:frame.url(),at:Date.now()});});
    const originalReload=page.reload.bind(page);
    page.reload=async(...args)=>{
      const navigation={id:`navigation-${result.navigationLedger.length+1}`,pageId:state.id,kind:'reload',fromURL:page.url(),startedAt:Date.now(),finishedAt:null,outcome:'pending',requests:[],commits:[]};
      result.navigationLedger.push(navigation);state.activeNavigation=navigation;
      try{const response=await originalReload(...args);navigation.outcome='completed';return response;}catch(error){navigation.outcome='failed';throw error;}finally{navigation.finishedAt=Date.now();state.activeNavigation=null;}
    };
    const originalClose=page.close.bind(page);page.close=async(...args)=>{await collect(page);return originalClose(...args);};
  });
  const originalClose=context.close.bind(context);
  context.close=async(...args)=>{for(const page of context.pages())await collect(page);return originalClose(...args);};
}

export function finalizeBrowserErrors(result,{engine,baseURL}){
  for(const error of result.pageErrors)Object.assign(error,classifyBrowserError(error,{engine,baseURL,navigations:result.navigationLedger,nativeErrors:result.nativeErrors}));
  result.browserDiagnostics=result.pageErrors.filter(error=>error.category==='webkit-navigation-cancellation');
  const unexpected=result.pageErrors.filter(error=>error.category!=='webkit-navigation-cancellation');
  if(unexpected.length)result.failures.push({id:'uncaught-browser-errors',message:JSON.stringify(unexpected)});
  if(result.nativeErrors.length)result.failures.push({id:'native-dom-uncaught-errors',message:JSON.stringify(result.nativeErrors)});
  if(result.diagnosticProbeFailures.length)result.failures.push({id:'native-error-probe-failure',message:JSON.stringify(result.diagnosticProbeFailures)});
}
