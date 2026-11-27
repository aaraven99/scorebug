import { retryAfterMs, snapshotIsOlder } from '../public/feed-state.js';

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_STALE_MS = 6 * 60 * 60 * 1000;
const ATTEMPT_MS = 6000;
const TOTAL_MS = 8000;

/** Read only bounded JSON from a fixed, trusted feed URL. */
async function readJson(response, invalid) {
  const size = Number(response.headers.get('content-length'));
  if ((Number.isFinite(size) && size > MAX_BYTES) || !/application\/json/i.test(response.headers.get('content-type') || '')) {
    await response.body?.cancel();
    throw invalid();
  }
  if (!response.body) throw invalid();
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let bytes = 0, body = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) { await reader.cancel(); throw invalid(); }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
  } finally { reader.releaseLock(); }
  try { return JSON.parse(body); }
  catch { throw invalid(); }
}

/**
 * Primary-first failover, shared by local Node and Vercel. Backups start after
 * a failure or a slow response; fast, healthy reads only use one provider.
 * Failed endpoints cool down and honor their Retry-After instructions.
 * Cached fallback keeps its original timestamp and is always marked stale.
 */
export function createFeedService({
  sources, normalize, ErrorType, label, invalidCode, unavailableCode, timeoutCode,
  fetchImpl = globalThis.fetch, now = Date.now, cacheTtlMs = 1000,
  maxStaleMs = MAX_STALE_MS, acceptValue = () => true, hedgeDelayMs = 1500,
} = {}) {
  const cache = new Map(), pending = new Map(), failures = new Map(), slowUntil = new Map();
  const fail = (message, options = {}) => {
    const error = new ErrorType(message, options);
    if (options.retryAfterMs > 0) error.retryAfterMs = options.retryAfterMs;
    return error;
  };
  const invalid = () => fail(`The ${label} returned unexpected data.`, { code: invalidCode });
  const staleValue = (entry, delay) => ({ ...entry.value, feedStatus: 'cached', stale: true, checkedAt: new Date(now()).toISOString(), retryAfterMs: delay });

  return async function read(key) {
    let cached = cache.get(key);
    if (cached && now() - Date.parse(cached.value.fetchedAt) > maxStaleMs) { cache.delete(key); cached = null; }
    if (cached && cached.expiresAt > now()) return cached.value;
    if (pending.has(key)) return pending.get(key);
    const request = (async () => {
      const started = now();
      const enabled = sources.filter((source) => !source.enabled || source.enabled(key));
      const ready = enabled.filter((source) => (failures.get(source.id)?.retryAt || 0) <= now());
      // Even a cold request must honor throttling. A previously slow route is
      // only skipped when another route is ready; its probe resumes after 10s.
      const quick = ready.filter((source) => (slowUntil.get(source.id) || 0) <= now());
      const candidates = quick.length ? quick : ready;
      const controllers = new Map();
      const delayedCandidates = [];
      let lastError;
      const attempt = async (source) => {
        const remaining = TOTAL_MS - (now() - started);
        if (remaining <= 0) throw fail(`The ${label} took too long to respond.`, { statusCode: 503, code: timeoutCode });
        const sourceUrl = source.url(key);
        const controller = new AbortController();
        controllers.set(source.id, controller);
        try {
          const response = await fetchImpl(sourceUrl, {
            headers: { Accept: 'application/json' }, cache: 'no-store', redirect: 'error',
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(Math.max(1, Math.min(source.timeoutMs || ATTEMPT_MS, remaining)))]),
          });
          if (!response.ok) {
            const retry = [429, 503].includes(response.status) ? retryAfterMs(response.headers.get('retry-after'), now()) : 0;
            await response.body?.cancel();
            throw fail(`The ${label} is temporarily unavailable.`, {
              statusCode: response.status === 404 ? 404 : [429, 503].includes(response.status) ? 503 : 502,
              code: unavailableCode, retryAfterMs: retry,
            });
          }
          // Some public CDNs may serve a day-old response on upstream errors.
          // A successful HTTP status alone must not turn that into live data.
          const age = Number(response.headers.get('age'));
          if ((Number.isFinite(age) && age > 45) || /(?:^|,)\s*11[01]\b/.test(response.headers.get('warning') || '')) {
            await response.body?.cancel();
            throw fail(`The ${label} returned delayed data.`, { statusCode: 503, code: unavailableCode });
          }
          const payload = await readJson(response, invalid);
          const fetchedAt = new Date(now()).toISOString();
          const value = (source.normalize || normalize)(source.select ? source.select(payload) : payload, { key, fetchedAt, sourceUrl, previous: cached?.value });
          const result = { ...value, sourceId: source.id, feedStatus: source === sources[0] ? 'primary' : 'backup', stale: false };
          const live = value.state === 'in' || value.games?.some((game) => game.state === 'in');
          const delayed = live && Number.isFinite(age) && age > 5;
          if (delayed) result.fetchedAt = new Date(now() - age * 1000).toISOString();
          if (!acceptValue(result, cached?.value, now()) || snapshotIsOlder(result, cached?.value, now())) throw invalid();
          if (delayed) {
            // A six-second CDN snapshot is useful on a cold start, but only
            // after fresh alternatives fail, with its age disclosed honestly.
            delayedCandidates.push(result);
            throw fail(`The ${label} returned delayed data.`, { statusCode: 503, code: unavailableCode });
          }
          failures.delete(source.id);
          slowUntil.delete(source.id);
          return result;
        } catch (cause) {
          // Losing a race is not a provider outage. Do not suppress this
          // endpoint on the next request just because another one was faster.
          if (controller.signal.aborted) throw cause;
          const timeout = ['TimeoutError', 'AbortError'].includes(cause?.name);
          lastError = cause instanceof ErrorType ? cause : fail(timeout ? `The ${label} took too long to respond.` : `Unable to reach the ${label}.`, {
            statusCode: timeout ? 503 : 502, code: timeout ? timeoutCode : unavailableCode, cause,
          });
          const count = (failures.get(source.id)?.count || 0) + 1;
          const delay = Math.max(lastError.retryAfterMs || 0, Math.min(30000, 2000 * 2 ** Math.min(count, 4)));
          failures.set(source.id, { count, retryAt: now() + delay });
          throw lastError;
        }
      };
      let result;
      const leading = candidates.includes(sources[0]) ? sources[0]
        : candidates.find((source) => source.id === cached?.value.sourceId) || candidates[0];
      if (leading) {
        const backups = candidates.filter((source) => source !== leading);
        const first = attempt(leading);
        let hedgeTimer, finished = false, backupsStarted = false;
        const backupTask = backups.length ? new Promise((resolve, reject) => {
          const startBackups = () => {
            if (finished || backupsStarted) return;
            backupsStarted = true;
            clearTimeout(hedgeTimer);
            Promise.any(backups.map(attempt)).then(resolve, reject);
          };
          hedgeTimer = setTimeout(startBackups, hedgeDelayMs);
          first.catch(startBackups);
        }) : null;
        try { result = await (backupTask ? Promise.any([first, backupTask]) : first); }
        catch { /* Every ready route failed; retain the last successful data. */ }
        finally { finished = true; clearTimeout(hedgeTimer); }
        if (result && result.sourceId !== leading.id && (failures.get(leading.id)?.retryAt || 0) <= now()) {
          slowUntil.set(leading.id, now() + 10000);
        }
      }
      if (result) {
        for (const [id, controller] of controllers) if (id !== result.sourceId) controller.abort();
        if (!cache.has(key) && cache.size >= 16) cache.delete(cache.keys().next().value);
        cache.set(key, { value: result, expiresAt: now() + cacheTtlMs });
        return result;
      }
      const retryTimes = enabled.map((source) => failures.get(source.id)?.retryAt || now());
      const delay = retryTimes.length ? Math.max(0, Math.min(...retryTimes) - now()) : 4000;
      const delayed = delayedCandidates.reduce((best, next) => !best || snapshotIsOlder(best, next, now()) ? next : best, null);
      if (delayed && (!cached || snapshotIsOlder(cached.value, delayed, now()))) {
        if (!cache.has(key) && cache.size >= 16) cache.delete(cache.keys().next().value);
        cached = { value: { ...delayed, feedStatus: 'cached', stale: true }, expiresAt: 0 };
        cache.set(key, cached);
      }
      if (cached) return staleValue(cached, delay);
      const error = lastError || fail(`The ${label} is temporarily unavailable. Please try again shortly.`, { statusCode: 503, code: unavailableCode });
      // A usable backup can be retried before a separately throttled source.
      error.retryAfterMs = delay;
      throw error;
    })();
    pending.set(key, request);
    try { return await request; }
    finally { pending.delete(key); }
  };
}
