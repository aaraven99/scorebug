import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { request } from 'node:http';

// Import the default API singleton with a tripwire. A server accidentally using
// that singleton must fail this test without ever sending a real feed request.
const unexpectedDefaultRequests = [];
const originalFetch = globalThis.fetch;
let modules;
try {
  globalThis.fetch = async (url) => {
    unexpectedDefaultRequests.push(String(url));
    throw new Error('The local server used the default Node transport.');
  };
  modules = await Promise.all([
    import('../server.mjs'), import('../lib/multisport.mjs'),
    import('../api/scoreboard.js'), import('../api/game.js'), import('../api/teams.js'),
    import('../lib/nfl.mjs'), import('../lib/details.mjs'),
  ]);
} finally {
  globalThis.fetch = originalFetch;
}
const [
  { createScorebugServer, contentSecurityPolicy }, { createMultisportService },
  { default: scoreboardHandler, createScoreboardHandler },
  { default: gameHandler, createGameHandler }, { default: teamsHandler, createTeamsHandler },
  { ScoreboardError }, { GameDetailsError },
] = modules;

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)));
const nfl = fixture('espn-live-v121');
const nba = fixture('multisport/nba-scoreboard');
const nbaTeams = { sports: [{ leagues: [{ teams: [{ team: {
  id: '4', displayName: 'Chicago Bulls', abbreviation: 'CHI', color: 'ce1141',
  logos: [{ href: 'https://a.espncdn.com/i/teamlogos/nba/500/chi.png' }],
} }] }] }] };
const jsonResponse = (value) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const stamp = Date.parse('2026-11-27T04:00:00Z');

async function startServer(t, fetchImpl) {
  const server = createScorebugServer({ fetchImpl });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  return (path, method = 'GET') => new Promise((resolve, reject) => {
    // The loopback client deliberately does not use the global fetch tripwire.
    const req = request({ hostname: '127.0.0.1', port: server.address().port, path, method, agent: false }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body, data: body ? JSON.parse(body) : null }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function invoke(handler, url, method = 'GET') {
  const result = { statusCode: 0, headers: {}, body: undefined };
  await handler({ url, method }, {
    setHeader(name, value) { result.headers[name.toLowerCase()] = value; },
    set statusCode(value) { result.statusCode = value; },
    get statusCode() { return result.statusCode; },
    end(body) { result.body = body; },
  });
  return result;
}

function assertJSONHeaders(headers) {
  assert.equal(headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(headers['cache-control'], 'no-store');
  assert.equal(headers['x-content-type-options'], 'nosniff');
}

test('all three loopback API routes use the explicitly supplied feed transport', async (t) => {
  const calls = [];
  const local = await startServer(t, async (input, options) => {
    const url = new URL(input);
    calls.push({ url, options });
    if (url.pathname.endsWith('/football/nfl/scoreboard')) return jsonResponse({ events: [nfl.scoreboardEvent] });
    if (url.pathname.endsWith('/football/nfl/summary')) return jsonResponse(nfl.summary);
    if (url.pathname.endsWith('/basketball/nba/teams')) return jsonResponse(nbaTeams);
    throw new Error(`Unexpected test route: ${url.pathname}`);
  });
  const [board, details, teams] = await Promise.all([
    local('/api/scoreboard?league=nfl&date=20261126'),
    local('/api/game?league=nfl&id=401873080'),
    local('/api/teams?league=nba'),
  ]);
  for (const result of [board, details, teams]) {
    assert.equal(result.status, 200, result.body);
    assertJSONHeaders(result.headers);
    assert.equal(result.headers['content-security-policy'], contentSecurityPolicy);
  }
  assert.equal(board.data.games[0].id, '401873080');
  assert.equal(details.data.gameId, '401873080');
  assert.ok(details.data.teamStats.length > 0);
  assert.equal(teams.data.teams[0].id, 'nba:4');
  assert.equal(teams.data.teams[0].name, 'Chicago Bulls');
  assert.equal(calls.length, 3);
  for (const { url, options } of calls) {
    assert.equal(url.hostname, 'site.api.espn.com');
    assert.equal(options.headers.Accept, 'application/json');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
  }
  assert.deepEqual(unexpectedDefaultRequests, []);
});

test('a failed primary feed and its successful fallback stay on the injected transport', async (t) => {
  const hosts = [];
  const local = await startServer(t, async (input) => {
    const url = new URL(input);
    hosts.push(url.hostname);
    if (url.hostname === 'site.api.espn.com') throw new TypeError('Fixture connection reset');
    assert.equal(url.hostname, 'site.web.api.espn.com');
    return jsonResponse(nba);
  });
  const result = await local('/api/scoreboard?league=nba&date=20261125');
  assert.equal(result.status, 200, result.body);
  assert.equal(result.data.feedStatus, 'backup');
  assert.equal(result.data.sourceId, 'espn-web');
  assert.equal(result.data.games[0].away.score, 104);
  assert.deepEqual(hosts, ['site.api.espn.com', 'site.web.api.espn.com']);
  assert.deepEqual(unexpectedDefaultRequests, []);
});

test('separate loopback servers own independent transports and team caches', async (t) => {
  const calls = [0, 0];
  const local = await Promise.all(['Chicago Bulls', 'Fixture Bulls'].map(async (name, index) => {
    const payload = structuredClone(nbaTeams);
    payload.sports[0].leagues[0].teams[0].team.displayName = name;
    return startServer(t, async () => { calls[index] += 1; return jsonResponse(payload); });
  }));
  for (let pass = 0; pass < 3; pass += 1) {
    const [first, second] = await Promise.all(local.map((read) => read('/api/teams?league=nba')));
    assert.equal(first.status, 200, first.body);
    assert.equal(second.status, 200, second.body);
    assert.equal(first.data.teams[0].name, 'Chicago Bulls');
    assert.equal(second.data.teams[0].name, 'Fixture Bulls');
  }
  assert.deepEqual(calls, [1, 1]);
  assert.deepEqual(unexpectedDefaultRequests, []);
});

test('multisport instances retain their own score cache, supplied clock, and cache duration', async () => {
  let now = stamp;
  const calls = [0, 0];
  const services = [104, 105].map((score, index) => {
    const payload = structuredClone(nba);
    payload.events[0].competitions[0].competitors.find((team) => team.homeAway === 'away').score = String(score);
    return createMultisportService({ now: () => now, cacheTtlMs: 2000, env: {},
      fetchImpl: async () => { calls[index] += 1; return jsonResponse(payload); } });
  });
  const read = () => Promise.all(services.map((service) => service.scoreboard({ leagueId: 'nba', date: '20261125' })));
  let results = await read();
  assert.deepEqual(results.map((result) => result.games[0].away.score), [104, 105]);
  assert.ok(results.every((result) => Date.parse(result.fetchedAt) === stamp));
  now += 1500;
  await read();
  assert.deepEqual(calls, [1, 1]);
  now += 501;
  results = await read();
  assert.deepEqual(calls, [2, 2]);
  assert.ok(results.every((result) => Date.parse(result.fetchedAt) === now));
  assert.deepEqual(unexpectedDefaultRequests, []);
});

test('OpenF1 token and timing requests use the same explicit transport as the sports feeds', async () => {
  let now = stamp;
  const calls = [];
  const timing = new Map([
    ['sessions', fixture('multisport/openf1-sessions')],
    ['drivers', fixture('multisport/openf1-drivers')],
    ['session_result', fixture('multisport/openf1-results')],
    ['race_control', fixture('multisport/openf1-control')],
    ['stints', fixture('multisport/openf1-stints')],
  ]);
  const service = createMultisportService({ now: () => now, env: { OPENF1_USERNAME: 'fixture-user', OPENF1_PASSWORD: 'fixture-password' },
    fetchImpl: async (input, options) => {
      const url = new URL(input);
      calls.push({ url, options });
      now += 500; // Advance beyond OpenF1's request spacing without network waits.
      if (url.hostname === 'site.api.espn.com') return jsonResponse(fixture('multisport/f1-scoreboard'));
      assert.equal(url.hostname, 'api.openf1.org');
      if (url.pathname === '/token') return jsonResponse({ access_token: 'fixture-token', expires_in: 3600 });
      const endpoint = url.pathname.slice('/v1/'.length);
      assert.ok(timing.has(endpoint), url.pathname);
      return jsonResponse(timing.get(endpoint));
    },
  });
  const details = await service.details({ leagueId: 'f1', gameId: 'f1:401839132', date: '20261108' });
  assert.equal(details.source, 'ESPN + OpenF1');
  assert.equal(details.race.openF1SessionKey, 11412);
  assert.equal(details.entries.length, 22);
  assert.equal(details.entries[0].name, 'Lando NORRIS');
  assert.equal(details.flag, 'chequered');
  assert.equal(details.timingStale, false);
  assert.equal(details.coverage.liveTimingConfigured, true);
  assert.ok(details.raceControl.length > 0);
  assert.ok(Date.parse(details.timingFetchedAt) >= stamp);
  const token = calls.find((call) => call.url.pathname === '/token');
  assert.equal(token.options.method, 'POST');
  assert.equal(token.options.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(token.options.body.get('username'), 'fixture-user');
  assert.equal(token.options.body.get('password'), 'fixture-password');
  assert.equal(token.options.headers.Authorization, undefined);
  const dataCalls = calls.filter((call) => call.url.hostname === 'api.openf1.org' && call.url.pathname !== '/token');
  assert.deepEqual(dataCalls.map((call) => call.url.pathname).sort(), [...timing.keys()].map((name) => `/v1/${name}`).sort());
  for (const { url, options } of calls) {
    assert.equal(options.cache, 'no-store');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    if (url.pathname.startsWith('/v1/')) assert.equal(options.headers.Authorization, 'Bearer fixture-token');
    if (url.hostname === 'site.api.espn.com') assert.equal(options.headers.Authorization, undefined);
  }
  const firstCallCount = calls.length;
  await service.details({ leagueId: 'f1', gameId: 'f1:401839132', date: '20261108' });
  assert.equal(calls.length, firstCallCount, 'Repeated session details reuse this service\'s caches');
  assert.deepEqual(unexpectedDefaultRequests, []);
});

const handlerCases = [
  { name: 'scoreboard', create: createScoreboardHandler, defaultHandler: scoreboardHandler, dependency: 'getScoreboard',
    url: '/api/scoreboard?league=nba&date=20261125', args: { leagueId: 'nba', date: '20261125' },
    invalid: ['/api/scoreboard?league=nfl&league=nba', '/api/scoreboard?date=20261125&date=20261126'],
    ErrorType: ScoreboardError, unavailableCode: 'UPSTREAM_UNAVAILABLE' },
  { name: 'game', create: createGameHandler, defaultHandler: gameHandler, dependency: 'getGameDetails',
    url: '/api/game?league=nba&id=nba:401909317&date=20261125', args: { leagueId: 'nba', gameId: 'nba:401909317', date: '20261125' },
    invalid: ['/api/game', '/api/game?id=1&id=2', '/api/game?id=1&league=nfl&league=nba', '/api/game?id=1&date=20261125&date=20261126'],
    ErrorType: GameDetailsError, unavailableCode: 'DETAILS_UNAVAILABLE' },
  { name: 'teams', create: createTeamsHandler, defaultHandler: teamsHandler, dependency: 'getTeams',
    url: '/api/teams?league=nba', args: { leagueId: 'nba' },
    invalid: ['/api/teams?league=nfl&league=nba'],
    ErrorType: ScoreboardError, unavailableCode: 'TEAMS_UNAVAILABLE' },
];

for (const row of handlerCases) {
  test(`${row.name} handler factory preserves query parsing, JSON headers, HEAD, and retry headers`, async () => {
    const received = [];
    const payload = { fixture: row.name, retryAfterMs: 1501 };
    const handler = row.create({ [row.dependency]: async (args) => { received.push(args); return payload; } });
    const get = await invoke(handler, row.url);
    assert.equal(get.statusCode, 200);
    assertJSONHeaders(get.headers);
    assert.equal(get.headers['retry-after'], '2');
    assert.deepEqual(JSON.parse(get.body), payload);
    const head = await invoke(handler, row.url, 'HEAD');
    assert.equal(head.statusCode, 200);
    assert.deepEqual(head.headers, get.headers);
    assert.equal(head.body, undefined);
    assert.deepEqual(received, [row.args, row.args]);
  });

  test(`${row.name} Vercel default export keeps validation and method responses identical to the factory`, async () => {
    let calls = 0;
    const handler = row.create({ [row.dependency]: async () => { calls += 1; throw new Error('Must reject before fetching'); } });
    for (const url of row.invalid) {
      for (const method of ['GET', 'HEAD']) {
        const original = await invoke(row.defaultHandler, url, method);
        const injected = await invoke(handler, url, method);
        assert.deepEqual(injected, original);
        assert.equal(injected.statusCode, 400);
        assertJSONHeaders(injected.headers);
        if (method === 'HEAD') assert.equal(injected.body, undefined);
      }
    }
    const post = await invoke(handler, row.url, 'POST');
    assert.deepEqual(post, await invoke(row.defaultHandler, row.url, 'POST'));
    assert.equal(post.statusCode, 405);
    assert.equal(post.headers.allow, 'GET, HEAD');
    assert.equal(JSON.parse(post.body).code, 'METHOD_NOT_ALLOWED');
    assert.equal(calls, 0);
    assert.deepEqual(unexpectedDefaultRequests, []);
  });

  test(`${row.name} handler factory retains typed feed errors and redacts unexpected failures`, async () => {
    const known = Object.assign(new row.ErrorType('The fixture feed is delayed.', { statusCode: 503, code: 'FIXTURE_DELAYED' }), { retryAfterMs: 2501 });
    const knownHandler = row.create({ [row.dependency]: async () => { throw known; } });
    const failed = await invoke(knownHandler, row.url);
    assert.equal(failed.statusCode, 503);
    assertJSONHeaders(failed.headers);
    assert.equal(failed.headers['retry-after'], '3');
    assert.deepEqual(JSON.parse(failed.body), { error: known.message, code: known.code, retryAfterMs: 2501 });
    const head = await invoke(knownHandler, row.url, 'HEAD');
    assert.equal(head.statusCode, 503);
    assert.deepEqual(head.headers, failed.headers);
    assert.equal(head.body, undefined);
    const unexpected = await invoke(row.create({ [row.dependency]: async () => { throw new Error('Private transport details'); } }), row.url);
    assert.equal(unexpected.statusCode, 502);
    assert.equal(JSON.parse(unexpected.body).code, row.unavailableCode);
    assert.doesNotMatch(unexpected.body, /Private transport details/);
  });
}
