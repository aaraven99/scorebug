import { localTeamLogo } from './team-assets.js';

function periodText(game) {
  const period = Number(game.period);
  if (game.phase === 'halftime') return 'Halftime';
  if (game.phase === 'intermission') return period > 4 ? 'End OT' : `End Q${period || '—'}`;
  const quarter = period > 4 ? period === 5 ? 'OT' : `${period - 4}OT` : period ? `Q${period}` : 'Live';
  return /^\d{1,2}:[0-5]\d$/.test(String(game.clock)) ? `${quarter} · ${game.clock}` : quarter;
}

function setText(element, value) {
  const text = String(value ?? '—');
  if (element.textContent !== text) element.textContent = text;
}

/** Keep each live matchup button in place while its score and clock update. */
export function createLiveGameList(root, { onChoose, onFocusedGameRemoved } = {}) {
  let entries = [];
  function createEntry() {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'live-game';
    const matchup = document.createElement('span'); matchup.className = 'live-matchup';
    const teams = ['away','home'].map((side) => {
      const team = document.createElement('span'); team.className = 'live-team'; team.dataset.side = side;
      const logo = document.createElement('img'); logo.alt = ''; logo.width = 23; logo.height = 23; logo.hidden = true;
      logo.addEventListener('error', () => { logo.hidden = true; });
      const name = document.createElement('span'); name.className = 'live-team-name';
      const score = document.createElement('strong'); score.className = 'live-score';
      team.append(logo,name,score); matchup.append(team);
      return { side, logo, name, score };
    });
    const clock = document.createElement('span'); clock.className = 'live-game-clock';
    button.append(matchup,clock);
    const entry = { button, teams, clock, game:null, ids:[] };
    button.addEventListener('click', () => { if (entry.game) onChoose?.(entry.game); });
    return entry;
  }
  return {
    render(games, { selectedId = null, delayed = false } = {}) {
      const used = new Set(), next = [], focused = document.activeElement;
      for (const game of games) {
        const ids = [game.id,...(Array.isArray(game.idAliases) ? game.idAliases : [])];
        const entry = entries.find((candidate) => !used.has(candidate) && candidate.ids.some((id) => ids.includes(id))) || createEntry();
        used.add(entry); next.push(entry); entry.game = game; entry.ids = ids;
        entry.button.dataset.gameId = game.id;
        entry.button.setAttribute('aria-pressed',String(game.id === selectedId));
        entry.button.setAttribute('aria-label',`Watch ${game.away.name || game.away.abbreviation} at ${game.home.name || game.home.abbreviation}, ${game.away.score ?? '—'} to ${game.home.score ?? '—'}, ${periodText(game)}${delayed ? ', feed delayed' : ''}`);
        for (const item of entry.teams) {
          const team = game[item.side], logo = localTeamLogo(team);
          if (logo && item.logo.getAttribute('src') !== logo) { item.logo.src = logo; item.logo.hidden = false; }
          if (!logo) { item.logo.removeAttribute('src'); item.logo.hidden = true; }
          setText(item.name,team.abbreviation); setText(item.score,team.score);
        }
        setText(entry.clock,periodText(game));
      }
      for (const entry of entries) if (!used.has(entry)) entry.button.remove();
      next.forEach((entry,index) => {
        const current = root.children[index];
        if (current === entry.button) return;
        if (typeof root.moveBefore === 'function' && entry.button.parentNode === root) root.moveBefore(entry.button,current || null);
        else root.insertBefore(entry.button,current || null);
      });
      // Moving a retained row must not steal keyboard focus in older browsers.
      if (focused && next.some((entry) => entry.button === focused) && document.activeElement !== focused) focused.focus({preventScroll:true});
      else if (focused && entries.some((entry) => entry.button === focused) && !focused.isConnected) onFocusedGameRemoved?.();
      entries = next;
    },
  };
}
