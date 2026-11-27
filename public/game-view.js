import { localTeamLogo } from './team-assets.js';

export const escapeHTML = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const e = escapeHTML;
const list = (value) => Array.isArray(value) ? value : [];
const shown = (value) => value === null || value === undefined || value === '' ? '—' : e(value);
const CORE_STATS = ['totalYards', 'netPassingYards', 'rushingYards', 'thirdDownEff', 'turnovers', 'possessionTime'];

export function teamLabel(team, { full = false } = {}) {
  const logo = localTeamLogo(team);
  return `<span class="team-label">${logo ? `<img src="${e(logo)}" width="24" height="24" alt="">` : ''}<span>${e((full ? team?.name : team?.abbreviation) || '—')}</span></span>`;
}

/** Do not let a slow summary replace a more recent scoreboard play. */
export function latestPlayText(game, summary) {
  const primary = game?.lastPlayDetails, detail = summary?.lastPlay;
  if (!game?.lastPlay) return detail?.text || '';
  if (!detail?.text || !primary) return game.lastPlay;
  if (/^\d+$/.test(primary.id) && /^\d+$/.test(detail.id) && primary.id !== detail.id) return BigInt(detail.id) > BigInt(primary.id) ? detail.text : game.lastPlay;
  if (Number.isFinite(primary.sequenceNumber) && Number.isFinite(detail.sequenceNumber) && primary.sequenceNumber !== detail.sequenceNumber) return detail.sequenceNumber > primary.sequenceNumber ? detail.text : game.lastPlay;
  const a = Date.parse(primary.wallclock), b = Date.parse(detail.wallclock);
  return Number.isFinite(a) && Number.isFinite(b) && b > a ? detail.text : game.lastPlay;
}

export function comparisonMarkup(game, insights, { compact = false } = {}) {
  const raw = list(insights?.rows);
  const core = CORE_STATS.map((key) => raw.find((row) => row.key === key)).filter(Boolean);
  const rows = compact ? core : [...core, ...raw.filter((row) => !CORE_STATS.includes(row.key))];
  if (!rows.length) return '<p class="empty-note">Team comparisons appear when the feed reports game totals.</p>';
  return `<table class="comparison-table"><thead><tr><th scope="col">Stat</th><th scope="col">${teamLabel(game?.away)}</th><th scope="col" class="operator"><span class="sr-only">Comparison</span></th><th scope="col">${teamLabel(game?.home)}</th></tr></thead><tbody>${rows.map((row) => `<tr><th scope="row"${row.note ? ` title="${e(row.note)}"` : ''}>${e(row.label)}${row.direction === 'lower' ? '<span class="lower-note">fewer is better</span>' : ''}</th><td class="${row.betterSide === 'away' ? 'stat-better' : ''}">${shown(row.away)}</td><td class="operator" aria-label="${row.comparison === '>' ? 'greater than' : row.comparison === '<' ? 'less than' : row.comparison === '=' ? 'equal to' : 'not comparable'}">${shown(row.comparison)}</td><td class="${row.betterSide === 'home' ? 'stat-better' : ''}">${shown(row.home)}</td></tr>`).join('')}</tbody></table>`;
}

function metricPair(game, metric, { probability = false } = {}) {
  if (!metric?.available) return `<p class="metric-empty">${e(metric?.tie ? 'Final · tied game' : metric?.reason || 'Waiting for game data.')}</p>`;
  const suffix = probability ? '%' : '';
  const away = Number(metric.away), home = Number(metric.home);
  if (![away, home].every(Number.isFinite)) return '<p class="metric-empty">Waiting for game data.</p>';
  return `<div class="metric-pair"><span>${e(game?.away?.abbreviation || 'Away')} <strong>${away}${suffix}</strong></span><span><strong>${home}${suffix}</strong> ${e(game?.home?.abbreviation || 'Home')}</span></div><div class="metric-meter" aria-hidden="true"><span style="width:${Math.max(0, Math.min(100, away))}%"></span></div>`;
}

export function insightsMarkup(game, insights, { compact = false } = {}) {
  const performance = insights?.performance, prediction = insights?.prediction;
  const result = prediction?.kind === 'result';
  const leaders = list(performance?.drivers).filter((item) => ['away', 'home'].includes(item.side)).slice(0, 2);
  const driverText = leaders.map((item) => `${game?.[item.side]?.abbreviation || item.side}: ${item.label.toLowerCase()}`).join(' · ');
  return `<div class="insight-pair"><section class="insight"><h3>Stat edge${performance?.stale ? ' <span class="delayed">delayed</span>' : ''}</h3>${metricPair(game, performance)}${!compact ? `<p class="metric-note">Relative score out of 100 · ${performance?.coverage?.used || 0} of ${performance?.coverage?.total || 6} measures</p>${driverText ? `<p class="metric-drivers">${e(driverText)}</p>` : ''}` : ''}</section><section class="insight"><h3>${result ? 'Final result' : 'Win estimate'}</h3>${metricPair(game, prediction, { probability: true })}${!compact && prediction?.available ? `<p class="metric-note">${e(prediction.reason)}</p>` : ''}</section></div>${result ? '' : `<p class="estimate-note">${compact ? 'Stat edge is not a probability. Win estimate is a simple, uncalibrated model.' : 'Stat edge compares this game’s totals. The win estimate is a simple, uncalibrated model, led by the score and time remaining. It is not a betting forecast.'}</p>`}${!compact && !result && list(prediction?.drivers).length ? `<ul class="estimate-drivers">${prediction.drivers.map((driver) => `<li>${e(driver.description)}</li>`).join('')}</ul>` : ''}`;
}

export function quarterMarkup(game, summary) {
  const periods = list(summary?.quarterScores);
  if (!periods.length) return '<p class="empty-note">Quarter scores have not been reported.</p>';
  return `<table class="quarter-table"><thead><tr><th scope="col"><span class="sr-only">Team</span></th>${periods.map((q) => `<th scope="col">${e(q.label)}</th>`).join('')}<th scope="col">Total</th></tr></thead><tbody>${['away', 'home'].map((side) => `<tr><th scope="row">${teamLabel(game?.[side])}</th>${periods.map((q) => `<td>${shown(q[side])}</td>`).join('')}<td><strong>${shown(game?.[side]?.score)}</strong></td></tr>`).join('')}</tbody></table>`;
}

export function periodClock(period, clock) {
  const p = Number(period);
  return [p > 4 ? (p === 5 ? 'OT' : `OT${p - 4}`) : p > 0 ? `Q${p}` : '', clock].filter(Boolean).join(' · ');
}
const playKind = (play) => play.isNoPlay ? 'No play' : play.scoringPlay ? (play.scoringType || play.type || 'Score').replaceAll('-', ' ') : play.isTurnover ? 'Turnover' : '';

export function playsMarkup(plays, game, { scoring = false } = {}) {
  if (!list(plays).length) return `<p class="empty-note">${scoring ? 'No scoring plays have been reported.' : 'Play-by-play appears when the feed provides it.'}</p>`;
  return `<ol class="play-list">${plays.map((play) => {
    const team = [game?.away, game?.home].find((item) => item && String(item.id) === String(play.scoringTeamId || play.teamId));
    const position = play.start?.downDistance ? [play.start.downDistance, play.start.fieldPosition].filter(Boolean).join(' · ') : play.start?.fieldPosition;
    const kind = playKind(play);
    const scores = play.scoringPlay && play.scores ? `${game?.away?.abbreviation || 'Away'} ${play.scores.away ?? '—'} – ${play.scores.home ?? '—'} ${game?.home?.abbreviation || 'Home'}` : '';
    return `<li data-play-id="${e(play.id)}" class="${play.scoringPlay ? 'scoring-play' : play.isTurnover ? 'turnover-play' : ''}"><div class="play-meta"><span>${e(periodClock(play.period, play.clock))}${team ? ` · ${e(team.abbreviation)}` : ''}</span>${kind ? `<strong>${e(kind)}</strong>` : ''}</div>${position ? `<p class="play-position">${e(position)}</p>` : ''}<p>${e(play.text || 'Play details unavailable.')}</p>${scores ? `<div class="play-score">${e(scores)}</div>` : ''}</li>`;
  }).join('')}</ol>`;
}

export function drivesMarkup(drives, game) {
  if (!list(drives).length) return '<p class="empty-note">Drive summaries have not been reported.</p>';
  return `<table class="drive-table"><thead><tr><th scope="col">Team / start</th><th scope="col">Drive</th><th scope="col">Result</th></tr></thead><tbody>${drives.map((drive) => {
    const team = [game?.away, game?.home].find((item) => item && String(item.id) === String(drive.teamId));
    const detail = drive.description || [Number.isFinite(drive.plays) ? `${drive.plays} plays` : '', Number.isFinite(drive.yards) ? `${drive.yards} yards` : '', drive.timeElapsed].filter(Boolean).join(' · ');
    return `<tr><th scope="row">${e(team?.abbreviation || '—')}<small>${e(periodClock(drive.start?.period, drive.start?.clock))}</small></th><td>${e(detail || '—')}<small>${e([drive.start?.fieldPosition, drive.end?.fieldPosition].filter(Boolean).join(' → '))}</small></td><td>${e(drive.isActive ? 'In progress' : drive.result || '—')}</td></tr>`;
  }).join('')}</tbody></table>`;
}

export function playerStatsMarkup(groups, game) {
  if (!list(groups).length) return '<p class="empty-note">Player box scores have not been reported by this feed.</p>';
  return groups.map((group) => `<section class="player-category"><h3>${e(group.label)}</h3><div class="table-scroll" tabindex="0" aria-label="${e(group.label)} player statistics"><table><thead><tr><th scope="col">Player</th>${list(group.columns).map((col) => `<th scope="col" title="${e(col.description || col.label)}">${e(col.label)}</th>`).join('')}</tr></thead>${['away', 'home'].map((side) => {
    const entries = list(group[side]?.athletes), cols = list(group.columns);
    return `<tbody><tr class="player-team"><th colspan="${cols.length + 1}" scope="colgroup">${teamLabel(game?.[side], { full: true })}</th></tr>${entries.length ? entries.map((entry) => `<tr><th scope="row">${e(entry.player?.name || 'Unknown player')}</th>${cols.map((_, index) => `<td>${shown(entry.values?.[index])}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${cols.length + 1}" class="empty-note">No player totals reported.</td></tr>`}${list(group[side]?.totals).some((v) => v !== null) ? `<tr class="player-total"><th scope="row">Team total</th>${cols.map((_, index) => `<td>${shown(group[side].totals[index])}</td>`).join('')}</tr>` : ''}</tbody>`;
  }).join('')}</table></div></section>`).join('');
}

export function gameInfoMarkup(game, summary) {
  const info = summary?.gameInfo || {}, venue = info.venue;
  const time = new Date(info.startTime || game?.startTime || '');
  const weather = info.weather;
  const rawUnit = String(weather?.unit || '').replace(/^°/, '').toLowerCase();
  const unit = ['f', 'fahrenheit'].includes(rawUnit) ? '°F' : ['c', 'celsius'].includes(rawUnit) ? '°C' : weather?.unit ? ` ${weather.unit}` : ' (unit not supplied)';
  const rows = [
    ['Kickoff', Number.isFinite(time.getTime()) ? time.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : null],
    ['Venue', [venue?.name || game?.venue, venue?.city, venue?.state].filter(Boolean).join(', ')],
    ['Broadcast', list(info.broadcasts).join(', ') || game?.broadcast],
    ['Season', [info.season?.year, info.season?.label, info.week ? `Week ${info.week}` : null].filter(Boolean).join(' · ')],
    ['Attendance', Number.isFinite(info.attendance) ? info.attendance.toLocaleString() : null],
    ['Weather', weather ? [weather.summary, Number.isFinite(weather.temperature) ? `${weather.temperature}${unit}` : null].filter(Boolean).join(' · ') : null],
  ];
  if (!rows.some(([, value]) => value) && !list(info.officials).length) return '';
  return `<dl class="game-info">${rows.filter(([, value]) => value).map(([name, value]) => `<div><dt>${e(name)}</dt><dd>${e(value)}</dd></div>`).join('')}</dl>${list(info.officials).length ? `<p class="officials"><strong>Officials</strong> ${info.officials.map((official) => `${e(official.name)}${official.position ? ` (${e(official.position)})` : ''}`).join(' · ')}</p>` : ''}`;
}

/** Keep reading position stable while live data updates the surrounding page. */
export function updateMarkup(element, html) {
  if (!element || element.__scorebugMarkup === html) return false;
  const scrollTop = element.scrollTop, scrollLeft = element.scrollLeft;
  const oldAnchor = scrollTop > 24 ? [...element.querySelectorAll('[data-play-id]')].find((node) => node.getBoundingClientRect().bottom > element.getBoundingClientRect().top) : null;
  const anchorId = oldAnchor?.dataset.playId, anchorTop = oldAnchor?.getBoundingClientRect().top;
  const innerScroll = [...element.querySelectorAll('.table-scroll')].map((node) => ({ top: node.scrollTop, left: node.scrollLeft }));
  element.innerHTML = html; element.__scorebugMarkup = html;
  element.scrollTop = scrollTop; element.scrollLeft = scrollLeft;
  if (anchorId) {
    const anchor = [...element.querySelectorAll('[data-play-id]')].find((node) => node.dataset.playId === anchorId);
    if (anchor) element.scrollTop += anchor.getBoundingClientRect().top - anchorTop;
  }
  [...element.querySelectorAll('.table-scroll')].forEach((node, index) => { node.scrollTop = innerScroll[index]?.top || 0; node.scrollLeft = innerScroll[index]?.left || 0; });
  return true;
}
