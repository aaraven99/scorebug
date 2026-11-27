import { clean, number } from './sports.mjs';
import { retryAfterMs } from '../public/feed-state.js';

const ORIGIN = 'https://api.openf1.org';
const ARRAY_ENDPOINTS = new Set(['sessions', 'drivers', 'session_result', 'race_control', 'position', 'intervals', 'stints']);
const safeDate = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const nameKey = (value) => clean(value, 100).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/gi, '').toLowerCase();
const color = (value) => /^[a-f\d]{6}$/i.test(value || '') ? `#${value.toLowerCase()}` : '#475569';
const integer = (value, min = 0, max = 100000) => { const n = number(value, min, max); return Number.isInteger(n) ? n : null; };
const lastValue = (value) => Array.isArray(value) ? value.filter((v) => v != null).at(-1) ?? null : value;
const timing = (value) => {
  const seconds = number(lastValue(value), 0, 1000000);
  if (seconds === null) return null;
  const minutes = Math.floor(seconds / 60), remainder = (seconds % 60).toFixed(3).padStart(6, '0');
  return `${minutes}:${remainder}`;
};
const gapText = (value) => {
  const last = lastValue(value), seconds = number(last, 0, 1000000);
  return seconds === 0 ? 'Leader' : seconds !== null ? `+${seconds.toFixed(3)}` : /^\+?\d+\s+LAPS?$/i.test(String(last || '')) ? String(last).slice(0, 20) : null;
};
function photo(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'media.formula1.com' && !url.port && !url.username && !url.password ? url.href : null; } catch { return null; }
}
export function normalizeRaceControl(rows, sessionKey) {
  return (Array.isArray(rows) ? rows : []).filter((row) => String(row.session_key) === String(sessionKey)).slice(-600).map((row) => {
    const date = safeDate(row.date), message = clean(row.message, 500), flag = clean(row.flag, 40).toLowerCase().replace(/\s+/g, '-');
    return { id: `openf1:${sessionKey}:${date}:${row.driver_number || ''}:${row.sector || ''}:${message}`, date, timestamp: date, clock: null,
      flag: flag || null, category: clean(row.category, 50) || null, message, driverNumber: integer(row.driver_number, 1, 99),
      scope: clean(row.scope, 40) || null, sector: integer(row.sector, 1, 30), lap: integer(row.lap_number, 0, 1000) };
  }).filter((row) => row.date && row.message).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}
export function currentRaceFlag(messages) {
  let flag = null;
  for (const message of messages) {
    const text = message.message.toUpperCase(), global = !message.scope || /TRACK|SESSION/i.test(message.scope);
    if (/VIRTUAL SAFETY CAR DEPLOYED/.test(text)) flag = 'virtual-safety-car';
    else if (/SAFETY CAR DEPLOYED/.test(text)) flag = 'safety-car';
    else if (/VIRTUAL SAFETY CAR ENDED|SAFETY CAR WITHDRAWN/.test(text)) flag = 'green';
    else if (global && !/PIT (?:EXIT|ENTRY)|PIT LANE/i.test(text) && ['green', 'red', 'yellow', 'double-yellow', 'chequered'].includes(message.flag)) flag = message.flag;
  }
  return flag;
}
export function mergeOpenF1Timing(game, { session, drivers = [], results = [], positions = [], intervals = [], stints = [], control = [], fetchedAt, stale = false } = {}) {
  const sessionKey = integer(session?.session_key, 1, Number.MAX_SAFE_INTEGER);
  if (!sessionKey) return null;
  const latest = (rows, key) => {
    const out = new Map();
    for (const row of rows) {
      if (String(row.session_key) !== String(sessionKey)) continue;
      const id = integer(row.driver_number, 1, 99); if (id === null) continue;
      const old = out.get(id);
      if (!old || key === 'stint_number' && Number(row[key]) > Number(old[key]) || key !== 'stint_number' && Date.parse(row.date) >= Date.parse(old.date)) out.set(id, row);
    }
    return out;
  };
  const latestPositions = latest(positions, 'date'), latestIntervals = latest(intervals, 'date'), latestStints = latest(stints, 'stint_number');
  const validDrivers = drivers.filter((d) => String(d.session_key) === String(sessionKey) && integer(d.driver_number, 1, 99) !== null && clean(d.full_name));
  const entries = validDrivers.map((driver) => {
    const numberValue = driver.driver_number;
    const matches = (game.entries || []).filter((entry) => nameKey(entry.name) === nameKey(driver.full_name));
    const prior = matches.length === 1 ? matches[0] : null;
    const result = results.find((row) => String(row.session_key) === String(sessionKey) && row.driver_number === numberValue);
    const suppliedPosition = latestPositions.get(numberValue), interval = latestIntervals.get(numberValue), stint = latestStints.get(numberValue);
    const position = suppliedPosition && (!prior?.positionUpdatedAt || Date.parse(suppliedPosition.date) >= Date.parse(prior.positionUpdatedAt)) ? suppliedPosition : null;
    const id = prior?.id || `f1:driver-${numberValue}`;
    return { ...prior, id, leagueId: 'f1', sport: 'racing', name: clean(driver.full_name, 100), abbreviation: clean(driver.name_acronym, 6) || clean(driver.broadcast_name, 35), number: String(numberValue),
      position: integer(result?.position ?? position?.position ?? prior?.position, 1, 100),
      positionUpdatedAt: safeDate(position?.date) || prior?.positionUpdatedAt || null, color: color(driver.team_colour),
      team: clean(driver.team_name) ? { id: `f1:team-${nameKey(driver.team_name)}`, name: clean(driver.team_name, 100), color: color(driver.team_colour), logo: null } : prior?.team || null,
      headshot: photo(driver.headshot_url) || prior?.headshot || null,
      gap: gapText(result?.gap_to_leader ?? interval?.gap_to_leader) || prior?.gap || null,
      interval: gapText(interval?.interval), time: timing(result?.duration) || prior?.time || null,
      qualifyingTimes: Array.isArray(result?.duration) ? result.duration.map(timing) : [],
      laps: integer(result?.number_of_laps, 0, 1000) ?? prior?.laps ?? null,
      status: result?.dsq === true ? 'Disqualified' : result?.dns === true ? 'Did not start' : result?.dnf === true ? 'Did not finish' : prior?.status || null,
      tyre: clean(stint?.compound, 20) || null, tyreAgeAtStart: integer(stint?.tyre_age_at_start, 0, 200),
      // A new tyre stint can begin under a red flag without a pit stop.
      stintNumber: integer(stint?.stint_number, 1, 20),
    };
  }).sort((a, b) => (a.position ?? 999) - (b.position ?? 999));
  const raceControl = normalizeRaceControl(control, sessionKey);
  // Sector-yellow messages stay local; they must not clear an active safety car.
  const flag = currentRaceFlag(raceControl);
  return { ...game, entries: entries.length ? entries : game.entries, raceControl, flag,
    timingFetchedAt: fetchedAt, timingStale: stale, openF1SessionKey: sessionKey,
    circuit: clean(session.circuit_short_name, 100) || game.circuit,
    coverage: { level: game.state === 'in' ? 'live-timing' : 'session-results', message: game.state === 'in' ? 'OpenF1 timing and race control; individual fields update at the source cadence.' : 'OpenF1 published session results and race-control history.' },
  };
}

/** Optional live account stays on the server. Free historical requests remain rate-limited. */
export function createOpenF1Enricher({ fetchImpl = globalThis.fetch, now = Date.now, env = process.env } = {}) {
  const cache = new Map(), pending = new Map(), enriched = new Map();
  let token = null, tokenExpiresAt = 0, tokenPromise = null, pausedUntil = 0, queue = Promise.resolve(), requestTimes = [];
  const configured = () => Boolean(env.OPENF1_TOKEN || env.OPENF1_USERNAME && env.OPENF1_PASSWORD);
  const quietError = (status = 502) => Object.assign(new Error('F1 timing is temporarily unavailable.'), { status });
  async function boundedJSON(response) {
    if (!response.ok) {
      const delay = retryAfterMs(response.headers.get('retry-after'), now());
      if (response.status === 429) pausedUntil = Math.max(pausedUntil, now() + Math.max(60000, delay));
      if ([401, 403].includes(response.status)) pausedUntil = Math.max(pausedUntil, now() + 60000);
      await response.body?.cancel(); throw quietError(response.status);
    }
    if (!/application\/json/i.test(response.headers.get('content-type') || '') || Number(response.headers.get('content-length')) > 4 * 1024 * 1024) { await response.body?.cancel(); throw quietError(); }
    let bytes = 0, content = ''; const reader = response.body.getReader(), decoder = new TextDecoder();
    try { while (true) { const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength; if (bytes > 4 * 1024 * 1024) { await reader.cancel(); throw quietError(); } content += decoder.decode(next.value, { stream: true }); } content += decoder.decode(); }
    finally { reader.releaseLock(); }
    try { return JSON.parse(content); } catch { throw quietError(); }
  }
  async function accessToken() {
    if (typeof env.OPENF1_TOKEN === 'string' && env.OPENF1_TOKEN) return env.OPENF1_TOKEN;
    if (!env.OPENF1_USERNAME || !env.OPENF1_PASSWORD) return null;
    if (token && tokenExpiresAt > now() + 60000) return token;
    if (tokenPromise) return tokenPromise;
    tokenPromise = (async () => {
      const response = await fetchImpl(`${ORIGIN}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams({ username: env.OPENF1_USERNAME, password: env.OPENF1_PASSWORD }), redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(5000) });
      const value = await boundedJSON(response);
      if (typeof value.access_token !== 'string' || !value.access_token || value.access_token.length > 16000) throw quietError(401);
      token = value.access_token; tokenExpiresAt = now() + Math.min(3600000, (number(value.expires_in, 60, 86400) || 3600) * 1000);
      return token;
    })().finally(() => { tokenPromise = null; });
    return tokenPromise;
  }
  async function read(endpoint, params, ttl = 10000) {
    if (!ARRAY_ENDPOINTS.has(endpoint)) throw quietError();
    const url = new URL(`${ORIGIN}/v1/${endpoint}`); for (const [key, value] of Object.entries(params)) if (value != null) url.searchParams.set(key, String(value));
    const key = url.href, cached = cache.get(key);
    if (cached && cached.until > now()) return cached.value;
    if (pending.has(key)) return pending.get(key);
    if (pausedUntil > now()) throw quietError(429);
    const request = (async () => {
      // One process stays under the public 30/minute and 3/second limits.
      // A live account permits 60/minute; leave headroom for token renewal.
      const slot = queue.then(async () => {
        requestTimes = requestTimes.filter((t) => now() - t < 60000);
        const limit = configured() ? 52 : 24;
        if (requestTimes.length >= limit) throw quietError(429);
        const wait = Math.max(0, (requestTimes.at(-1) || 0) + 400 - now());
        if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
        requestTimes.push(now());
      });
      queue = slot.catch(() => {}); await slot;
      const auth = await accessToken();
      const response = await fetchImpl(key, { headers: { Accept: 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(5000) });
      const value = await boundedJSON(response);
      if (!Array.isArray(value)) throw quietError();
      cache.set(key, { value, until: now() + ttl });
      if (cache.size > 150) cache.delete(cache.keys().next().value);
      return value;
    })().finally(() => pending.delete(key));
    pending.set(key, request); return request;
  }
  return async function enrich(details, game) {
    const live = game.state === 'in';
    if (game.state === 'pre' || !game.startTime) return details;
    if (live && !configured()) return { ...details, coverage: { level: 'classification', liveTimingConfigured: false, message: 'ESPN classification. Live F1 gaps, tyres, safety cars and race-control flags require an OpenF1 live account on the server.' } };
    const cached = enriched.get(game.id), ttl = live ? 10000 : 300000;
    if (cached && now() - cached.at < ttl) return { ...details, ...cached.payload };
    const staleFallback = () => cached ? { ...details, ...cached.payload, timingStale: true, race: { ...cached.payload.race, timingStale: true }, coverage: { ...cached.payload.coverage, message: 'Timing is delayed; showing the last confirmed session data.' } } : details;
    if (pausedUntil > now()) return staleFallback();
    try {
      const start = Date.parse(game.startTime), day = new Date(start).toISOString().slice(0, 10);
      const sessions = await read('sessions', { 'date_start>=': `${day}T00:00:00`, 'date_start<=': `${day}T23:59:59` }, 900000);
      const candidates = sessions.filter((s) => {
        const expected = game.sessionType === 'sprint-qualifying' ? /sprint.*qualifying|sprint.*shootout/i : game.sessionType === 'sprint' ? /^sprint$/i : game.sessionType === 'race' ? /^race$/i : game.sessionType === 'qualifying' ? /^qualifying$/i : /^practice/i;
        return expected.test(s.session_name || s.session_type || '') && Math.abs(Date.parse(s.date_start) - start) <= 3 * 60 * 60 * 1000;
      }).sort((a, b) => Math.abs(Date.parse(a.date_start) - start) - Math.abs(Date.parse(b.date_start) - start));
      const session = candidates[0];
      if (!session || candidates.length > 1 && Math.abs(Date.parse(candidates[0].date_start) - start) === Math.abs(Date.parse(candidates[1].date_start) - start)) return details;
      const sessionKey = integer(session.session_key, 1, Number.MAX_SAFE_INTEGER);
      if (!sessionKey) return details;
      const publicWindow = now() >= Date.parse(session.date_start) - 1800000 && now() <= Date.parse(session.date_end) + 1800000;
      if (publicWindow && !configured()) return details;
      const drivers = await read('drivers', { session_key: sessionKey }, 900000);
      const since = new Date(now() - 90000).toISOString();
      const endpoints = live ? [
        ['position', { session_key: sessionKey, 'date>=': since }, 10000],
        ['intervals', { session_key: sessionKey, 'date>=': since }, 10000],
        ['race_control', { session_key: sessionKey }, 10000],
        ['stints', { session_key: sessionKey }, 30000],
      ] : [['session_result', { session_key: sessionKey }, 300000], ['race_control', { session_key: sessionKey }, 300000], ['stints', { session_key: sessionKey }, 300000]];
      const loaded = await Promise.allSettled(endpoints.map(([endpoint, params, endpointTtl]) => read(endpoint, params, endpointTtl)));
      const values = {}; loaded.forEach((result, i) => { values[endpoints[i][0]] = result.status === 'fulfilled' ? result.value : []; });
      if (loaded.every((r) => r.status === 'rejected')) return staleFallback();
      const fetchedAt = new Date(now()).toISOString();
      const succeeded = (endpoint) => loaded[endpoints.findIndex(([name]) => name === endpoint)]?.status === 'fulfilled';
      const timingStale = !succeeded(live ? 'position' : 'session_result') || !succeeded('race_control');
      const base = cached?.payload.race ? { ...game, entries: cached.payload.race.entries } : game;
      const race = mergeOpenF1Timing(base, { session, drivers, results: values.session_result, positions: values.position, intervals: values.intervals, control: values.race_control, stints: values.stints, fetchedAt, stale: timingStale });
      if (!race) return details;
      if (!succeeded('race_control') && cached?.payload.race) { race.raceControl = cached.payload.race.raceControl; race.flag = cached.payload.race.flag; }
      const payload = { entries: race.entries, race, raceControl: race.raceControl, flag: race.flag, timingFetchedAt: fetchedAt, timingStale, source: 'ESPN + OpenF1', coverage: { ...race.coverage, ...(timingStale ? { message: 'Some timing data is delayed. Showing the last confirmed values.' } : {}), liveTimingConfigured: configured() } };
      enriched.set(game.id, { payload, at: now() });
      if (enriched.size > 50) enriched.delete(enriched.keys().next().value);
      return { ...details, ...payload };
    } catch { return staleFallback(); }
  };
}
