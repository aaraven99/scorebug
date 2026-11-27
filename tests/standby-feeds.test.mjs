import test from 'node:test';
import assert from 'node:assert/strict';
import { createStandbyFeedPool } from '../public/standby-feeds.js';

function setup() {
  const created=[],updates=[];
  const pool=createStandbyFeedPool({createPoller:options=>{const poller={options,data:null,starts:0,stops:0,refreshes:0,start(){this.starts++;},stop(){this.stops++;},refresh(){this.refreshes++;}};created.push(poller);return poller;},onUpdate:(key,state)=>updates.push({key,state})});
  return {pool,created,updates};
}
const slot=(leagueId,gameId=null,date=null)=>({leagueId,gameId,date});

test('four independent games in one league use a single two-second stream', () => {
  const {pool,created,updates}=setup();const slots=[1,2,3,4].map(id=>slot('nba',`nba:${id}`));pool.setSlots(slots);
  assert.equal(pool.size,1);assert.equal(created.length,1);assert.equal(created[0].options.interval,2000);assert.equal(created[0].starts,0);
  pool.setActive(true);assert.equal(created[0].starts,1);
  const snapshot={data:{games:[{id:'nba:1'},{id:'nba:2'}],fetchedAt:'2026-11-27T12:00:00Z'},error:null,loading:false};created[0].options.onUpdate(snapshot);
  assert.equal(pool.snapshot(slots[0]),snapshot);assert.equal(pool.snapshot(slots[3]),snapshot);assert.equal(updates.length,1);
  pool.refresh();assert.equal(created[0].refreshes,1);pool.destroy();
});

test('date and league changes replace only unused streams and ignore late responses', () => {
  const {pool,created,updates}=setup();pool.setSlots([slot('nba'),slot('nba',null,'20261126'),slot('nfl')]);pool.setActive(true);assert.equal(pool.size,3);
  pool.setSlots([slot('nba'),slot('mlb')]);assert.equal(pool.size,2);assert.equal(created[0].stops,0);assert.equal(created[1].stops,1);assert.equal(created[2].stops,1);assert.equal(created[3].starts,1);
  created[1].options.onUpdate({data:{games:[{id:'old'}]}});assert.equal(updates.length,0);
  pool.refresh(slot('mlb'));assert.equal(created[0].refreshes,0);assert.equal(created[3].refreshes,1);pool.destroy();
});

test('hidden/pagehide suspension stops each stream, retains data, and resumes exactly once', () => {
  const {pool,created,updates}=setup();pool.setSlots([slot('nba'),slot('nfl')]);pool.setActive(true);
  const latest={data:{games:[{id:'nba:1'}]},error:null,loading:false};created[0].options.onUpdate(latest);pool.setActive(false);pool.setActive(false);
  assert.equal(created[0].stops,1);assert.equal(created[1].stops,1);pool.refresh();assert.equal(created[0].refreshes,0);
  created[0].options.onUpdate({data:{games:[{id:'late'}]}});assert.equal(updates.length,1);assert.equal(pool.snapshot(slot('nba')),latest);
  pool.setActive(true);pool.setActive(true);assert.equal(created[0].starts,2);assert.equal(created[1].starts,2);
  pool.destroy();pool.setSlots([slot('mlb')]);pool.setActive(true);assert.equal(pool.size,0);assert.equal(created.length,2);
});
