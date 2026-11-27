const escape = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const aliases = { WAS: 'WSH', JAC: 'JAX', LA: 'LAR' };
const abbreviation = (value) => aliases[String(value).toUpperCase()] || String(value).toUpperCase();

/** Schematic always puts the team with possession attacking to the right.
 * This does not infer the real stadium's camera direction or player positions.
 */
export function fieldSituation(game) {
  if (!game || game.phase !== 'live' || !game.possessionTeamId || !game.fieldPosition) return null;
  const offense = [game.away, game.home].find((team) => String(team?.id) === String(game.possessionTeamId));
  if (!offense) return null;
  const defense = offense === game.away ? game.home : game.away;
  const field = String(game.fieldPosition).trim();
  let progress;
  if (/^(?:50|50\s*(?:YD|YARD)?\s*LINE|MIDFIELD)$/i.test(field)) progress = 50;
  else {
    const match = /^([A-Z]{2,4})\s*(\d{1,2})$/i.exec(field);
    if (!match || Number(match[2]) > 50) return null;
    const team = abbreviation(match[1]);
    if (team === abbreviation(offense.abbreviation)) progress = Number(match[2]);
    else if (team === abbreviation(defense.abbreviation)) progress = 100 - Number(match[2]);
    else return null;
  }
  const distanceMatch = /&\s*(\d{1,2}|GOAL)\b/i.exec(game.downDistance || '');
  const firstDown = distanceMatch ? distanceMatch[1].toUpperCase() === 'GOAL' ? 100 : Math.min(100, progress + Number(distanceMatch[1])) : null;
  return { offense, defense, progress, firstDown, label: field, downDistance: game.downDistance || '' };
}

export function renderField(game) {
  const situation = fieldSituation(game);
  if (!situation) {
    const phase = game?.phase;
    const label = phase === 'final' ? 'FINAL' : phase === 'halftime' ? 'HALFTIME' : phase === 'scheduled' ? 'BEFORE KICKOFF' : 'FIELD POSITION';
    const message = phase === 'final' ? 'The game is over. No live field position.' : phase === 'halftime' ? 'Field position returns when play resumes.' : phase === 'scheduled' ? 'The field updates once play begins.' : 'Waiting for a reported ball position.';
    return `<div class="field-unavailable"><span>${label}</span><p>${message}</p></div>`;
  }
  const { offense, defense, progress, firstDown, label } = situation;
  const x = (yards) => 33 + 3.3 * yards;
  const lines = Array.from({ length: 9 }, (_, index) => {
    const yards = (index + 1) * 10;
    return `<path d="M${x(yards)} 12V88" stroke="#d6e4cd" stroke-opacity=".25" stroke-width=".7"/><text x="${x(yards)}" y="25" text-anchor="middle">${yards <= 50 ? yards : 100 - yards}</text><text x="${x(yards)}" y="80" text-anchor="middle">${yards <= 50 ? yards : 100 - yards}</text>`;
  }).join('');
  const hashes = Array.from({ length: 19 }, (_, index) => { const point = x((index + 1) * 5); return `<path d="M${point} 39v4m0 14v4" stroke="#e0e8d7" stroke-opacity=".4" stroke-width=".8"/>`; }).join('');
  return `<svg class="mini-field" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 396 100" role="img" aria-label="${escape(`${offense.abbreviation} ball at ${label}; schematic shows offense moving right`)}"><rect x="1" y="1" width="394" height="98" rx="5" fill="#233a2a"/><path d="M33 1V99M363 1V99" stroke="#d6e4cd" stroke-opacity=".5"/><text class="endzone" transform="translate(20 51) rotate(-90)" text-anchor="middle">${escape(offense.abbreviation)}</text><text class="endzone" transform="translate(378 51) rotate(90)" text-anchor="middle">${escape(defense.abbreviation)}</text>${lines}${hashes}${firstDown !== null && firstDown !== progress ? `<path d="M${x(firstDown)} 7V93" stroke="#eac15b" stroke-width="2"/>` : ''}<path d="M${x(progress)} 7V93" stroke="#7ec4ec" stroke-width="2.3"/><circle cx="${x(progress)}" cy="50" r="7" fill="#f3eee0"/><path d="M${x(progress) - 3} 50h6m-2-2v4" stroke="#263d2b" stroke-width="1"/></svg>`;
}
