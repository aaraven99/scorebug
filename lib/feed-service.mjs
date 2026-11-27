const MAX_BYTES = 4 * 1024 * 1024;
const MAX_STALE_MS = 6 * 60 * 60 * 1000;
const ATTEMPT_MS = 7000;
const TOTAL_MS = 14000;

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
 * Primary-first failover, shared by local Node and Vercel. Available backups
 * race after primary failure so a slow route cannot block a healthy provider.
 * Failed endpoints cool down; primary is retried after 30s.
 * Cached fallback keeps its original timestamp and is always marked stale.
 */
export function createFeedService({
  sources, normalize, ErrorType, label, invalidCode, unavailableCode, timeoutCode,
  fetchImpl = globalThis.fetch, now = Date.now, cacheTtlMs = 5000,
  maxStaleMs = MAX_STALE_MS, acceptValue = () => true,
} = {}) {
  const cache = new Map(), pending = new Map(), failures = new Map();
  const fail = (message, options = {}) => new ErrorType(message, options);
  const invalid = () => fail(`The ${label} returned unexpected data.`, { code: invalidCode });
  const staleValue = (entry) => ({ ...entry.value, feedStatus: 'cached', stale: true, checkedAt: new Date(now()).toISOString() });

  return async function read(key) {
    let cached = cache.get(key);
    if (cached && now() - Date.parse(cached.value.fetchedAt) > maxStaleMs) { cache.delete(key); cached = null; }
    if (cached && cached.expiresAt > now()) return cached.value;
    if (pending.has(key)) return pending.get(key);
    const request = (async () => {
      const started = now();
      const enabled = sources.filter((source) => !source.enabled || source.enabled(key));
      const ready = enabled.filter((source) => (failures.get(source.id)?.retryAt || 0) <= now());
      // A warm outage can return labeled last-known data without repeatedly
      // hammering every failed endpoint. Cold requests still get one attempt.
      const candidates = ready.length ? ready : cached ? [] : [...enabled].sort((a, b) => (failures.get(a.id)?.retryAt || 0) - (failures.get(b.id)?.retryAt || 0)).slice(0, 1);
      const controllers = new Map();
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
            await response.body?.cancel();
            throw fail(`The ${label} is temporarily unavailable.`, {
              statusCode: response.status === 404 ? 404 : [429, 503].includes(response.status) ? 503 : 502,
              code: unavailableCode,
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
          if (!acceptValue(value, cached?.value, now())) throw invalid();
          const result = { ...value, sourceId: source.id, feedStatus: source === sources[0] ? 'primary' : 'backup', stale: false };
          failures.delete(source.id);
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
          failures.set(source.id, { count, retryAt: now() + Math.min(60000, 30000 * count) });
          throw lastError;
        }
      };
      let result;
      if (candidates.includes(sources[0])) {
        try { result = await attempt(sources[0]); } catch { /* Try available backups below. */ }
      }
      if (!result) {
        const backups = candidates.filter((source) => source !== sources[0]);
        if (backups.length) {
          try { result = await Promise.any(backups.map(attempt)); }
          catch { /* Every available backup failed; use explicitly stale data. */ }
        }
      }
      if (result) {
        for (const [id, controller] of controllers) if (id !== result.sourceId) controller.abort();
        if (!cache.has(key) && cache.size >= 16) cache.delete(cache.keys().next().value);
        cache.set(key, { value: result, expiresAt: now() + cacheTtlMs });
        return result;
      }
      if (cached) return staleValue(cached);
      throw lastError || fail(`The ${label} is temporarily unavailable. Please try again shortly.`, { statusCode: 503, code: unavailableCode });
    })();
    pending.set(key, request);
    try { return await request; }
    finally { pending.delete(key); }
  };
}
