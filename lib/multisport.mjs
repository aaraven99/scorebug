import { createSportsService } from './sports.mjs';
import { createOpenF1Enricher } from './openf1.mjs';

/** Keep the sports feeds and optional F1 enrichment on the same transport. */
export function createMultisportService({ fetchImpl = globalThis.fetch, now = Date.now, env = process.env, ...options } = {}) {
  return createSportsService({ ...options, fetchImpl, now, f1Enricher: createOpenF1Enricher({ fetchImpl, now, env }) });
}

// Vercel functions retain a shared service within their own server process.
const service = createMultisportService();
export const getScoreboard = service.scoreboard;
export const getGameDetails = service.details;
export const getTeams = service.teams;
