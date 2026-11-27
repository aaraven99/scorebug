import test from 'node:test';
import assert from 'node:assert/strict';
import { createStandbyWakeLock } from '../public/standby-screen.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
class Sentinel extends EventTarget { released=false;releases=0;release(){this.releases++;this.released=true;this.dispatchEvent(new Event('release'));return Promise.resolve();} }
function setup(request) {const updates=[],documentRef={visibilityState:'visible'};const control=createStandbyWakeLock({navigatorRef:{wakeLock:{request}},documentRef,onChange:value=>updates.push(value)});return{control,documentRef,updates};}

test('wake lock begins off, requests only after enabling, and releases on explicit off', async()=>{
  let requests=0;const sentinel=new Sentinel();const{control}=setup(type=>{requests++;assert.equal(type,'screen');return Promise.resolve(sentinel);});
  await control.resume();assert.equal(requests,0);assert.equal(control.state().status,'off');
  await control.enable();assert.equal(requests,1);assert.equal(control.state().active,true);await control.enable();assert.equal(requests,1);
  control.disable();assert.equal(sentinel.releases,1);assert.equal(control.state().active,false);assert.equal(control.state().desired,false);control.destroy();
});

test('hidden pages release and visible pages reacquire only an explicitly requested lock', async()=>{
  const sentinels=[];const{control,documentRef}=setup(()=>{const lock=new Sentinel();sentinels.push(lock);return Promise.resolve(lock);});
  await control.enable();documentRef.visibilityState='hidden';control.pause();assert.equal(sentinels[0].released,true);assert.equal(control.state().status,'paused');
  await control.resume();assert.equal(sentinels.length,1);documentRef.visibilityState='visible';await control.resume();assert.equal(sentinels.length,2);assert.equal(control.state().active,true);
  control.disable();control.pause();await control.resume();assert.equal(sentinels.length,2);control.destroy();
});

test('an OS release is shown honestly and does not create an automatic retry loop', async()=>{
  let requests=0;const{control}=setup(()=>{requests++;return Promise.resolve(new Sentinel());});await control.enable();
  // A release event is represented by the sentinel, just as the browser does.
  control.destroy();assert.equal(requests,1);
  const sentinel=new Sentinel();const second=setup(()=>{requests++;return Promise.resolve(sentinel);}).control;await second.enable();sentinel.release();
  assert.equal(second.state().active,false);assert.equal(second.state().status,'released');await Promise.resolve();assert.equal(requests,2);second.destroy();
});

test('disabling or leaving during an in-flight request releases its late lock', async()=>{
  const pending=deferred(),lock=new Sentinel();const{control}=setup(()=>pending.promise);const request=control.enable();assert.equal(control.state().status,'requesting');control.disable();pending.resolve(lock);await request;
  assert.equal(lock.released,true);assert.equal(control.state().active,false);assert.equal(control.state().status,'off');control.destroy();
  const next=deferred(),other=new Sentinel();const left=setup(()=>next.promise).control;const work=left.enable();left.pause();next.resolve(other);await work;assert.equal(other.released,true);assert.equal(left.state().status,'paused');left.destroy();
});

test('a resumed request wins over an old unresolved request without releasing the new lock', async()=>{
  const first=deferred(),second=deferred();let calls=0;const{control}=setup(()=>++calls===1?first.promise:second.promise);
  const old=control.enable();control.pause();const current=control.resume();const newLock=new Sentinel();second.resolve(newLock);await current;
  const oldLock=new Sentinel();first.resolve(oldLock);await old;assert.equal(oldLock.released,true);assert.equal(newLock.released,false);assert.equal(control.state().active,true);control.destroy();
});

test('unsupported and denied requests remain off and can be retried without unhandled errors', async()=>{
  const unsupported=createStandbyWakeLock({navigatorRef:{},documentRef:{visibilityState:'visible'}});await unsupported.enable();assert.equal(unsupported.state().supported,false);assert.equal(unsupported.state().active,false);assert.equal(unsupported.state().status,'unsupported');unsupported.destroy();
  let denied=true;const{control}=setup(()=>denied?Promise.reject(Error('NotAllowedError')):Promise.resolve(new Sentinel()));await control.enable();assert.equal(control.state().status,'error');assert.equal(control.state().active,false);denied=false;await control.enable();assert.equal(control.state().active,true);control.destroy();
});
