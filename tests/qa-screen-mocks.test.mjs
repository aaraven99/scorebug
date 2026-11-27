import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

// Run the same init-script function that Playwright installs in each page.
// The browser probe also covers real trusted navigation events in WebKit.
const source=await readFile(new URL('./qa/flows.mjs',import.meta.url),'utf8');
const initScript=source.slice(source.indexOf('function installScreenMocks('),source.indexOf('\nexport async function runFlows'));

function screen(){
  class Target{
    listeners=new Map();
    addEventListener(type,listener){const list=this.listeners.get(type)||[];list.push(listener);this.listeners.set(type,list);}
    dispatchEvent(event){for(const listener of this.listeners.get(event.type)||[])listener(event);return true;}
    emit(type,isTrusted=false){this.dispatchEvent({type,isTrusted});}
  }
  class Document extends Target{
    nativeVisibility='visible';
    get visibilityState(){return this.nativeVisibility;}
    get hidden(){return this.nativeVisibility==='hidden';}
  }
  const document=new Document(),window=new Target();
  runInNewContext(`${initScript};installScreenMocks();`,{document,window,navigator:{},Element:class{},Event:class{constructor(type){this.type=type;this.isTrusted=false;}},EventTarget:Target,DOMException});
  return {document,window,screen:window.__qaScreen};
}

test('screen mocks follow native visibility unless an explicit synthetic change is active',()=>{
  const {document,screen:controls}=screen();
  assert.equal(document.visibilityState,'visible');
  document.nativeVisibility='hidden';
  assert.equal(document.visibilityState,'hidden');
  assert.equal(document.hidden,true);
  controls.setVisibility('visible');
  assert.equal(document.visibilityState,'visible');
  document.emit('visibilitychange',true);
  assert.equal(document.visibilityState,'hidden','A trusted browser event supersedes the synthetic override');
  document.nativeVisibility='visible';
  controls.setVisibility('hidden');
  document.emit('visibilitychange');
  assert.equal(document.hidden,true,'Synthetic events preserve the requested hidden state');
  document.emit('visibilitychange',true);
  assert.equal(document.hidden,false);
});

test('trusted pagehide stays hidden through the delayed WebKit visibility event until pageshow',()=>{
  const {document,window,screen:controls}=screen();
  controls.setVisibility('visible');
  window.emit('pagehide',true);
  assert.equal(document.nativeVisibility,'visible','The native getter can lag the pagehide event');
  assert.equal(document.visibilityState,'hidden');
  assert.equal(document.hidden,true);
  document.emit('visibilitychange',true);
  controls.setVisibility('visible');
  assert.equal(document.hidden,true,'An outgoing document cannot restart because of an old or new test override');
  assert.equal(controls.state().visibility,'hidden');
  window.emit('pageshow',true);
  assert.equal(document.hidden,false);
  controls.setVisibility('hidden');
  window.emit('pagehide');window.emit('pageshow');
  assert.equal(document.hidden,true,'Synthetic lifecycle tests keep their explicit visibility state');
});
