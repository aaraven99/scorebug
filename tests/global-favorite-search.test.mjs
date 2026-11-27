import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LEAGUES } from '../public/sports.js';
import { createFavoriteDirectoryStore, favoriteFromTeam, favoriteTeamKey, searchFavoriteTeams } from '../public/favorite-search.js';

const directories = new Map(LEAGUES.map(league => [league.id, JSON.parse(readFileSync(new URL(`./fixtures/directory-audit/${league.id}.json`, import.meta.url)))]));
const reply = (body, status = 200, headers = {}) => Response.json(body, { status, headers });
const leagueFor = url => new URL(url, 'https://scorebug.example').searchParams.get('league');
const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; }); return { promise, resolve, reject }; };
const memoryStorage = () => { const values = new Map(); return { values, getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) }; };

test('the entire verified corpus has valid league-scoped IDs, names, colors and supplied logo URLs', () => {
  const identities = new Set();
  for (const [leagueId, directory] of directories) for (const team of directory.teams) {
    assert.equal(team.leagueId, leagueId); assert.ok(team.name.trim()); assert.notEqual(team.name, 'TBD TBD');
    assert.equal(favoriteFromTeam(team)?.teamId, team.id);
    assert.equal(identities.has(favoriteTeamKey(team)), false); identities.add(favoriteTeamKey(team));
    if (team.color) assert.match(team.color, /^#[\da-f]{6}$/i);
    if (team.alternateColor) assert.match(team.alternateColor, /^#[\da-f]{6}$/i);
    if (team.logo) { const url = new URL(team.logo); assert.equal(url.protocol, 'https:'); assert.equal(url.hostname, 'a.espncdn.com'); assert.equal(url.port + url.username + url.password, ''); }
  }
  assert.equal(identities.size, 10340);
});

test('all 30 verified directories load with at most three concurrent requests and no keystroke fetches', async () => {
  const calls = []; let active = 0, maximum = 0;
  const store = createFavoriteDirectoryStore({ storage: null, fetcher: url => {
    const pending = deferred(), id = leagueFor(url); active++; maximum = Math.max(maximum, active);
    calls.push({ id, release: () => { active--; pending.resolve(reply(directories.get(id))); } }); return pending.promise;
  } });
  const loading = store.loadAll({ priorityId: 'atp' });
  assert.equal(calls.length, 3); assert.equal(calls[0].id, 'atp');
  assert.equal(store.progress().loading, 3); assert.equal(store.progress().queued, 27);
  for (let index = 1; index <= 'ChicagoBears'.length; index++) searchFavoriteTeams(store.teams(), 'ChicagoBears'.slice(0, index));
  assert.equal(calls.length, 3);
  for (let index = 0; index < LEAGUES.length; index++) { assert.ok(calls[index]); calls[index].release(); await turn(); }
  await loading;
  assert.equal(maximum, 3); assert.equal(new Set(calls.map(call => call.id)).size, 30);
  assert.equal(store.progress().loaded, 30); assert.equal(store.progress().missing, 0); assert.equal(store.progress().failed, 0);
  assert.equal(store.progress().partial, 2); assert.equal(store.teams().length, 10340);
  await store.loadAll(); assert.equal(calls.length, 30); store.stop();
});

test('every supplied team and competitor is searchable globally and within its own league across repeated normalized queries', async () => {
  let calls = 0;
  const store = createFavoriteDirectoryStore({ storage: null, fetcher: async url => { calls++; return reply(directories.get(leagueFor(url))); } });
  await store.loadAll(); const teams = store.teams(); let checks = 0;
  for (const team of teams) {
    const key = favoriteTeamKey(team);
    for (const query of [team.name, team.name.toUpperCase().replace(/\s+/g, ''), `  ${team.name.toLowerCase()}  `]) {
      const global = searchFavoriteTeams(teams, query, { preferredLeagueId: 'f1', limit: 100 });
      assert.ok(global.teams.some(result => favoriteTeamKey(result) === key), `${key}: ${query}`); checks++;
    }
    const selected = searchFavoriteTeams(teams, team.name, { leagueId: team.leagueId, limit: 100 });
    assert.ok(selected.teams.some(result => favoriteTeamKey(result) === key));
    assert.equal(favoriteFromTeam(team)?.teamId, team.id); checks++;
  }
  assert.equal(checks, 41360); assert.equal(calls, 30); store.stop();
});

test('the complete compact cache fits the measured budget and restores all names without a network request', async () => {
  const storage = memoryStorage(), now = Date.parse('2026-11-27T20:00:00Z');
  const first = createFavoriteDirectoryStore({ storage, now: () => now, fetcher: async url => reply(directories.get(leagueFor(url))) });
  await first.loadAll(); first.stop();
  const encoded = [...storage.values.values()][0]; assert.ok(encoded); assert.ok(encoded.length < 3000000, `Cache characters: ${encoded.length}`);
  const cache = JSON.parse(encoded); assert.equal(cache.leagues.length, 30);
  assert.equal(cache.leagues.reduce((sum, league) => sum + league.teams.length, 0), 10340);
  const restored = createFavoriteDirectoryStore({ storage, now: () => now + 1000, fetcher: async () => { throw new Error('A fresh cached directory must not request the network.'); } });
  assert.equal(restored.progress().loaded, 30); assert.equal(restored.teams().length, 10340);
  assert.equal(restored.get('pga').teams.length, 4426); assert.equal(restored.get('lpga').teams.length, 3111);
  await restored.loadAll(); assert.equal(restored.progress().failed, 0);
  assert.ok(searchFavoriteTeams(restored.teams(), 'Scottie Scheffler').teams.some(team => team.leagueId === 'pga'));
  assert.ok(searchFavoriteTeams(restored.teams(), 'Nelly Korda').teams.some(team => team.leagueId === 'lpga'));
  restored.stop();
});

test('stopping aborts active work, cancels queued work, settles promises and resumes only missing directories', async () => {
  const calls = [];
  const store = createFavoriteDirectoryStore({ storage: null, fetcher: (url, { signal }) => {
    const pending = deferred(); calls.push({ id: leagueFor(url), signal, ...pending });
    signal.addEventListener('abort', () => pending.reject(signal.reason), { once: true }); return pending.promise;
  } });
  const first = store.loadAll(); calls[0].resolve(reply(directories.get(calls[0].id))); await turn();
  assert.equal(store.progress().loaded, 1); assert.equal(calls.length, 4);
  store.stop(); await first; assert.ok(calls.slice(1).every(call => call.signal.aborted));
  assert.equal(store.progress().queued, 0); assert.equal(store.progress().loading, 0); assert.equal(store.progress().failed, 0);
  const previous = calls.length, second = store.loadAll();
  for (let index = previous; index < previous + 29; index++) { calls[index].resolve(reply(directories.get(calls[index].id))); await turn(); }
  await second; assert.equal(store.progress().loaded, 30); assert.equal(calls.filter(call => call.id === 'nfl').length, 1); store.stop();
});

test('failed leagues remain explicitly missing and retry does not re-fetch healthy leagues', async () => {
  const calls = []; let failing = true;
  const store = createFavoriteDirectoryStore({ storage: null, fetcher: async url => {
    const id = leagueFor(url); calls.push(id); return id === 'epl' && failing ? reply({}, 503) : reply(directories.get(id));
  } });
  await store.loadAll(); assert.equal(store.progress().loaded, 29); assert.equal(store.progress().missing, 1); assert.equal(store.progress().failed, 1);
  assert.ok(searchFavoriteTeams(store.teams(), 'ChicagoBears').teams.length);
  failing = false; await store.loadAll({ retryOnly: true });
  assert.equal(calls.length, 31); assert.equal(calls.at(-1), 'epl'); assert.equal(store.progress().missing, 0); store.stop();
});

test('Retry-After cannot be bypassed by repeated explicit retries', async () => {
  let now = 1000, calls = 0;
  const store = createFavoriteDirectoryStore({ storage: null, now: () => now, fetcher: async () => {
    calls++; return calls === 1 ? reply({ retryAfterMs: 6000 }, 429, { 'Retry-After': '5' }) : reply(directories.get('epl'));
  } });
  await store.load('epl'); assert.equal(store.get('epl').retryAt, 7000);
  await store.load('epl', { force: true }); now = 6999; await store.load('epl', { force: true }); assert.equal(calls, 1);
  now = 7000; await store.load('epl', { force: true }); assert.equal(calls, 2); assert.equal(store.get('epl').error, null); store.stop();
});

test('a failed broader catalog refresh retains previously cached golfers and marks its limited coverage', async () => {
  let now = 0, failing = false;
  const store = createFavoriteDirectoryStore({ storage: null, now: () => now, cacheTtlMs: 10, fetcher: async () => reply(failing
    ? { leagueId: 'pga', teams: [], coverage: { scope: 'event', complete: false, retryable: true, message: 'Broader directory unavailable.' } }
    : directories.get('pga')) });
  await store.load('pga'); assert.equal(store.get('pga').teams.length, 4426);
  now = 20; failing = true; await store.load('pga');
  assert.equal(store.get('pga').teams.length, 4426); assert.equal(store.get('pga').stale, true); assert.equal(store.get('pga').coverage.retryable, true);
  assert.equal(store.progress(['pga']).retryable, 1); assert.match(store.get('pga').coverage.message, /cached/);
  assert.ok(searchFavoriteTeams(store.teams(), 'Scottie Scheffler').teams.length); store.stop();
});

test('storage denial, malformed caches and wrong-league persisted records do not prevent loading', async () => {
  for (const storage of [
    { getItem() { throw Error('Blocked'); }, setItem() { throw Error('Quota'); } },
    { getItem() { return '{broken'; }, setItem() {} },
    { getItem() { return JSON.stringify({ version: 1, leagues: [{ leagueId: 'nba', loadedAt: Date.now(), teams: [{ id: '3', leagueId: 'nfl', name: 'Chicago Bears' }] }] }); }, setItem() {} },
  ]) {
    const store = createFavoriteDirectoryStore({ storage, fetcher: async () => reply(directories.get('nba')) });
    assert.equal(store.get('nba').loadedAt, null); await store.load('nba'); assert.equal(store.get('nba').teams.length, 30); store.stop();
  }
});

test('old cached metadata remains searchable during an in-flight refresh without hiding duplicate school identities', async () => {
  const storage = memoryStorage(); let now = 1000;
  const first = createFavoriteDirectoryStore({ storage, now: () => now, fetcher: async url => reply(directories.get(leagueFor(url))) });
  await Promise.all(['cfb', 'cbb', 'wcbb'].map(id => first.load(id))); first.stop(); now += 900001;
  const pending = deferred(), restored = createFavoriteDirectoryStore({ storage, now: () => now, fetcher: () => pending.promise });
  const refresh = restored.load('cfb'); const matches = searchFavoriteTeams(restored.teams(), 'Michigan Wolverines', { preferredLeagueId: 'cbb' });
  assert.equal(matches.teams[0].leagueId, 'cbb'); assert.equal(matches.enterTeam, null);
  assert.ok(['cfb', 'cbb', 'wcbb'].every(id => matches.teams.some(team => team.id === `${id}:130`)));
  pending.resolve(reply(directories.get('cfb'))); await refresh; restored.stop();
});
