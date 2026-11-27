import { createSportsService } from './sports.mjs';
import { createOpenF1Enricher } from './openf1.mjs';

const service = createSportsService({ f1Enricher: createOpenF1Enricher() });
export const getScoreboard = service.scoreboard;
export const getGameDetails = service.details;
export const getTeams = service.teams;
