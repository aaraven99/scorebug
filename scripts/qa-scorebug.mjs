#!/usr/bin/env node
import { chromium, webkit } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createScorebugServer } from '../server.mjs';
import { LEAGUES } from '../public/sports.js';
import { SCOREBUG_STYLES, defaultStyleForSport } from '../public/scorebug-styles.js';
import { fixtureForLeague, loadAuditedDirectories } from '../tests/qa/fixtures.mjs';

const args=process.argv.slice(2),option=(name,fallback)=>{const index=args.indexOf(`--${name}`);return index<0?fallback:args[index+1];};
const suite=option('suite','all'),engine=option('browser','chromium'),passes=Number(option('passes','3'));
if(!['all','matrix','flows'].includes(suite)||!['chromium','webkit'].includes(engine)||!Number.isInteger(passes)||passes<1||passes>10)throw new Error('Use --suite all|matrix|flows --browser chromium|webkit --passes 1..10. Release gates require three passes.');
const projectRoot=fileURLToPath(new URL('../',import.meta.url)),outDir=resolve(option('output',`test-results/qa/${engine}`));
await mkdir(outDir,{recursive:true});await mkdir(`${outDir}/screenshots`,{recursive:true});
const started=Date.now(),report={schemaVersion:1,startedAt:new Date(started).toISOString(),suite,browser:engine,passes,sourceCommit:null,counts:{cases:0,layoutTrials:0,assertions:0,failures:0,screenshots:0,flowChecks:0},matrix:null,flows:null,screenshots:[],errors:[],limitations:['Automated geometry checks are not a manual pixel review of every render.','Deterministic fixture results do not establish the freshness, completeness, or uptime of a live data provider.','Browser tests do not substitute for the separate Windows and macOS native/packaged application gates.','Narrow portrait Standby may scroll vertically to keep multiple cards readable; quiet landscape is checked for all-card viewport containment.']};
try{report.sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:projectRoot,encoding:'utf8'}).trim();report.sourceTree=execFileSync('git',['rev-parse','HEAD^{tree}'],{cwd:projectRoot,encoding:'utf8'}).trim();report.dirtyWorkingTree=Boolean(execFileSync('git',['status','--porcelain'],{cwd:projectRoot,encoding:'utf8'}).trim());}catch{}
const directories=await loadAuditedDirectories();report.directoryFixtures=Object.fromEntries(Object.entries(directories).map(([id,value])=>[id,{teams:value.teams.length,coverage:value.coverage??null}]));
const server=createScorebugServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const baseURL=`http://127.0.0.1:${server.address().port}`;
let browser;
const matrixHTML='<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/scorebug.css"><style>body{margin:16px;background:#e7e9e4;color:#17201b;font:14px Arial,sans-serif}.qa-case{margin:8px 0}.qa-sheet{display:grid;grid-template-columns:repeat(2,500px);gap:18px;width:1020px;padding:12px}.qa-sheet h1{grid-column:1/-1;font-size:24px;margin:4px 0}.qa-sheet article{padding:8px;background:#fff;border:1px solid #c5ccc5;border-radius:8px}.qa-sheet p{margin:0 0 8px;font-weight:bold;font-size:12px}.qa-sheet-vertical{grid-template-columns:repeat(6,160px);width:1060px;gap:12px}</style></head><body><main id="qa-root"></main><script type="module" src="/__qa__/matrix-browser.mjs"></script></body></html>';
async function matrixContext(){
  const context=await browser.newContext({viewport:{width:1280,height:1000},deviceScaleFactor:1});
  await context.route('**/__qa__/**',async route=>{const path=new URL(route.request().url()).pathname;if(path.endsWith('matrix-browser.mjs'))return route.fulfill({contentType:'text/javascript',body:await readFile(new URL('../tests/qa/matrix-browser.mjs',import.meta.url),'utf8')});return route.fulfill({contentType:'text/html',body:matrixHTML});});
  return context;
}
async function runMatrix(){
  const context=await matrixContext(),page=await context.newPage(),pageErrors=[];
  page.on('pageerror',error=>pageErrors.push(error.message));
  await page.goto(`${baseURL}/__qa__/matrix.html`);await page.waitForFunction(()=>Boolean(window.ScorebugQA));
  const allCases=[];
  for(let pass=1;pass<=passes;pass++)for(const league of LEAGUES)for(const style of SCOREBUG_STYLES)for(const orientation of ['horizontal','vertical'])allCases.push({id:`p${pass}-${league.id}-${style.id}-${orientation}`,pass,game:fixtureForLeague(league.id,{directories}),styleId:style.id,orientation,racingRows:6});
  const diagnosticLimit=Number(option('case-limit','0'));if(diagnosticLimit>0){allCases.splice(diagnosticLimit);report.limitations.push(`Diagnostic run limited to ${diagnosticLimit} matrix cases; not a release-gate run.`);report.diagnosticOnly=true;}
  const results=[],batches=[],matrixStart=Date.now();let lastProgress=Date.now();
  for(let index=0;index<allCases.length;index+=30){
    const response=await page.evaluate(cases=>window.ScorebugQA.runBatch(cases),allCases.slice(index,index+30));results.push(...response.results);batches.push({elapsedMs:response.elapsedMs,domNodes:response.domNodes,heapBytes:response.heapBytes});
    if(Date.now()-lastProgress>20000||index+30>=allCases.length){console.log(`Matrix ${Math.min(index+30,allCases.length)}/${allCases.length} cases; ${results.reduce((n,r)=>n+r.profiles.reduce((n,p)=>n+p.failures.length,0),0)} failed assertions.`);lastProgress=Date.now();}
  }
  const failures=results.flatMap(result=>result.profiles.flatMap(profile=>profile.failures.map(failure=>({caseId:result.id,width:profile.width,...failure}))));
  report.matrix={leagues:LEAGUES.length,styles:SCOREBUG_STYLES.length,orientations:2,repeatedPasses:passes,profilesPerCase:3,widths:{horizontal:[600,420,300],vertical:[160,144,112]},caseCount:results.length,layoutTrials:results.reduce((n,r)=>n+r.profiles.length,0),assertions:results.reduce((n,r)=>n+r.profiles.reduce((n,p)=>n+p.assertions,0),0),failedCases:results.filter(r=>r.profiles.some(p=>p.failures.length)).length,failedAssertions:failures.length,elapsedMs:Date.now()-matrixStart,maxDOMNodes:Math.max(...batches.map(b=>b.domNodes)),maxObservedHeapBytes:Math.max(...batches.map(b=>b.heapBytes||0))||null,pageErrors,failures};
  await writeFile(`${outDir}/matrix-cases.json`,JSON.stringify({cases:results,batches}));
  report.counts.cases+=results.length;report.counts.layoutTrials+=report.matrix.layoutTrials;report.counts.assertions+=report.matrix.assertions;report.counts.failures+=failures.length+pageErrors.length;
  const sheet=async(name,items,vertical,title)=>{const sheetResult=await page.evaluate(async data=>window.ScorebugQA.contactSheet(data.items,data.options),{items,options:{vertical,title}});await page.screenshot({path:`${outDir}/screenshots/${name}.png`,fullPage:true});report.screenshots.push({file:`screenshots/${name}.png`,kind:'contact-sheet',renderedCases:items.length,manuallyReviewed:false,assets:sheetResult.assets});const failed=sheetResult.assets.filter(asset=>!asset.loaded);if(failed.length){report.matrix.assetFailures??=[];report.matrix.assetFailures.push(...failed);const broken=failed.filter(asset=>asset.src.startsWith('/')||asset.state==='error'&&!(asset.hidden&&asset.fallbackVisible&&asset.fallbackLabel));report.counts.failures+=broken.length;for(const asset of broken)report.matrix.failures.push({caseId:name,code:'image-load-or-fallback',detail:asset});}};
  for(const vertical of [false,true]){
    const take=vertical?18:16;
    for(let index=0;index<SCOREBUG_STYLES.length;index+=take){const items=SCOREBUG_STYLES.slice(index,index+take).map(style=>{const league=LEAGUES.find(league=>league.sport===style.sport)||LEAGUES[0];return{game:fixtureForLeague(league.id,{directories}),styleId:style.id};});await sheet(`styles-${vertical?'side':'normal'}-${index/take+1}`,items,vertical,`${vertical?'Side':'Normal'} styles ${index+1}–${Math.min(index+take,SCOREBUG_STYLES.length)}`);}
  }
  for(let index=0;index<LEAGUES.length;index+=15){const items=LEAGUES.slice(index,index+15).map(league=>({game:fixtureForLeague(league.id,{directories}),styleId:defaultStyleForSport(league.sport)}));await sheet(`leagues-${index/15+1}`,items,false,`League fixtures ${index+1}–${Math.min(index+15,LEAGUES.length)}`);}
  if(report.matrix.assetFailures?.some(asset=>asset.src.startsWith('https:')))report.limitations.push('Some external provider images did not load during contact-sheet capture; their URLs, states, and readable replacement labels are listed under matrix.assetFailures. A failed image without a visible text fallback fails the run, as does any bundled-image failure.');
  await context.close();
}
function escape(value){return String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');}
async function finish(){
  report.finishedAt=new Date().toISOString();report.elapsedMs=Date.now()-started;report.counts.screenshots=report.screenshots.length;report.passed=report.counts.failures===0&&report.errors.length===0;
  await writeFile(`${outDir}/report.json`,JSON.stringify(report,null,2));
  const rows=Object.entries(report.counts).map(([key,value])=>`<tr><th>${escape(key)}</th><td>${value.toLocaleString()}</td></tr>`).join('');
  const failures=[...(report.matrix?.failures||[]),...(report.flows?.failures||[])];
  await writeFile(`${outDir}/report.html`,`<!doctype html><meta charset="utf-8"><title>Scorebug browser QA</title><style>body{font:16px system-ui;margin:32px;max-width:1100px;color:#18221d}table{border-collapse:collapse}td,th{padding:8px 18px;border:1px solid #ccd1ce;text-align:left}pre{white-space:pre-wrap;background:#f0f2f0;padding:16px}li{margin:8px 0}img{max-width:100%}</style><h1>${report.passed?'Passed':'Failed'} · ${engine} · ${passes} repeated passes</h1><p>${escape(report.sourceCommit)} · ${escape(report.finishedAt)} · ${(report.elapsedMs/1000).toFixed(1)} seconds</p><table>${rows}</table><h2>What this run checked</h2><p>A case is one league/style/orientation/pass combination. Every matrix case is laid out at three widths. Assertions, interaction checks, and screenshots are counted separately.</p><h2>Limits</h2><ul>${report.limitations.map(value=>`<li>${escape(value)}</li>`).join('')}</ul><h2>Failures</h2><pre>${escape(JSON.stringify([...report.errors,...failures],null,2))}</pre><h2>Screenshots</h2><p>Generated contact sheets are evidence for visual review, not proof that a human inspected every pixel. The JSON records review status.</p><ul>${report.screenshots.map(item=>`<li><a href="${escape(item.file)}">${escape(item.file)}</a> · ${item.renderedCases??'UI'} render(s) · review: ${item.manuallyReviewed?'recorded':'not recorded'}</li>`).join('')}</ul><p><a href="report.json">Complete report JSON</a> · <a href="matrix-cases.json">Every matrix case and profile</a></p>`);
  console.log(`${report.passed?'PASS':'FAIL'}: ${report.counts.cases} cases, ${report.counts.layoutTrials} layout trials, ${report.counts.assertions} assertions, ${report.counts.flowChecks} flow checks, ${report.counts.failures} failures. Report: ${outDir}/report.html`);
}
try{
  const executablePath=engine==='chromium'?process.env.SCOREBUG_QA_CHROMIUM_EXECUTABLE:undefined;
  browser=await(engine==='chromium'?chromium:webkit).launch({headless:true,...(executablePath?{executablePath,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-zygote']}:{})});
  report.browserVersion=browser.version();report.executableOverride=Boolean(executablePath);
  if(suite==='all'||suite==='matrix')await runMatrix();
  if(suite==='all'||suite==='flows'){const {runFlows}=await import('../tests/qa/flows.mjs');report.flows=await runFlows({browser,engine,baseURL,passes,outDir,directories,screenshots:report.screenshots});report.counts.flowChecks=report.flows.checks;report.counts.assertions+=report.flows.assertions;report.counts.failures+=report.flows.failures.length;}
}catch(error){report.errors.push({message:error.message,stack:error.stack});process.exitCode=1;}
finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await finish();if(!report.passed)process.exitCode=1;}
