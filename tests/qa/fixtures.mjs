import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { LEAGUES } from '../../public/sports.js';
import { referenceForLeague } from '../../public/sport-fixtures.js';

// Deliberately fixed, labelled fixtures. These scores are never claimed to be live.
const names = ['Kimi Antonelli','Lando Norris','Max Verstappen','Charles Leclerc','George Russell','Oscar Piastri','Lewis Hamilton','Carlos Sainz','Alexander Albon','Fernando Alonso','Lance Stroll','Pierre Gasly','Esteban Ocon','Oliver Bearman','Nico Hülkenberg','Gabriel Bortoleto','Liam Lawson','Isack Hadjar','Yuki Tsunoda','Franco Colapinto','Sergio Pérez','Valtteri Bottas'];
const golfNames = ['Scottie Scheffler','Rory McIlroy','Xander Schauffele','Collin Morikawa','Ludvig Åberg','Tommy Fleetwood','Viktor Hovland','Hideki Matsuyama','Justin Thomas','Jordan Spieth'];
const seriesNames={nascar:['Kyle Larson','Chase Elliott','Denny Hamlin','Ryan Blaney','William Byron','Christopher Bell'],indycar:['Álex Palou','Pato O’Ward','Scott Dixon','Josef Newgarden','Will Power','Colton Herta'],lpga:['Nelly Korda','Lydia Ko','Lilia Vu','Jeeno Thitikul','Jin Young Ko','Brooke Henderson']};
export const FIXTURE_DATE = '20261127';

export async function loadAuditedDirectories() {
  const root = fileURLToPath(new URL('../fixtures/directory-audit/', import.meta.url));
  const directories = {};
  let files = [];
  try { files = await readdir(root); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const file of files.filter(name => name.endsWith('.json'))) {
    const data = JSON.parse(await readFile(`${root}/${file}`, 'utf8'));
    const leagueId = data.leagueId || file.replace(/\.json$/, '');
    const teams = Array.isArray(data) ? data : data.teams;
    if (LEAGUES.some(league => league.id === leagueId) && Array.isArray(teams)) directories[leagueId] = { ...data, leagueId, teams };
  }
  return directories;
}

export function fixtureForLeague(leagueId, { directories = {}, variant = 'live', index = 0 } = {}) {
  const league = LEAGUES.find(item => item.id === leagueId);
  const supplied = directories[leagueId]?.teams || [];
  const game = structuredClone(referenceForLeague(leagueId, supplied));
  game.id = leagueId === 'nfl' ? String(401700000 + index) : `${leagueId}:qa${index + 1}`;
  Object.assign(game, { kind: league.kind, name: `QA ${league.name}`, status: 'Deterministic QA fixture', startTime: '2026-11-27T19:00:00Z', lastPlay: 'A reported play with an unchanged score.', source: 'qa-fixture' });
  if (['race','leaderboard'].includes(league.kind)) {
    const fallbackNames=leagueId==='f1'?names:seriesNames[leagueId]||golfNames;
    const roster=leagueId==='f1'?names.map(name=>({...(supplied.find(team=>team.name===name)||{}),name})):supplied.length?supplied.slice(0,league.kind==='race'?22:10):fallbackNames.map(name=>({name}));
    game.entries = roster.map((athlete, index) => ({
      id: athlete.id||`${leagueId}:driver${index + 1}`, position: index + 1,
      athlete: { id:athlete.id||`${leagueId}:driver${index + 1}`, name:athlete.name, abbreviation: athlete.name === 'Kimi Antonelli' ? 'K. Antonelli' : athlete.abbreviation||athlete.name.split(' ').at(-1).slice(0,3).toUpperCase() },
      team: athlete.team||{ id: `${leagueId}:constructor${index % 11 + 1}`, name: leagueId==='f1'&&index===0?'Mercedes':athlete.name, abbreviation: leagueId==='f1'&&index===0?'MER':athlete.abbreviation||athlete.name.split(' ').at(-1).slice(0,3).toUpperCase(), color: athlete.color||['#27f4d2','#ff8000','#3671c6','#e80020'][index % 4] },
      gap: index ? `+${(index * 1.842).toFixed(3)}` : 'Leader', interval: index ? '+1.842' : null, laps: 23, lapTime: '1:24.312',
      score: league.kind === 'leaderboard' ? String(-9 + index) : null, status: 'Running',
    }));
    game.sessionName = leagueId==='f1'?'Sprint Qualifying':league.kind==='race'?'Race':'Round 2';
    game.sessionType = leagueId==='f1'?'sprint-qualifying':league.kind==='race'?'race':'round';
    game.flag = league.kind === 'race' ? 'yellow' : null;
  } else {
    for (const side of ['away','home']) {
      game[side].leagueId = leagueId; game[side].sport = league.sport;
      if (leagueId !== 'nfl' && !String(game[side].id).startsWith(`${leagueId}:`)) game[side].id = `${leagueId}:${game[side].id}`;
    }
    game.name = `${game.away.name} at ${game.home.name}`;
    game.possessionTeamId = game.away.id;
    if (league.sport === 'football') { game.away.score = 27; game.home.score = 24; game.period = 4; game.clock = '2:17'; game.downDistance = '3RD & 7'; game.fieldPosition = `${game.home.abbreviation} 34`; }
    if (league.sport === 'basketball') { game.away.score = 107; game.home.score = 109; game.clock = '0:17.2'; }
    if (league.sport === 'tennis') { game.situation.awayPoints = 30; game.situation.homePoints = 15; game.situation.servingTeamId = game.away.id; }
    if (league.sport === 'volleyball') { game.situation.awayPoints = 19; game.situation.homePoints = 17; game.situation.servingTeamId = game.away.id; }
  }
  if (variant === 'scheduled') Object.assign(game, { state: 'pre', phase: 'scheduled', isLive: false, clock: null });
  if (variant === 'final') Object.assign(game, { state: 'post', phase: 'final', isLive: false, clock: null });
  return game;
}

export function scoreboardForLeague(leagueId, options = {}) {
  return { leagueId, source: 'qa-fixture', feedStatus: 'live', fetchedAt: new Date().toISOString(), games: [fixtureForLeague(leagueId, options), fixtureForLeague(leagueId, { ...options, variant: 'scheduled', index: 1 })] };
}

export function detailsForGame(game) {
  const rows={
    football:[['totalYards','Total yards','314','287'],['turnovers','Turnovers','1','2']],
    basketball:[['threePointFieldGoalPct','Three-point percentage','42.9','36.8'],['totalRebounds','Rebounds','41','38'],['assists','Assists','27','23']],
    baseball:[['batting.hits','Hits','8','6'],['batting.homeRuns','Home runs','2','1'],['fielding.errors','Errors','0','1']],
    hockey:[['shotsOnGoal','Shots on goal','31','26'],['powerPlayPercentage','Power-play percentage','33.3','0']],
    soccer:[['shotsOnTarget','Shots on target','7','4'],['possessionPct','Possession','56','44'],['redCards','Red cards','0','1']],
    tennis:[['aces','Aces','8','5'],['firstServePercentage','First serve percentage','68','61'],['breakPointsWon','Break points won','3','2']],
    volleyball:[['kills','Kills','42','38'],['serviceAces','Service aces','6','4'],['blocks','Blocks','9','7']],
    rugby:[['tries','Tries','2','1'],['meters','Metres gained','341','287'],['tackles','Tackles','84','91']],
  }[game.sport]||[];
  const teamStats = rows.map(([key,label,away,home])=>({key,label,away,home,direction:['turnovers','redCards','fielding.errors'].includes(key)?'lower':'higher'}));
  return {
    gameId: game.id, leagueId: game.leagueId, sport: game.sport, fetchedAt: new Date().toISOString(), source: 'qa-fixture', feedStatus: 'live', stale: false,
    teamStats, allTeamStats: teamStats, plays: [{ id: 'qa-play-1', text: 'Deterministic QA play description.', teamId: game.away?.id || null, period: game.period, clock: game.clock, scoringPlay: false }],
    playByPlay:[{id:'qa-play-1',text:'Deterministic QA play description.',teamId:game.away?.id||null,period:game.period,clock:game.clock,scoringPlay:false}],scoringPlays: [], drives: [], playerStats: [], periods: [], entries: game.entries || [], gameInfo: { venue: { name: 'QA Stadium' } },
  };
}

export function fallbackDirectory(leagueId) {
  const game = fixtureForLeague(leagueId);
  return { leagueId, teams: game.entries ? game.entries.map(entry => ({ ...entry.athlete, leagueId, color: entry.team.color })) : [game.away, game.home], fetchedAt: new Date().toISOString(), source: 'qa-fixture', coverage: { type: 'fixture', complete: false, note: 'A small fixture directory; not the audited full directory.' } };
}
