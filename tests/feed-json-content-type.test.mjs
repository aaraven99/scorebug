import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFeedService } from '../lib/feed-service.mjs';
import { createSportsService } from '../lib/sports.mjs';

const nwsl = JSON.parse(readFileSync(new URL('./fixtures/multisport/nwsl-teams-ld-json.json', import.meta.url)));
const expectedTeams = JSON.parse(readFileSync(new URL('./fixtures/directory-audit/nwsl.json', import.meta.url))).teams;
class FeedError extends Error { constructor(message, options = {}) { super(message); Object.assign(this, options); } }
function readResponse(makeResponse) {
  return createFeedService({
    sources: [{ id: 'primary', url: () => 'https://feed.example/data' }],
    fetchImpl: async () => makeResponse(), normalize: (data, { fetchedAt }) => ({ ...data, fetchedAt }),
    ErrorType: FeedError, label: 'test feed', invalidCode: 'INVALID', unavailableCode: 'UNAVAILABLE', timeoutCode: 'TIMEOUT',
  })('current');
}

test('the verified NWSL application/ld+json response loads all 16 teams through the shared reader', async () => {
  assert.equal(nwsl.responseHeaders['content-type'], 'application/ld+json');
  const calls = [];
  const service = createSportsService({ fetchImpl: async (url) => {
    calls.push(url);
    return new Response(JSON.stringify(nwsl.payload), { headers: { 'Content-Type': nwsl.responseHeaders['content-type'] } });
  } });
  const directory = await service.teams({ leagueId: 'nwsl' });
  assert.deepEqual(calls, [nwsl.sourceUrl]);
  assert.equal(directory.teams.length, 16);
  assert.deepEqual(directory.teams.map(team => team.id).sort(), expectedTeams.map(team => team.id).sort());
  assert.equal(directory.teams.find(team => team.id === 'nwsl:15360').name, 'Chicago Stars FC');
  assert.equal(directory.teams.find(team => team.id === 'nwsl:131563').name, 'Denver Summit FC');
  assert.equal(directory.coverage.complete, true);
  assert.equal(directory.sourceId, 'espn-site');
  assert.equal(directory.feedStatus, 'primary');
  assert.equal(directory.stale, false);
});

test('JSON and structured JSON media types support parameters and case-insensitive type names', async () => {
  for (const contentType of [
    'application/json', 'Application/JSON; charset=utf-8', 'application/ld+json',
    'APPLICATION/LD+JSON; charset=UTF-8', 'application/vnd.api+json',
    'application/vnd.scorebug.data+json; charset="utf-8"',
  ]) {
    const data = await readResponse(() => new Response('{"ok":true}', { headers: { 'Content-Type': contentType } }));
    assert.equal(data.ok, true, contentType);
    assert.equal(data.sourceId, 'primary', contentType);
  }
});

test('HTML, non-JSON types and JSON lookalikes remain rejected even when their bodies parse', async () => {
  for (const contentType of [
    '', 'text/html', 'text/plain', 'application/javascript', 'application/jsonp',
    'application/json-seq', 'application/x-ndjson', 'application/json+html',
    'text/application/json', 'application/+json', 'application/vnd.api+json-bad',
    'application/ld+json, text/html', 'application/json-extra',
  ]) {
    await assert.rejects(readResponse(() => new Response('{"ok":true}', { headers: { 'Content-Type': contentType } })), { code: 'INVALID' }, contentType || 'missing content type');
  }
});

test('structured JSON keeps the same malformed-body and four-megabyte bounds', async () => {
  for (const body of ['{"unfinished":', '<!doctype html><title>Provider error</title>']) {
    await assert.rejects(readResponse(() => new Response(body, { headers: { 'Content-Type': 'application/ld+json' } })), { code: 'INVALID' });
  }
  await assert.rejects(readResponse(() => new Response('{"ok":true}', {
    headers: { 'Content-Type': 'application/ld+json', 'Content-Length': String(4 * 1024 * 1024 + 1) },
  })), { code: 'INVALID' });
  const oversized = new TextEncoder().encode(`{"data":"${'x'.repeat(4 * 1024 * 1024)}"}`);
  await assert.rejects(readResponse(() => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(oversized.subarray(0, 1024)); controller.enqueue(oversized.subarray(1024)); controller.close();
  } }), { headers: { 'Content-Type': 'application/ld+json' } })), { code: 'INVALID' });
});

test('a malformed primary still fails over to a valid structured JSON response', async () => {
  const calls = [];
  const read = createFeedService({
    sources: ['primary', 'backup'].map(id => ({ id, url: () => `https://${id}.example/data` })),
    fetchImpl: async (url) => {
      calls.push(url);
      return new Response(url.includes('primary') ? '<html>Unavailable</html>' : '{"ok":true}', { headers: { 'Content-Type': 'application/ld+json' } });
    },
    normalize: (data, { fetchedAt }) => ({ ...data, fetchedAt }), ErrorType: FeedError,
    label: 'test feed', invalidCode: 'INVALID', unavailableCode: 'UNAVAILABLE', timeoutCode: 'TIMEOUT',
  });
  const result = await read('current');
  assert.equal(result.ok, true);
  assert.equal(result.sourceId, 'backup');
  assert.equal(result.feedStatus, 'backup');
  assert.deepEqual(calls, ['https://primary.example/data', 'https://backup.example/data']);
});
