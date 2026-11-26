/** Classic broadcast scorebug. All game text is treated as untrusted data. */
import { localTeamLogo } from './team-assets.js';

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

function score(value) {
  if (value === null || value === undefined || value === '') return '–';
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number < 1000 ? String(number) : '–';
}

function teamLogo(team, side) {
  const abbreviation = String(team.abbreviation || '').toUpperCase();
  const href = localTeamLogo(team);
  if (!href) {
    return `<text class="bug-abbreviation" x="${side === 'away' ? 99 : 498}" y="51" text-anchor="middle">${escape(abbreviation || '—')}</text>`;
  }

  // The reference uses wide, tightly fitted SF/KC marks. ESPN's source files
  // include transparent square margins, so these viewports remove that padding.
  const geometry = abbreviation === 'SF' || abbreviation === 'CHI'
    ? { width: 144, height: 112, y: -20 }
    : abbreviation === 'KC'
      ? { width: 154, height: 108, y: -19 }
      : abbreviation === 'DET'
        ? { width: 106, height: 92, y: -10 }
        : { width: 88, height: 76, y: -2 };
  const center = side === 'away' ? 99 : 498;
  return `<image class="bug-team-logo" href="${escape(href)}" x="${center - geometry.width / 2}" y="${geometry.y}" width="${geometry.width}" height="${geometry.height}" preserveAspectRatio="xMidYMid meet"/>`;
}

function quarter(period) {
  const value = Number(period);
  if (value > 4) return value === 5 ? 'OT' : `${value - 4}OT`;
  return ['', '1ST', '2ND', '3RD', '4TH'][value] || 'LIVE';
}

function kickoff(startTime) {
  const date = new Date(startTime);
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
    clock: /^\d{1,2}:\d{2}$/.test(String(game.clock)) ? String(game.clock) : '–:––',
    down: String(game.downDistance || '').toUpperCase().slice(0, 20),
  };
}

function possession(x) {
  return `<g class="bug-possession" transform="translate(${x} 36) rotate(-26)"><path d="M-9 0Q-3-6 9 0Q3 6-9 0Z" fill="#fff"/><path d="M-4 0H4M-2-2V2M1-2V2" stroke="#6d6b63" stroke-width="1"/></g>`;
}

function timeouts(team, side) {
  if (!Number.isInteger(team.timeouts) || team.timeouts < 0 || team.timeouts > 3) return '';
  const start = side === 'away' ? 183 : 367;
  return `<g class="bug-timeouts" aria-label="${team.timeouts} timeouts remaining">${Array.from({ length: 3 }, (_, index) => `<path d="M${start + index * 12} 65h8" stroke="${index < team.timeouts ? '#fff' : '#ffffff30'}" stroke-width="3"/>`).join('')}</g>`;
}

/**
 * Render one self-contained SVG. Game data is normalized by /api/scoreboard.
 * The game clock is a feed snapshot; there is deliberately no simulated clock
 * and no play-clock cell because ESPN does not supply a reliable play clock.
 */
export function renderScorebug(game, options = {}) {
  if (options.orientation === 'vertical') return renderVerticalScorebug(game, options);
  const { stale = false, demo = false, showTimeouts = false } = options;
  const id = String(options.idPrefix || `scorebug-${++nextId}`).replace(/[^a-zA-Z0-9_-]/g, '') || `scorebug-${++nextId}`;
  const away = game?.away || {};
  const home = game?.home || {};
  const awayScore = score(away.score);
  const homeScore = score(home.score);
  const awayColor = away.abbreviation === 'SF' ? '#b3995d' : color(away.color);
  const homeColor = home.abbreviation === 'SF' ? '#b3995d' : color(home.color, '#c51636');
  const bottom = game ? strip(game) : { banner: 'SELECT A GAME' };
  const badge = stale ? 'FEED DELAYED' : demo ? 'DESIGN PREVIEW' : '';
  const title = [
    `${away.name || away.abbreviation || 'Away'} ${awayScore}, ${home.name || home.abbreviation || 'Home'} ${homeScore}.`,
    bottom.banner || `${bottom.period}, ${bottom.clock}${bottom.down ? `, ${bottom.down}` : ''}.`,
    stale ? 'Score updates are delayed. Showing the last received data.' : '',
    demo ? 'Design preview. These are sample scores, not a live game.' : '',
  ].filter(Boolean).join(' ');
  const validPossession = game?.phase === 'live' || (!game?.phase && game?.state === 'in');
  const awayPossession = validPossession && away.id != null && String(game.possessionTeamId) === String(away.id);
  const homePossession = validPossession && home.id != null && String(game.possessionTeamId) === String(home.id);
  const scoreClass = (value) => `bug-score${value.length > 2 ? ' bug-score--long' : ''}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" class="scorebug${stale ? ' scorebug--stale' : ''}" viewBox="0 ${badge ? '-24' : '0'} 600 ${badge ? '141' : '117'}" role="img" aria-labelledby="${id}-title ${id}-description">
  <title id="${id}-title">${escape(title)}</title>
  <desc id="${id}-description">Classic football scorebug. Away team on the left, home team on the right. ${bottom.banner ? 'Game status appears beneath the scores.' : 'Quarter at left, game clock in the center, and down and distance at right.'} A white football marks possession.</desc>
  <defs>
    <linearGradient id="${id}-away" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${mix(awayColor, 255, 0.1)}"/><stop offset=".52" stop-color="${awayColor}"/><stop offset="1" stop-color="${mix(awayColor, 0, 0.14)}"/></linearGradient>
    <linearGradient id="${id}-home" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${mix(homeColor, 255, 0.06)}"/><stop offset=".5" stop-color="${homeColor}"/><stop offset="1" stop-color="${mix(homeColor, 0, 0.13)}"/></linearGradient>
    <linearGradient id="${id}-strip" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#132321"/><stop offset="1" stop-color="#081411"/></linearGradient>
    <clipPath id="${id}-top"><path d="M24 5H594L579 69H9Z"/></clipPath>
  </defs>
  ${badge ? `<g class="bug-status-flag"><path d="M25-22H${stale ? '202' : '224'}L${stale ? '198' : '220'}-4H21Z" fill="${stale ? '#b95518' : '#283739'}"/><text x="34" y="-8">${badge}</text></g>` : ''}
  <path d="M24 5H303L289 69H9Z" fill="url(#${id}-away)"/>
  <path d="M308 5H594L579 69H294Z" fill="url(#${id}-home)"/>
  <g clip-path="url(#${id}-top)">
    ${teamLogo(away, 'away')}
    ${teamLogo(home, 'home')}
    <text class="${scoreClass(awayScore)}" x="276" y="57" text-anchor="end">${awayScore}</text>
    <text class="${scoreClass(homeScore)}" x="323" y="57" text-anchor="start">${homeScore}</text>
    ${awayPossession ? possession(192) : ''}${homePossession ? possession(396) : ''}
    ${showTimeouts ? timeouts(away, 'away') + timeouts(home, 'home') : ''}
  </g>
  <path d="M5 74H583L574 115H0Z" fill="url(#${id}-strip)"/>
  ${bottom.banner
    ? `<text class="bug-banner" x="293" y="104" text-anchor="middle">${escape(bottom.banner)}</text>`
    : `<text class="bug-quarter" x="35" y="104">${escape(bottom.period)}</text>
       <text class="bug-clock" x="292" y="104" text-anchor="middle">${escape(bottom.clock)}</text>
       <text class="bug-down${bottom.down.length > 12 ? ' bug-down--long' : ''}" x="551" y="104" text-anchor="end">${escape(bottom.down)}</text>`}
  </svg>`;
}

function renderVerticalScorebug(game, options) {
  const { stale = false, demo = false } = options;
  const id = String(options.idPrefix || `vertical-${++nextId}`).replace(/[^a-zA-Z0-9_-]/g, '') || `vertical-${++nextId}`;
  const away = game?.away || {}, home = game?.home || {};
  const bottom = game ? strip(game) : { banner: 'SELECT GAME' };
  const badge = stale ? 'FEED DELAYED' : demo ? 'DESIGN PREVIEW' : '';
  const title = `${away.name || 'Away'} ${score(away.score)}, ${home.name || 'Home'} ${score(home.score)}. ${bottom.banner || `${bottom.period}, ${bottom.clock}, ${bottom.down}`}.${stale ? ' Feed delayed; last received data.' : ''}${demo ? ' Design preview, not live.' : ''}`;
  const panels = [away, home].map((team, index) => {
    const top = index * 108;
    const fill = team.abbreviation === 'SF' ? '#b3995d' : color(team.color, index ? '#c51636' : '#24394a');
    const logo = localTeamLogo(team);
    const possessing = (game?.phase === 'live' || (!game?.phase && game?.state === 'in')) && String(game.possessionTeamId) === String(team.id);
    return `<path class="bug-team-panel" d="M10 ${top}H160L150 ${top + 104}H0Z" fill="${fill}"/>
      ${logo ? `<image href="${escape(logo)}" x="33" y="${top - 2}" width="94" height="67" preserveAspectRatio="xMidYMid meet"/>` : `<text class="bug-vertical-abbreviation" x="80" y="${top + 42}" text-anchor="middle">${escape(team.abbreviation || 'NFL')}</text>`}
      <text class="bug-score bug-vertical-score" x="80" y="${top + 98}" text-anchor="middle">${score(team.score)}</text>
      ${possessing ? `<g class="bug-possession" transform="translate(132 ${top + 81}) rotate(-26)"><path d="M-6 0Q-2-4 6 0Q2 4-6 0Z" fill="#fff"/><path d="M-3 0H3" stroke="#566052" stroke-width=".7"/></g>` : ''}`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" class="scorebug scorebug--vertical${stale ? ' scorebug--stale' : ''}" viewBox="0 ${badge ? '-19' : '0'} 160 ${badge ? '329' : '310'}" role="img" aria-labelledby="${id}-title">
    <title id="${id}-title">${escape(title)}</title>
    ${badge ? `<g class="bug-status-flag"><path d="M10-17H160L158-2H8Z" fill="${stale ? '#b95518' : '#283739'}"/><text x="80" y="-6" text-anchor="middle" style="font-size:9px;letter-spacing:.6px">${badge}</text></g>` : ''}
    ${panels}<path d="M8 220H158L150 309H0Z" fill="#0b1915"/>
    ${bottom.banner ? `<text class="bug-vertical-banner" x="79" y="268" text-anchor="middle">${escape(bottom.banner)}</text>` : `<text class="bug-vertical-quarter" x="79" y="240" text-anchor="middle">${escape(bottom.period)}</text><text class="bug-vertical-clock" x="79" y="271" text-anchor="middle">${escape(bottom.clock)}</text><text class="bug-vertical-down" x="79" y="296" text-anchor="middle">${escape(bottom.down)}</text>`}
  </svg>`;
}
