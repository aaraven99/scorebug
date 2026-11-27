'use strict';

const { ANCHORS } = require('./geometry.cjs');

const GAME_ID_PATTERN = /^(?:\d{1,15}|(?:thescore|fox)-\d{1,15}|[a-z][a-z0-9.-]{0,39}:[a-zA-Z0-9_-]{1,48})$/;
const LEAGUE_ID_PATTERN = /^[a-z][a-z0-9.-]{0,39}$/;
const STYLE_ID_PATTERN = /^[a-z][a-z0-9-]{0,79}$/;
const TEAM_ID_PATTERN = /^(?:\d{1,15}|[a-z][a-z0-9.-]{0,39}:[a-zA-Z0-9_-]{1,48})$/;
const LOCAL_LOGO_PATTERN = /^\/(?:assets\/teams|logos(?:\/[a-z0-9-]+)?)\/[a-z0-9-]+\.(?:svg|png)$/i;
const LOGO_HOSTS = new Set(['a.espncdn.com']);
let favoriteStyleCatalog = null;

function setFavoriteStyleCatalog(styles) {
  if (!Array.isArray(styles) || !styles.length || styles.some(style => typeof style?.id !== 'string' || !STYLE_ID_PATTERN.test(style.id))) throw new TypeError('Invalid scorebug style catalog');
  favoriteStyleCatalog = new Set(styles.map(style => style.id));
}

function cleanFavoriteStyleIds(value) {
  if (!Array.isArray(value)) throw new TypeError('Favorite scorebug styles must be a list');
  if (!favoriteStyleCatalog) {
    if (!value.length) return [];
    throw new Error('Scorebug style catalog is not ready');
  }
  return [...new Set(value.filter(id => typeof id === 'string' && favoriteStyleCatalog.has(id)))];
}

function cleanLeague(value) {
  if (typeof value !== 'string' || !LEAGUE_ID_PATTERN.test(value)) throw new TypeError('Invalid league');
  return value;
}

function cleanGameId(value) {
  if (value !== null && (typeof value !== 'string' || !GAME_ID_PATTERN.test(value))) throw new TypeError('Invalid game ID');
  return value;
}

function cleanFavorites(value) {
  if (!Array.isArray(value) || value.length > 64) throw new TypeError('Choose up to 64 favorite teams');
  const seen = new Set();
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new TypeError('Invalid favorite team');
    const leagueId = cleanLeague(item.leagueId);
    if (typeof item.teamId !== 'string' || !TEAM_ID_PATTERN.test(item.teamId)) throw new TypeError('Invalid favorite team ID');
    if (item.teamId.includes(':') && item.teamId.split(':')[0] !== leagueId) throw new TypeError('Favorite team belongs to a different league');
    if (leagueId === 'nfl' && !/^\d{1,15}$/.test(item.teamId)) throw new TypeError('Invalid NFL favorite team ID');
    if (leagueId !== 'nfl' && !item.teamId.startsWith(`${leagueId}:`)) throw new TypeError('Favorite teams must include their league');
    const key = `${leagueId}/${item.teamId}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const text = (input, limit) => typeof input === 'string' ? input.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, limit) : '';
    const clean = { leagueId, teamId: item.teamId, name: text(item.name, 100), abbreviation: text(item.abbreviation, 16) };
    if (typeof item.color === 'string' && /^#[\da-f]{6}$/i.test(item.color)) clean.color = item.color;
    if (typeof item.logo === 'string' && item.logo.length <= 600) {
      if (LOCAL_LOGO_PATTERN.test(item.logo)) clean.logo = item.logo;
      else try {
        const url = new URL(item.logo);
        if (url.protocol === 'https:' && LOGO_HOSTS.has(url.hostname) && !url.username && !url.password && !url.port && !url.hash) clean.logo = url.href;
      } catch { /* A bad optional image never prevents a team from being saved. */ }
    }
    return [clean];
  });
}

/** Only validated display preferences can cross from the sandboxed renderer. */
function cleanPatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError('Preferences must be an object');
  const clean = {};
  if (Object.hasOwn(patch, 'gameId')) clean.gameId = cleanGameId(patch.gameId);
  if (Object.hasOwn(patch, 'leagueId')) clean.leagueId = cleanLeague(patch.leagueId);
  if (Object.hasOwn(patch, 'styleId')) {
    if (typeof patch.styleId !== 'string' || !STYLE_ID_PATTERN.test(patch.styleId)) throw new TypeError('Invalid scorebug style');
    clean.styleId = patch.styleId;
  }
  if (Object.hasOwn(patch, 'favorites')) clean.favorites = cleanFavorites(patch.favorites);
  if (Object.hasOwn(patch, 'favoriteStyleIds')) clean.favoriteStyleIds = cleanFavoriteStyleIds(patch.favoriteStyleIds);
  if (Object.hasOwn(patch, 'team')) {
    if (patch.team !== null && (typeof patch.team !== 'string' || !/^(?:[A-Z\d]{1,16}|[a-z][a-z0-9.-]{0,39}:[a-zA-Z0-9_-]{1,48})$/.test(patch.team))) throw new TypeError('Invalid team');
    clean.team = patch.team;
  }
  if (Object.hasOwn(patch, 'date')) {
    if (patch.date !== null && (typeof patch.date !== 'string' || !/^\d{8}$/.test(patch.date))) throw new TypeError('Invalid date');
    if (patch.date !== null) {
      const iso = `${patch.date.slice(0, 4)}-${patch.date.slice(4, 6)}-${patch.date.slice(6, 8)}`;
      const parsed = new Date(`${iso}T00:00:00Z`);
      if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== iso) throw new TypeError('Invalid date');
    }
    clean.date = patch.date;
  }
  if (Object.hasOwn(patch, 'scale')) {
    if (typeof patch.scale !== 'number' || !Number.isFinite(patch.scale)) throw new TypeError('Invalid size');
    clean.scale = Math.min(1.8, Math.max(0.65, patch.scale));
  }
  if (Object.hasOwn(patch, 'racingRows')) {
    if (typeof patch.racingRows !== 'number' || !Number.isFinite(patch.racingRows)) throw new TypeError('Invalid driver row count');
    clean.racingRows = Math.min(60, Math.max(3, Math.round(patch.racingRows)));
  }
  if (Object.hasOwn(patch, 'anchor')) {
    if (patch.anchor !== null && !ANCHORS.includes(patch.anchor)) throw new TypeError('Invalid position');
    clean.anchor = patch.anchor;
  }
  for (const key of ['snapEnabled', 'locked', 'autoUpdates', 'styleAuto']) {
    if (Object.hasOwn(patch, key)) {
      if (typeof patch[key] !== 'boolean') throw new TypeError(`Invalid ${key}`);
      clean[key] = patch[key];
    }
  }
  return clean;
}

function cleanDetailsContext(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid game context');
  const gameId = cleanGameId(value.gameId), leagueId = cleanLeague(value.leagueId);
  if (gameId && (gameId.includes(':') ? gameId.split(':')[0] !== leagueId : leagueId !== 'nfl')) throw new TypeError('Game belongs to a different league');
  return { gameId, leagueId };
}

function cleanDetailsRegions(value, viewport) {
  const input = Array.isArray(value) ? { targets: value, panels: {}, styleId: 'nfl-blades', legacyBlades: true } : value;
  if (!input || typeof input !== 'object' || !Array.isArray(input.targets) || input.targets.length > 32) throw new TypeError('Invalid hover regions');
  if (typeof input.styleId !== 'string' || !STYLE_ID_PATTERN.test(input.styleId)) throw new TypeError('Invalid scorebug style');
  const rect = (region) => {
    if (!region || typeof region !== 'object') throw new TypeError('Invalid hover rectangle');
    for (const key of ['x', 'y', 'width', 'height']) if (!Number.isFinite(region[key])) throw new TypeError('Invalid hover rectangle');
    if (region.width <= 0 || region.height <= 0 || region.x < -1 || region.y < -1
      || region.x + region.width > viewport.width + 1 || region.y + region.height > viewport.height + 1) throw new TypeError('Hover rectangle is outside the widget');
    return { x: Math.max(0, region.x), y: Math.max(0, region.y), width: region.width, height: region.height };
  };
  const targets = input.targets.map((region) => {
    if (!region || !['away', 'home', 'comparison'].includes(region.side)) throw new TypeError('Invalid hover target');
    return { ...rect(region), side: region.side };
  });
  const panels = {};
  for (const side of ['away', 'home', 'comparison']) {
    const panel = input.panels?.[side];
    if (!panel) continue;
    panels[side] = rect(panel);
    for (const color of ['fill', 'border', 'ink']) if (typeof panel[color] === 'string' && /^#[\da-f]{6}$/i.test(panel[color])) panels[side][color] = panel[color];
    if (Array.isArray(panel.points) && panel.points.length === 4 && panel.points.every((point) => Array.isArray(point) && point.length === 2
      && point.every(Number.isFinite) && point[0] >= -1 && point[1] >= -1 && point[0] <= viewport.width + 1 && point[1] <= viewport.height + 1)) {
      panels[side].points = panel.points.map((point) => [...point]);
    }
  }
  return { targets, panels, styleId: input.styleId, ...(input.board ? { board: rect(input.board) } : {}),
    ...(typeof input.legacyBlades === 'boolean' ? { legacyBlades: input.legacyBlades && input.styleId === 'nfl-blades' } : {}) };
}

/** Migrate persisted records only; ordinary IPC patches never infer a mode. */
function cleanSavedPreferences(saved) {
  const clean = cleanPatch(saved);
  if (clean.styleId && !Object.hasOwn(saved, 'styleAuto')) clean.styleAuto = false;
  return clean;
}

module.exports = { cleanPatch, cleanSavedPreferences, cleanFavorites, cleanFavoriteStyleIds, setFavoriteStyleCatalog, cleanGameId, cleanLeague, cleanDetailsContext, cleanDetailsRegions };
