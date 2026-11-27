import test from 'node:test';
import assert from 'node:assert/strict';
import { createScoreAnimations } from '../public/score-animation.js';

// Exercise the actual notice lifecycle against a controllable CSS timeline.
// Real Chromium/WebKit animationstart/end events are checked in browser QA.
function harness() {
  let now=0,sequence=0,reduced=false;const timers=new Map();
  class Element {
    constructor(document){this.ownerDocument=document;this.children=[];this.dataset={};this.hidden=false;this.parentElement=null;this.connected=true;this.listeners=new Map();this.properties=new Map();this.attributes=new Map();this.classes=new Set();this.animations=[];this.textContent='';this.style={setProperty:(key,value)=>this.properties.set(key,value),removeProperty:key=>this.properties.delete(key)};this.classList={add:(...values)=>values.forEach(value=>this.classes.add(value)),remove:(...values)=>values.forEach(value=>this.classes.delete(value)),contains:value=>this.classes.has(value)};}
    get isConnected(){return this.connected&&(!this.parentElement||this.parentElement.isConnected);}
    set className(value){this.classes=new Set(value.split(/\s+/));}
    get className(){return [...this.classes].join(' ');}
    setAttribute(key,value){this.attributes.set(key,String(value));}
    append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);}}
    replaceChildren(...nodes){for(const child of this.children)child.parentElement=null;this.children=[];this.append(...nodes);}
    querySelector(){return null;}
    getAnimations(){return this.animations;}
    addEventListener(type,callback){const set=this.listeners.get(type)||new Set();set.add(callback);this.listeners.set(type,set);}
    removeEventListener(type,callback){this.listeners.get(type)?.delete(callback);}
    dispatch(type,properties={}){for(const callback of [...(this.listeners.get(type)||[])])callback({target:this,type,...properties});}
  }
  const window={setTimeout:(callback,delay)=>{const id=++sequence;timers.set(id,{callback,at:now+delay});return id;},clearTimeout:id=>timers.delete(id),matchMedia:()=>({matches:reduced}),getComputedStyle:()=>({clipPath:'none',opacity:'1',transform:'none'})};
  const document={defaultView:window,hidden:false,createElement(){return new Element(document);},createElementNS(){return new Element(document);}},host=new Element(document);
  const controller=createScoreAnimations(host),game={id:'401700000',leagueId:'nfl',sport:'football'},event={kind:'touchdown',title:'TOUCHDOWN'};
  controller.demo(event,game);const overlay=host.children[0];
  const advance=duration=>{const until=now+duration;for(;;){const next=[...timers].filter(([,timer])=>timer.at<=until).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;const[id,timer]=next;now=timer.at;timers.delete(id);timer.callback();}now=until;};
  return{controller,overlay,host,document,timers,game,event,advance,set reduced(value){reduced=value;}};
}

test('a delayed CSS exit survives the old watchdog deadline and ends through its native event',()=>{
  const h=harness(),animation={animationName:'score-exit',playState:'running',pending:false,currentTime:233,effect:{getComputedTiming:()=>({endTime:260})}};
  h.overlay.animations=[animation];h.controller.clearDemo();h.advance(340);
  assert.equal(h.overlay.hidden,false,'The old340ms watchdog must not cancel a still-running233ms exit');assert.equal(h.overlay.dataset.state,'exiting');assert.equal(h.timers.size,1);
  animation.currentTime=260;animation.playState='finished';h.overlay.dispatch('animationend',{animationName:'score-exit'});
  assert.equal(h.overlay.hidden,true);assert.equal(h.timers.size,0);assert.equal(h.overlay.listeners.get('animationend').size,0);
});

test('pending timelines are preserved but missing, detached and reduced-motion exits clean up',()=>{
  const pending=harness();pending.overlay.animations=[{animationName:'score-exit',playState:'running',pending:true,currentTime:null}];pending.controller.clearDemo();pending.advance(680);assert.equal(pending.overlay.hidden,false);pending.host.connected=false;pending.advance(340);assert.equal(pending.overlay.hidden,true);assert.equal(pending.timers.size,0);
  const absent=harness();absent.controller.clearDemo();absent.advance(340);assert.equal(absent.overlay.hidden,true);assert.equal(absent.timers.size,0);
  const reduced=harness();reduced.reduced=true;reduced.controller.clearDemo();assert.equal(reduced.overlay.hidden,true);assert.equal(reduced.timers.size,0);
});

test('finished timelines get an event turn and stale watchdogs cannot hide the next notice',()=>{
  const h=harness(),finished={animationName:'score-exit',playState:'finished',pending:false,currentTime:260,effect:{getComputedTiming:()=>({endTime:260})}};
  h.overlay.animations=[finished];h.controller.demo({...h.event,kind:'field-goal',title:'FIELD GOAL'},h.game);h.advance(340);assert.equal(h.overlay.hidden,false);
  h.advance(80);assert.equal(h.overlay.hidden,true);h.advance(70);assert.equal(h.overlay.dataset.kind,'field-goal');assert.equal(h.overlay.hidden,false);assert.equal(h.timers.size,1,'Only the new notice hold timer remains');
  h.advance(100);assert.equal(h.overlay.dataset.kind,'field-goal');h.controller.clear();h.overlay.animations=[];h.advance(340);assert.equal(h.overlay.hidden,true);assert.equal(h.timers.size,0);
});
