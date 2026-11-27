import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyBrowserError,finalizeBrowserErrors} from './qa/browser-diagnostics.mjs';

const baseURL='http://127.0.0.1:42215';
function fixture(){
  const url=`${baseURL}/api/scoreboard?league=wcbb`;
  const error={pageId:'page-1',nativeProbeReady:true,navigationId:'reload-1',at:120,name:'Fetch API cannot load http',message:`${url.slice(6)} due to access control checks.`,stack:`Fetch API cannot load ${url} due to access control checks.\n    at unknown (web-inspector://bootstrap.js:823:153)\n    at refresh (${baseURL}/score-client.js:363:42)`};
  const navigation={id:'reload-1',pageId:'page-1',kind:'reload',fromURL:`${baseURL}/?league=nba`,startedAt:100,finishedAt:140,outcome:'completed',requests:[{url:`${baseURL}/?league=nba`,at:110}],commits:[{url:`${baseURL}/?league=nba`,at:130}]};
  return {error,navigation,options:{engine:'webkit',baseURL,navigations:[navigation],nativeErrors:[]}};
}

test('a documented WebKit cancellation is retained only within the actual reload request-to-first-commit interval',()=>{
  const {error,options}=fixture();
  const classified=classifyBrowserError(error,options);
  assert.equal(classified.category,'webkit-navigation-cancellation');
  assert.equal(classified.requestURL,`${baseURL}/api/scoreboard?league=wcbb`);
  assert.equal(classified.navigationId,'reload-1');
  assert.equal(classified.source,'https://github.com/microsoft/playwright/issues/43120');
  const result={pageErrors:[error],nativeErrors:[],navigationLedger:options.navigations,diagnosticProbeFailures:[],failures:[]};
  finalizeBrowserErrors(result,options);
  assert.equal(result.failures.length,0);
  assert.equal(result.pageErrors[0],error,'The complete original diagnostic remains in the report');
  assert.equal(result.browserDiagnostics[0],error);
});

test('other engines, origins, endpoints and error signatures remain fatal',()=>{
  const changes=[
    ['other engine',value=>value.options.engine='chromium'],
    ['other origin',value=>{value.error.stack=value.error.stack.replaceAll(baseURL,'http://example.invalid');value.error.message=value.error.message.replace('127.0.0.1:42215','example.invalid');}],
    ['unobserved teams endpoint',value=>{value.error.stack=value.error.stack.replace('/api/scoreboard','/api/teams');value.error.message=value.error.message.replace('/api/scoreboard','/api/teams');}],
    ['game endpoint with scoreboard caller',value=>{value.error.stack=value.error.stack.replace('/api/scoreboard','/api/game');value.error.message=value.error.message.replace('/api/scoreboard','/api/game');}],
    ['scoreboard endpoint with game caller',value=>value.error.stack=value.error.stack.replace('score-client.js','game-details-client.js')],
    ['ordinary thrown Error',value=>value.error.name='Error'],
    ['different message',value=>value.error.message+=' extra'],
    ['different first line',value=>value.error.stack='Error: '+value.error.stack],
    ['no native stack',value=>value.error.stack=value.error.stack.replace('web-inspector://bootstrap.js','app.js')],
    ['other fetch caller',value=>value.error.stack=value.error.stack.replace('score-client.js','other.js')],
    ['unverified DOM probe',value=>value.error.nativeProbeReady=false],
    ['real DOM error',value=>value.options.nativeErrors.push({kind:'error',message:value.error.stack.split('\n')[0]})],
    ['real unhandled rejection',value=>value.options.nativeErrors.push({kind:'unhandledrejection',message:'Load failed'})],
  ];
  for(const [name,change]of changes){const value=fixture();change(value);assert.equal(classifyBrowserError(value.error,value.options).category,'unexpected',name);}
});

test('missing, unrelated, failed or completed document transitions do not qualify',()=>{
  const changes=[
    ['no explicit reload',value=>value.error.navigationId=null],
    ['another page',value=>value.navigation.pageId='page-2'],
    ['another operation',value=>value.navigation.kind='click'],
    ['failed reload',value=>value.navigation.outcome='failed'],
    ['pending reload',value=>value.navigation.outcome='pending'],
    ['before reload',value=>value.error.at=99],
    ['after reload',value=>value.error.at=141],
    ['no actual document request',value=>value.navigation.requests=[]],
    ['no actual commit',value=>value.navigation.commits=[]],
    ['unrelated request',value=>value.navigation.requests[0].url=`${baseURL}/elsewhere`],
    ['unrelated commit',value=>value.navigation.commits[0].url=`${baseURL}/elsewhere`],
    ['before request',value=>value.error.at=109],
    ['after first commit',value=>value.error.at=131],
    ['a later history event cannot extend the interval',value=>{value.error.at=131;value.navigation.commits.push({url:value.navigation.fromURL,at:135});}],
    ['a different first commit cannot be skipped for a later matching history event',value=>{value.navigation.commits[0].url=`${baseURL}/elsewhere`;value.navigation.commits.push({url:value.navigation.fromURL,at:135});}],
  ];
  for(const [name,change]of changes){const value=fixture();change(value);assert.equal(classifyBrowserError(value.error,value.options).category,'unexpected',name);}
});

test('the independently observed game-details endpoint is accepted only with its own caller',()=>{
  const {error,options}=fixture();
  error.stack=error.stack.replace('/api/scoreboard?league=wcbb','/api/game?id=nba%3Aqa1&league=nba').replace('score-client.js','game-details-client.js');
  error.message=error.message.replace('/api/scoreboard?league=wcbb','/api/game?id=nba%3Aqa1&league=nba');
  assert.equal(classifyBrowserError(error,options).category,'webkit-navigation-cancellation');
});

test('DOM uncaught errors and failed telemetry have independent fatal gates, including exact-message lookalikes',()=>{
  const {error,options}=fixture();
  const result={pageErrors:[error],nativeErrors:[{kind:'error',message:error.stack.split('\n')[0]},{kind:'unhandledrejection',message:'A real rejected promise'}],navigationLedger:options.navigations,diagnosticProbeFailures:[{message:'Storage blocked'}],failures:[]};
  finalizeBrowserErrors(result,options);
  assert.deepEqual(result.failures.map(value=>value.id),['uncaught-browser-errors','native-dom-uncaught-errors','native-error-probe-failure']);
  assert.equal(result.browserDiagnostics.length,0);
  const nativeOnly={pageErrors:[],nativeErrors:[{kind:'unhandledrejection',message:'Not forwarded by the browser adapter'}],navigationLedger:[],diagnosticProbeFailures:[],failures:[]};
  finalizeBrowserErrors(nativeOnly,options);
  assert.equal(nativeOnly.failures[0].id,'native-dom-uncaught-errors');
});
