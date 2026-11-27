/** Classic broadcast scorebug. All game text is treated as untrusted data. */
import { localTeamLogo, teamLogoPresentation } from './team-assets.js';
import { getScorebugStyle } from './scorebug-styles.js';
import { renderStyledScorebug } from './scorebug-variants.js';
import { sportFor } from './sports.js';
export { SCOREBUG_DIMENSIONS, scorebugDimensions } from './scorebug-layout.js';

let nextId = 0;

const escape = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

function color(value, fallback = '#24394a') {
  const candidate = String(value ?? '').replace(/^#/, '');
  return /^[\da-f]{6}$/i.test(candidate) ? `#${candidate}` : fallback;
}

function mix(hex, toward, amount) {
  const source = hex.slice(1).match(/.{2}/g).map((part) => parseInt(part, 16));
  return `#${source.map((channel) => Math.round(channel + (toward - channel) * amount).toString(16).padStart(2, '0')).join('')}`;
}

export function teamColor(team, side) {
  return (!team.leagueId || team.leagueId === 'nfl') && (!team.sport || team.sport === 'football') && String(team.abbreviation).toUpperCase() === 'SF' ? '#b3995d' : color(team.color, side === 'home' ? '#c51636' : '#24394a');
}

function luminance(hex) {
  const channels = hex.slice(1).match(/.{2}/g).map((part) => {
    const channel = parseInt(part, 16) / 255;
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  });
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}

/** One solid team paint shared by the score panel and its expanded stats. */
export function teamPalette(team, side) {
  const fill = teamColor(team, side), light = '#fffef5', dark = '#080c08';
  const background = luminance(fill);
  const contrast = (ink) => {
    const value = luminance(ink);
    return (Math.max(background, value) + .05) / (Math.min(background, value) + .05);
  };
  return { fill, border: mix(fill, 0, .32), ink: contrast(light) >= contrast(dark) ? light : dark };
}

// Retained for older consumers; the current panels use teamPalette's solid fill.
export function teamGradientStops(team, side) {
  const base = teamColor(team, side);
  return [
    { offset: '0', color: mix(base, 255, .23) },
    { offset: '.37', color: mix(base, 255, .045) },
    { offset: '.58', color: base },
    { offset: '1', color: mix(base, 0, .28) },
  ];
}

function score(value) {
  if (value === null || value === undefined || value === '') return '–';
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number < 1000 ? String(number) : '–';
}

function logoImage(team, centerX, centerY, maxWidth, maxHeight) {
  const href = localTeamLogo(team);
  if (!href) return '';
  const { size, bounds, outline } = teamLogoPresentation(team);
  const [left, top, right, bottom] = bounds;
  const scale = Math.min(maxWidth / (right - left), maxHeight / (bottom - top));
  const x = centerX - (left + right) / 2 * scale;
  const y = centerY - (top + bottom) / 2 * scale;
  return `<image class="bug-team-logo${outline ? ' bug-team-logo--contrast' : ''}" href="${escape(href)}" x="${x}" y="${y}" width="${size[0] * scale}" height="${size[1] * scale}" preserveAspectRatio="xMidYMid meet"/>`;
}

function teamLogo(team, side) {
  const center = side === 'away' ? 110 : 488;
  return logoImage(team, center, 46, 106, 62)
    || `<text class="bug-abbreviation" x="${center}" y="59" text-anchor="middle">${escape(team.abbreviation || '—')}</text>`;
}

function scoreNumber(value, centerX, baseline, vertical = false) {
  const className = `bug-score${vertical ? ' bug-vertical-score' : ''}${value.length > 2 ? (vertical ? ' bug-vertical-score--long' : ' bug-score--long') : ''}`;
  // The compressed italic glyphs need a different shear for each panel angle:
  // about 12 degrees across the bottom, and 4.8 degrees in the side layout.
  const shear = vertical ? 3.2 : -4.4;
  return `<text class="${className}" x="0" y="0" text-anchor="middle" transform="translate(${centerX} ${baseline}) skewX(${shear}) scale(.78 1)">${value}</text>`;
}

function quarter(period) {
  const value = Number(period);
  if (value > 4) return value === 5 ? 'OT' : `${value - 4}OT`;
  return ['', '1ST', '2ND', '3RD', '4TH'][value] || 'LIVE';
}

function kickoff(startTime) {
  const date = startTime ? new Date(startTime) : new Date(NaN);
  if (!Number.isFinite(date.getTime())) return 'SCHEDULED';
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(date);
  const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(date);
  return `${weekday} · ${time}`.toUpperCase();
}

function strip(game) {
  const phase = game.phase || (game.state === 'in' ? 'live' : game.state === 'post' ? 'final' : 'scheduled');
  const statusName = String(game.statusName || '').toUpperCase();
  if (phase === 'halftime' || statusName.includes('HALFTIME')) return { banner: 'HALFTIME' };
  if (phase === 'intermission' || statusName.includes('END_PERIOD')) return { banner: `END ${quarter(game.period)}` };
  if (['delayed', 'postponed', 'suspended', 'canceled', 'cancelled'].includes(phase)) return { banner: phase.toUpperCase() };
  if (phase === 'final' || game.state === 'post') return { banner: Number(game.period) > 4 ? 'FINAL / OT' : 'FINAL' };
  if (phase === 'scheduled' || game.state === 'pre') return { banner: kickoff(game.startTime) };
  if (phase !== 'live' && game.state !== 'in') return { banner: 'AWAITING GAME DATA' };
  return {
    period: quarter(game.period),
    clock: /^\d{1,2}:[0-5]\d$/.test(String(game.clock)) ? String(game.clock) : '–:––',
    down: String(game.downDistance || '').trim().toUpperCase().slice(0, 20),
    fieldPosition: typeof game.fieldPosition === 'string' ? game.fieldPosition.trim().toUpperCase().slice(0, 14) : '',
  };
}

function hasPossession(game, team) {
  const live = game?.phase === 'live' || (!game?.phase && game?.state === 'in');
  return live && team.id != null && game?.possessionTeamId != null && String(game.possessionTeamId) === String(team.id);
}

function possession(x, y, scale = 1) {
  return `<g class="bug-possession" transform="translate(${x} ${y}) rotate(-20) scale(${scale})" role="img" aria-label="Has possession">
    <path d="M-18 0Q-9-12 0-10Q9-12 18 0Q9 12 0 10Q-9 12-18 0Z" fill="#f8f0df" stroke="#30291e" stroke-width="1.4"/>
    <path d="M-11-6Q-7 0-11 6M11-6Q7 0 11 6" fill="none" stroke="#89694b" stroke-width="2.2"/>
    <path d="M-5 0H5M-3-2.5V2.5M0-2.5V2.5M3-2.5V2.5" fill="none" stroke="#5b422e" stroke-width="1.5" stroke-linecap="round"/>
  </g>`;
}

function timeoutCount(team) {
  return Number.isInteger(team.timeouts) && team.timeouts >= 0 && team.timeouts <= 3 ? team.timeouts : null;
}

function timeouts(team, { side, id, vertical = false, top = 0 }) {
  const remaining = timeoutCount(team);
  const label = `${team.name || team.abbreviation || 'Team'}: ${remaining === null ? 'timeouts unavailable' : `${remaining} ${remaining === 1 ? 'timeout' : 'timeouts'} remaining`}`;
  // Both timeout rails follow the same slope as their panel's outside edge.
  const width = vertical ? 3.4 : 4.5;
  const inset = vertical ? 3 : 3.4;
  const edgeStart = vertical ? (side === 'away' ? 17 : 159) : (side === 'away' ? 30 : 595);
  const edgeSlope = vertical ? 1 / 12 : 3 / 14;
  const edgeTop = vertical ? 2 : 4;
  const railX = (y) => edgeStart - (y - edgeTop) * edgeSlope + (side === 'away' ? inset : -inset - width);
  const rounded = (value) => Number(value.toFixed(3));
  const firstY = vertical ? 18 : 13, step = vertical ? 23 : 25, height = vertical ? 14 : 18;
  const segment = (index) => {
    const y = firstY + index * step, bottom = y + height;
    const x1 = railX(y), x2 = railX(bottom);
    return `M${rounded(x1)} ${top + y}H${rounded(x1 + width)}L${rounded(x2 + width)} ${top + bottom}H${rounded(x2)}Z`;
  };
  const unknownY = vertical ? 49.5 : 47;
  const unknownX = railX(unknownY) + width / 2 + (side === 'away' ? 1.7 : -1.7);
  return `<g class="bug-timeouts bug-timeouts--${side}${remaining === null ? ' bug-timeouts--unknown' : ''}" role="img" aria-label="${escape(label)}" data-timeouts="${remaining === null ? 'unknown' : remaining}"><title>${escape(label)}</title>
    ${remaining === null
      ? `<text class="bug-timeout-unknown" x="${rounded(unknownX)}" y="${top + unknownY + 5}" text-anchor="middle" aria-hidden="true">?</text>`
      : Array.from({ length: 3 }, (_, index) => `<path class="bug-timeout${index < remaining ? ' bug-timeout--available' : ' bug-timeout--used'}" d="${segment(index)}"${index < remaining ? ` fill="url(#${id}-timeout)"` : ''} aria-hidden="true"/>`).join('')}
  </g>`;
}

function timeoutPaint(id) {
  return `<linearGradient id="${id}-timeout" x1="0" y1="0" x2="1" y2=".12"><stop offset="0" stop-color="#b8c1b4"/><stop offset=".22" stop-color="#fffef5"/><stop offset=".68" stop-color="#fffef5"/><stop offset="1" stop-color="#a4afa3"/></linearGradient>`;
}

function teamGroupStart(team, side) {
  const { fill, border, ink } = teamPalette(team, side);
  return `<g class="bug-team bug-team--${side}" data-team-side="${side}" data-team-id="${escape(team.id ?? '')}" data-team-fill="${fill}" data-team-border="${border}" data-team-ink="${ink}">`;
}

function teamTarget(team, side, paths, clipId) {
  const label = `${team.name || team.abbreviation || (side === 'away' ? 'Away team' : 'Home team')} team stats`;
  const count = timeoutCount(team);
  const description = `${score(team.score)} points. ${count === null ? 'Timeouts unavailable.' : `${count} ${count === 1 ? 'timeout' : 'timeouts'} remaining.`}`;
  return `<g class="bug-details-target bug-details-target--team" data-details-side="${side}" role="button" tabindex="0" aria-label="${escape(label)}" aria-description="${escape(description)}" aria-haspopup="dialog" aria-expanded="false" clip-path="url(#${clipId})"><title>${escape(label)}</title>${paths.map((path) => `<path class="bug-hover-region" d="${path}"/>`).join('')}</g>`;
}

function comparisonTarget(path, clipId) {
  return `<g class="bug-details-target bug-details-target--comparison" data-details-side="comparison" role="button" tabindex="0" aria-label="Compare team statistics and win estimate" aria-haspopup="dialog" aria-expanded="false" clip-path="url(#${clipId})"><title>Compare team statistics</title><path class="bug-hover-region" d="${path}"/></g>`;
}

/**
 * Render one self-contained SVG. Team groups expose data-team-side and
 * data-team-id for team-specific details. The feed clock stays centered;
 * neither a simulated game clock nor an unreliable play clock is shown.
 * Head-to-head viewBoxes: horizontal 600×138; vertical 160×290. Racing height
 * grows with racingRows; scorebugDimensions returns the shared layout size.
 * Status flags add
 * 24 or 19 units respectively above the same, unmoved panel coordinates.
 * Top-docked widgets can place that badge space below with statusPosition.
 */
export function renderScorebug(game, options = {}) {
  const style = getScorebugStyle(options.styleId);
  if (style.id !== 'nfl-blades' || sportFor(game) !== 'football') return renderStyledScorebug(game, { ...options, idPrefix: options.idPrefix || `variant-${++nextId}` }, style, { teamPalette, logoImage, possession });
  if (options.orientation === 'vertical') return renderVerticalScorebug(game, options);
  const { stale = false, demo = false, showTimeouts = true, interactive = true } = options;
  const id = String(options.idPrefix || `scorebug-${++nextId}`).replace(/[^a-zA-Z0-9_-]/g, '') || `scorebug-${++nextId}`;
  const away = { ...game?.away, ...(game?.leagueId ? { leagueId: game.leagueId, sport: 'football' } : {}) }, home = { ...game?.home, ...(game?.leagueId ? { leagueId: game.leagueId, sport: 'football' } : {}) };
  const awayScore = score(away.score), homeScore = score(home.score);
  const bottom = game ? strip(game) : { banner: 'SELECT A GAME' };
  const badge = stale ? 'FEED DELAYED' : demo ? 'DESIGN PREVIEW' : '';
  const badgeBelow = options.statusPosition === 'below';
  const title = [
    `${away.name || away.abbreviation || 'Away'} ${awayScore}, ${home.name || home.abbreviation || 'Home'} ${homeScore}.`,
    bottom.banner || `${bottom.period}, ${bottom.clock}${bottom.down ? `, ${bottom.down}` : ''}${bottom.fieldPosition ? `, ball at ${bottom.fieldPosition}` : ''}.`,
    stale ? 'Score updates are delayed. Showing the last received data.' : '',
    demo ? 'Design preview. These are sample scores, not a live game.' : '',
  ].filter(Boolean).join(' ');
  const awayPath = 'M30 4H303L285 88H12Z';
  const homePath = 'M308 4H595L577 88H290Z';
  // Continue both outside edges through the 5-unit gap. All four edges use
  // the upper panels' 3/14 slope instead of giving the footer its own angle.
  const stripPath = 'M10.928571 93H575.928571L566.714286 136H1.714286Z';
  const awayPaint = teamPalette(away, 'away'), homePaint = teamPalette(home, 'home');

  return `<svg xmlns="http://www.w3.org/2000/svg" class="scorebug${stale ? ' scorebug--stale' : ''}" data-game-id="${escape(game?.id ?? '')}" data-league-id="${escape(game?.leagueId || 'nfl')}" data-style-id="nfl-blades" data-sport="football" data-orientation="horizontal" data-artwork-width="600" data-artwork-height="138"${badgeBelow ? ' data-status-position="below"' : ''} viewBox="0 ${badge && !badgeBelow ? '-24' : '0'} 600 ${badge ? '162' : '138'}" role="group" aria-labelledby="${id}-title ${id}-description">
  <title id="${id}-title">${escape(title)}</title>
  <desc id="${id}-description">Classic football scorebug. Away team on the left, home team on the right. ${bottom.banner ? 'Game status appears beneath the scores.' : 'Quarter and ball position at left, game clock in the center, and down and distance at right.'} A football marks possession. Three marks along each team's outer edge show timeouts: bright means remaining, dim means used, and a question mark means unavailable.</desc>
  <defs>${timeoutPaint(id)}<clipPath id="${id}-away-clip"><path d="${awayPath}"/></clipPath><clipPath id="${id}-home-clip"><path d="${homePath}"/></clipPath><clipPath id="${id}-strip-clip"><path d="${stripPath}"/></clipPath></defs>
  ${badge ? `<g class="bug-status-flag"${badgeBelow ? ' transform="translate(0 162)"' : ''}><path d="M25-22H${stale ? '202' : '224'}L${stale ? '198' : '220'}-4H21Z" fill="${stale ? '#b95518' : '#283739'}"/><text x="34" y="-8">${badge}</text></g>` : ''}
  ${teamGroupStart(away, 'away')}
    <path class="bug-team-panel" d="${awayPath}" fill="${awayPaint.fill}" stroke="${awayPaint.border}"/>
    <g class="bug-team-contents" clip-path="url(#${id}-away-clip)">${teamLogo(away, 'away')}${scoreNumber(awayScore, 241, 70)}${hasPossession(game, away) ? possession(185, 46, .8) : ''}${showTimeouts ? timeouts(away, { side: 'away', id }) : ''}</g>
    ${interactive ? teamTarget(away, 'away', ['M30 4H171V88H12Z'], `${id}-away-clip`) : ''}
  </g>
  ${teamGroupStart(home, 'home')}
    <path class="bug-team-panel" d="${homePath}" fill="${homePaint.fill}" stroke="${homePaint.border}"/>
    <g class="bug-team-contents" clip-path="url(#${id}-home-clip)">${teamLogo(home, 'home')}${scoreNumber(homeScore, 349, 70)}${hasPossession(game, home) ? possession(413, 46, .8) : ''}${showTimeouts ? timeouts(home, { side: 'home', id }) : ''}</g>
    ${interactive ? teamTarget(home, 'home', ['M435 4H595L577 88H435Z'], `${id}-home-clip`) : ''}
  </g>
  <path class="bug-situation-panel" d="${stripPath}" fill="#101b16"/>
  ${bottom.banner
    ? `<text class="bug-banner" x="293" y="123" text-anchor="middle">${escape(bottom.banner)}</text>`
    : `<text class="bug-quarter" x="34" y="123">${escape(bottom.period)}</text>
       <g class="bug-field-position" aria-label="${escape(bottom.fieldPosition ? `Ball at ${bottom.fieldPosition}` : 'Ball position unavailable')}"><text class="bug-field-label" x="167" y="105" text-anchor="middle">BALL</text><text class="bug-field-value${bottom.fieldPosition.length > 8 ? ' bug-field-value--long' : ''}" x="167" y="125" text-anchor="middle">${escape(bottom.fieldPosition || '—')}</text></g>
       <text class="bug-clock" x="292" y="124" text-anchor="middle">${escape(bottom.clock)}</text>
       <text class="bug-down${bottom.down.length > 12 ? ' bug-down--long' : ''}${bottom.down ? '' : ' bug-down--unavailable'}" x="551" y="123" text-anchor="end" aria-label="${escape(bottom.down ? `Down and distance: ${bottom.down}` : 'Down and distance unavailable')}">${escape(bottom.down || 'DOWN —')}</text>`}
  ${interactive ? comparisonTarget('M228 94H358V135H228Z', `${id}-strip-clip`) : ''}
  </svg>`;
}

function renderVerticalScorebug(game, options) {
  const { stale = false, demo = false, showTimeouts = true, interactive = true } = options;
  const id = String(options.idPrefix || `vertical-${++nextId}`).replace(/[^a-zA-Z0-9_-]/g, '') || `vertical-${++nextId}`;
  const away = { ...game?.away, ...(game?.leagueId ? { leagueId: game.leagueId, sport: 'football' } : {}) }, home = { ...game?.home, ...(game?.leagueId ? { leagueId: game.leagueId, sport: 'football' } : {}) };
  const bottom = game ? strip(game) : { banner: 'SELECT GAME' };
  const badge = stale ? 'FEED DELAYED' : demo ? 'DESIGN PREVIEW' : '';
  const badgeBelow = options.statusPosition === 'below';
  const title = `${away.name || 'Away'} ${score(away.score)}, ${home.name || 'Home'} ${score(home.score)}. ${bottom.banner || `${bottom.period}, ${bottom.clock}, ${bottom.down}${bottom.fieldPosition ? `, ball at ${bottom.fieldPosition}` : ''}`}.${stale ? ' Feed delayed; last received data.' : ''}${demo ? ' Design preview, not live.' : ''}`;
  const panelPath = (top) => `M17 ${top + 2}H159L151 ${top + 98}H9Z`;
  const stripPath = 'M8.583333 206H150.583333L143.75 288H1.75Z';
  const panels = [away, home].map((team, index) => {
    const top = index * 103, side = index ? 'home' : 'away';
    // Three separate cells follow the panel's slanted centerline. The logo's
    // visible artwork ends at 37, the football has its own lane at 50, and every
    // score (including 100+) shares the same size and baseline below that lane.
    const logo = logoImage(team, 86, top + 22, 104, 30), value = score(team.score), paint = teamPalette(team, side);
    const targets = [`M28 ${top + 4}H145V${top + 40}H28Z`, side === 'away' ? 'M17 2H29L21 98H9Z' : 'M147 105H159L151 201H139Z'];
    return `${teamGroupStart(team, side)}<path class="bug-team-panel" d="${panelPath(top)}" fill="${paint.fill}" stroke="${paint.border}"/>
      <g class="bug-team-contents" clip-path="url(#${id}-${side}-clip)">
      ${logo || `<text class="bug-vertical-abbreviation" x="86" y="${top + 31}" text-anchor="middle">${escape(team.abbreviation || 'NFL')}</text>`}
      ${scoreNumber(value, 80, top + 93, true)}
      ${hasPossession(game, team) ? possession(84, top + 50, .55) : ''}${showTimeouts ? timeouts(team, { side, id, vertical: true, top }) : ''}</g>${interactive ? teamTarget(team, side, targets, `${id}-${side}-clip`) : ''}</g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" class="scorebug scorebug--vertical${stale ? ' scorebug--stale' : ''}" data-game-id="${escape(game?.id ?? '')}" data-league-id="${escape(game?.leagueId || 'nfl')}" data-style-id="nfl-blades" data-sport="football" data-orientation="vertical" data-artwork-width="160" data-artwork-height="290"${badgeBelow ? ' data-status-position="below"' : ''} viewBox="0 ${badge && !badgeBelow ? '-19' : '0'} 160 ${badge ? '309' : '290'}" role="group" aria-labelledby="${id}-title ${id}-description">
    <title id="${id}-title">${escape(title)}</title><desc id="${id}-description">Away team above home team. A football marks possession. Timeout marks follow the away team's left edge and the home team's right edge: bright means remaining, dim means used, and a question mark means unavailable. The centered game clock, down and distance, and ball position appear below.</desc>
    <defs>${timeoutPaint(id)}<clipPath id="${id}-away-clip"><path d="${panelPath(0)}"/></clipPath><clipPath id="${id}-home-clip"><path d="${panelPath(103)}"/></clipPath><clipPath id="${id}-strip-clip"><path d="${stripPath}"/></clipPath></defs>
    ${badge ? `<g class="bug-status-flag"${badgeBelow ? ' transform="translate(0 309)"' : ''}><path d="M10-17H159L157-2H8Z" fill="${stale ? '#b95518' : '#283739'}"/><text x="80" y="-6" text-anchor="middle" style="font-size:9px;letter-spacing:.6px">${badge}</text></g>` : ''}
    ${panels}<path class="bug-situation-panel" d="${stripPath}" fill="#101b16"/>
    ${bottom.banner ? `<text class="bug-vertical-banner${bottom.banner.length > 14 ? ' bug-vertical-banner--long' : ''}" x="76" y="250" text-anchor="middle">${escape(bottom.banner)}</text>` : `<text class="bug-vertical-quarter" x="76" y="224" text-anchor="middle">${escape(bottom.period)}</text><text class="bug-vertical-clock" x="76" y="249" text-anchor="middle">${escape(bottom.clock)}</text><text class="bug-vertical-down${bottom.down.length > 12 ? ' bug-vertical-down--long' : ''}${bottom.down ? '' : ' bug-vertical-down--unavailable'}" x="76" y="270" text-anchor="middle" aria-label="${escape(bottom.down ? `Down and distance: ${bottom.down}` : 'Down and distance unavailable')}">${escape(bottom.down || 'DOWN —')}</text><text class="bug-vertical-field" x="76" y="284" text-anchor="middle" aria-label="${escape(bottom.fieldPosition ? `Ball at ${bottom.fieldPosition}` : 'Ball position unavailable')}">BALL ${escape(bottom.fieldPosition || '—')}</text>`}
    ${interactive ? comparisonTarget('M22 228H135V254H22Z', `${id}-strip-clip`) : ''}
  </svg>`;
}
