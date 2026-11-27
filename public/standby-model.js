import { getLeague, normalizeLeague } from './sports.js';
import { defaultStyleForSport, isScorebugStyle } from './scorebug-styles.js';
import { supportedGameId, leagueOfId, validDate, normalizeRacingRows } from './preferences-model.js';
import { saveUserState } from './user-state-storage.js';

export const STANDBY_STORAGE_KEY = 'scorebug.standby.v1';
export const MAX_STANDBY_SLOTS = 4;

export function normalizeStandbySlot(value = {}, index = 0) {
  const leagueId = normalizeLeague(value?.leagueId);
  return {
    id: typeof value?.id === 'string' && /^slot-[a-z0-9-]{1,48}$/.test(value.id) ? value.id : `slot-${index + 1}`,
    leagueId,
    gameId: supportedGameId(value?.gameId) && leagueOfId(value.gameId) === leagueId ? value.gameId : null,
    date: validDate(value?.date) ? value.date : null,
    styleId: isScorebugStyle(value?.styleId) ? value.styleId : defaultStyleForSport(getLeague(leagueId)?.sport),
    racingRows: normalizeRacingRows(value?.racingRows),
  };
}

export function normalizeStandbyState(value) {
  const slots = (Array.isArray(value?.slots) ? value.slots : []).filter(slot => slot && typeof slot === 'object' && !Array.isArray(slot)).slice(0, MAX_STANDBY_SLOTS).map(normalizeStandbySlot);
  if (!slots.length) slots.push(normalizeStandbySlot());
  const seen = new Set();
  slots.forEach((slot, index) => {
    if (seen.has(slot.id)) { let suffix = index + 1; do { slot.id = `slot-restored-${suffix++}`; } while (seen.has(slot.id)); }
    seen.add(slot.id);
  });
  return { version: 1, slots, dimmed: value?.dimmed === true };
}

export function readStandbyState(storage) {
  try {
    const raw = storage?.getItem(STANDBY_STORAGE_KEY);
    if (raw) return normalizeStandbyState(JSON.parse(raw));
  } catch { /* A damaged saved board can still start from the current game. */ }
  try { return normalizeStandbyState({ slots: [JSON.parse(storage?.getItem('scorebug.preferences.v2') || '{}')] }); }
  catch { return normalizeStandbyState(null); }
}

export function saveStandbyState(storage, state) {
  try { return saveUserState(storage,STANDBY_STORAGE_KEY,JSON.stringify(normalizeStandbyState(state))); }
  catch { return false; }
}

export function standbyFeedKey(slot) { return `${slot.leagueId}/${slot.date || 'current'}`; }
export function standbySelectionKey(slot) { return `${standbyFeedKey(slot)}/${slot.gameId || 'automatic'}`; }

export function seedStandbyFromURL(state, input) {
  const result = normalizeStandbyState(state), url = new URL(input, 'https://scorebug.invalid/');
  const params = url.searchParams;
  if (!['league', 'game', 'style', 'date', 'rows'].some(key => params.has(key))) return result;
  const old = result.slots[0], requestedLeague = params.get('league');
  const requestedGame = params.get('game');
  const leagueId = getLeague(requestedLeague)?.id || (supportedGameId(requestedGame) && getLeague(leagueOfId(requestedGame))?.id) || old.leagueId;
  const changed = leagueId !== old.leagueId;
  result.slots[0] = normalizeStandbySlot({
    ...old,
    leagueId,
    gameId: params.has('game') ? requestedGame : changed ? null : old.gameId,
    date: params.has('date') ? params.get('date') : changed ? null : old.date,
    styleId: isScorebugStyle(params.get('style')) ? params.get('style') : changed ? defaultStyleForSport(getLeague(leagueId).sport) : old.styleId,
    racingRows: params.has('rows') && /^\d{1,2}$/.test(params.get('rows')) ? Number(params.get('rows')) : old.racingRows,
  });
  return result;
}

export function standbyGameURL(slot, game) {
  const params = new URLSearchParams({ league: slot.leagueId, style: slot.styleId });
  const id = game?.id || slot.gameId;
  params.set('game', supportedGameId(id) && leagueOfId(id) === slot.leagueId ? id : '');
  params.set('date', validDate(slot.date) ? slot.date : '');
  params.set('rows', String(slot.racingRows));
  return `/game.html?${params}`;
}
