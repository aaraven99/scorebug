import { SCOREBUG_STYLES, isScorebugStyle } from './scorebug-styles.js';
import { normalizeFavoriteStyleIds } from './preferences-model.js';

const sportNames = Object.freeze({ football: 'Football', basketball: 'Basketball', baseball: 'Baseball', hockey: 'Hockey', soccer: 'Soccer', racing: 'Racing', tennis: 'Tennis', cricket: 'Cricket', rugby: 'Rugby', golf: 'Golf', volleyball: 'Volleyball' });

export function toggleFavoriteStyleIds(value, styleId) {
  const ids = normalizeFavoriteStyleIds(value);
  if (!isScorebugStyle(styleId)) return ids;
  return ids.includes(styleId) ? ids.filter(id => id !== styleId) : [...ids, styleId];
}

// Each style appears once in the select. Saved styles move to its first group.
export function styleOptionGroups(value) {
  const ids = normalizeFavoriteStyleIds(value), saved = new Set(ids), groups = new Map();
  const byId = new Map(SCOREBUG_STYLES.map(style => [style.id, style]));
  if (ids.length) groups.set('favorites', { id: 'favorites', label: 'Favorite styles', styles: ids.map(id => byId.get(id)) });
  for (const style of SCOREBUG_STYLES) {
    if (saved.has(style.id)) continue;
    if (!groups.has(style.sport)) groups.set(style.sport, { id: style.sport, label: sportNames[style.sport] || style.sport, styles: [] });
    groups.get(style.sport).styles.push(style);
  }
  return [...groups.values()];
}

export function filterScorebugStyles({ favoriteStyleIds = [], favoritesOnly = false, allSports = true, sport, query = '' } = {}) {
  const saved = new Set(normalizeFavoriteStyleIds(favoriteStyleIds));
  const terms = String(query).trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return SCOREBUG_STYLES.filter(style => {
    if (favoritesOnly && !saved.has(style.id)) return false;
    if (!allSports && style.sport !== sport) return false;
    const text = `${style.name} ${style.network} ${style.sport} ${style.era} ${style.description}`.toLocaleLowerCase();
    return terms.every(term => text.includes(term));
  });
}
