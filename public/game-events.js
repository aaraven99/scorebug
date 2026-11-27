// Structured ESPN play evidence names an event; the primary scoreboard confirms
// its points. In particular, a +6/+7/+2 delta alone never identifies a play type.
const SCORE_TITLES = {
  touchdown: 'TOUCHDOWN', 'field-goal': 'FIELD GOAL', safety: 'SAFETY',
  'extra-point': 'EXTRA POINT', 'two-point': 'TWO-POINT CONVERSION', score: 'SCORE UPDATE',
};
const ACTIVE_PHASES = new Set(['live', 'halftime', 'intermission']);
const integer = (value) => typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
const score = (value) => integer(value) !== null && value >= 0 && value <= 999 ? value : null;
const validId = (value) => typeof value === 'string' && /^\d{1,24}$/.test(value);
const compareId = (a, b) => BigInt(a) > BigInt(b) ? 1 : BigInt(a) < BigInt(b) ? -1 : 0;
const array = (value) => Array.isArray(value) ? value : [];

function eventPlayer(value, teamId) {
  if (!value || value.teamId !== teamId || typeof value.name !== 'string') return null;
  const name = value.name.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90);
  if (!name) return null;
  let headshot = null;
  try {
    const url = new URL(value.headshot);
    if (url.protocol === 'https:' && /(^|\.)espncdn\.com$/i.test(url.hostname) && !url.username && !url.password && !url.port && /^\/i\/headshots\/nfl\/players\//.test(url.pathname)) headshot = url.href;
  } catch { /* A name without a photograph is still useful. */ }
  return { id: validId(value.id) ? value.id : null, name, headshot };
}

function componentPlayer(play, part, teamId) {
  return eventPlayer(part.component === 'conversion' ? play.conversionPlayer : play.player, teamId);
}

function conversion(attempt) {
  if (attempt?.points === 1 && (attempt.typeId === '61' || /^Extra Point Good$/i.test(attempt.type || ''))) return { kind: 'extra-point', points: 1 };
  if (attempt?.points === 2 && /Two[ -]Point/i.test(attempt.type || '')) return { kind: 'two-point', points: 2 };
  // A supplied positive conversion value is useful even if its type is new.
  return [1, 2].includes(attempt?.points) ? { kind: 'score', points: attempt.points } : null;
}

function components(play) {
  if (!validId(play?.id) || play.isNoPlay || /\bNO PLAY\b/i.test(play.text || '')) return [];
  const type = play.type || '', scoringType = play.scoringType || '';
  const canScore = play.scoringPlay !== false;
  let kind = null, points = null;
  if (canScore && (scoringType === 'touchdown' || /Touchdown/i.test(type))) { kind = 'touchdown'; points = 6; }
  else if (canScore && (scoringType === 'field-goal' || play.typeId === '59' || /^Field Goal Good$/i.test(type))) { kind = 'field-goal'; points = 3; }
  else if (canScore && (scoringType === 'safety' || play.typeId === '20' || /^Safety$/i.test(type))) { kind = 'safety'; points = 2; }
  else if (canScore && (play.typeId === '61' || /^Extra Point Good$/i.test(type))) { kind = 'extra-point'; points = 1; }
  else if (canScore && (scoringType === 'two-point-conversion' || /Two[ -]Point.*(?:Good|Conversion|Rush|Pass)/i.test(type)) && play.scoreValue === 2) { kind = 'two-point'; points = 2; }
  else if (play.scoringPlay === true && integer(play.scoreValue) > 0) { kind = 'score'; points = play.scoreValue; }

  if (kind) {
    const after = kind === 'touchdown' ? conversion(play.pointAfterAttempt) : null;
    const result = [{ component: kind, kind, points, scoring: true, subtractAfter: after?.points || 0 }];
    if (after) result.push({ component: 'conversion', ...after, scoring: true, subtractAfter: 0 });
    return result;
  }
  // A fumble, a punt, or a change of possession is not proof of a turnover.
  // Even the real safety sample contains "FUMBLES" with isTurnover:false.
  if (play.isTurnover === true) {
    if (play.typeId === '26' || /Interception/i.test(type)) return [{ component: 'interception', kind: 'interception', scoring: false }];
    if (play.typeId === '29' || /Fumble Recovery \(Opponent\)/i.test(type)) return [{ component: 'fumble', kind: 'fumble', scoring: false }];
    return [];
  }
  if (play.scoringPlay === true) return [];
  // Big play means a published net rush of >=20 yards or reception of >=25.
  // Kick/return/field-goal distances and yardage parsed from prose do not count.
  const yards = integer(play.yardsGained);
  const bigRush = (play.typeId === '5' || /^Rush$/i.test(type)) && yards >= 20;
  const bigPass = (play.typeId === '24' || /^Pass Reception$/i.test(type)) && yards >= 25;
  return yards !== null && (bigRush || bigPass) ? [{ component: 'big-play', kind: 'big-play', scoring: false }] : [];
}

function mergePlay(previous, next) {
  if (!previous) return next;
  const value = { ...previous };
  for (const [key, field] of Object.entries(next)) if (field !== null && field !== undefined) value[key] = field;
  value.scores = { ...previous.scores };
  for (const side of ['away', 'home']) if (score(next.scores?.[side]) !== null) value.scores[side] = next.scores[side];
  for (const key of ['player', 'conversionPlayer']) {
    if (previous[key] && next[key] && previous[key].id && previous[key].id === next[key].id) {
      value[key] = { ...previous[key] };
      for (const [field, detail] of Object.entries(next[key])) if (detail !== null && detail !== undefined) value[key][field] = detail;
    }
  }
  return value;
}

function collectPlays(game, details) {
  const matching = details?.gameId === game.id;
  const plays = new Map();
  const listed = matching ? array(details.eventPlays?.length ? details.eventPlays : details.recentPlays) : [];
  for (const play of [...listed, game.lastPlayDetails]) {
    if (!validId(play?.id)) continue;
    plays.set(play.id, mergePlay(plays.get(play.id), play));
  }
  return [...plays.values()].sort((a, b) => compareId(a.id, b.id));
}

/** A labeled demo may use this game's reported roster; callers gate freshness. */
export function selectDemoPlayer(details, teamId, kind) {
  if (!validId(details?.gameId) || !validId(teamId) || ![details.away?.id, details.home?.id].includes(teamId)) return null;
  const categories = {
    touchdown: ['receiving', 'rushing'], 'field-goal': ['kicking'], 'extra-point': ['kicking'],
    'two-point': ['receiving', 'rushing'], 'big-play': ['receiving', 'rushing'],
    interception: ['interceptions', 'defensive'], fumble: ['defensive'], safety: ['defensive'],
  }[kind];
  if (!categories) return null;
  for (const play of array(details.eventPlays)) {
    for (const part of components(play)) {
      if (part.kind !== kind) continue;
      const player = componentPlayer(play, part, teamId);
      if (player) return player;
    }
  }
  for (const category of categories) {
    for (const player of array(details.players)) {
      if (!array(player.statCategories).includes(category)) continue;
      const selected = eventPlayer(player, teamId);
      if (selected) return selected;
    }
  }
  return null;
}

/**
 * Pure in-memory tracker: supply `now` for deterministic playback/tests.
 *
 * update({game,details,contextKey,now,silent}) returns at most maxEvents NEW
 * notices. First load, context/game switches, reset(), a >45s polling gap, or
 * silent:true seeds without celebrating old plays. Call reset() on suspension.
 * Live/quarter breaks/halftime can emit; entering final gets a 30s reconciliation
 * grace for the last score. A game first opened at final never emits history.
 *
 * Score evidence may arrive before or after a scoreboard increase. Pending
 * points wait 12s for an exact type, then become a generic SCORE UPDATE. Consumed
 * points cannot be celebrated again when a delayed summary arrives. TD and PAT
 * often share an ESPN ID, so their component IDs are deduplicated separately.
 * Storage is capped (128 plays, 256 components, 32 candidates, 64 pending points
 * per team), pending evidence expires after 45s, and stale wallclock plays are
 * rejected. Score decreases clear pending evidence; rebound corrections never
 * cause a generic score celebration.
 */
export function createGameEventTracker({ maxEvents = 4, scoreFallbackDelayMs = 12000, pendingTtlMs = 45000, resumeGapMs = 45000, eventMaxAgeMs = 90000 } = {}) {
  const limit = Math.min(8, Math.max(1, integer(maxEvents) ?? 4));
  let context, lastUpdate, previousScores, previousPhase, finalUntil, cursor;
  let seen, observed, pending, credits, highScores;
  function reset() {
    context = null; lastUpdate = null; previousScores = null; previousPhase = null; finalUntil = 0; cursor = null;
    seen = new Set(); observed = new Map(); pending = new Map(); credits = new Map(); highScores = new Map();
  }
  reset();
  const remember = (key) => { seen.add(key); if (seen.size > 256) seen.delete(seen.values().next().value); };
  const validTeam = (game, id) => [game.away?.id, game.home?.id].includes(id) ? id : null;
  const scoresOf = (game) => ({ [game.away.id]: score(game.away.score), [game.home.id]: score(game.home.score) });
  const componentKey = (play, part) => `${play.id}:${part.component}`;
  function seedPlays(plays) {
    for (const play of plays) {
      if (!observed.has(play.id)) observed.set(play.id, { eligible: false });
      for (const part of components(play)) remember(componentKey(play, part));
      if (cursor === null || compareId(play.id, cursor) > 0) cursor = play.id;
    }
    while (observed.size > 128) observed.delete(observed.keys().next().value);
  }
  function seed(game, plays, nextContext, now) {
    reset(); context = nextContext; lastUpdate = now; previousScores = scoresOf(game); previousPhase = game.phase;
    for (const [teamId, value] of Object.entries(previousScores)) { highScores.set(teamId, value); credits.set(teamId, new Map()); }
    seedPlays(plays);
  }
  function fresh(play, now) {
    const time = Date.parse(play.wallclock || '');
    return !Number.isFinite(time) || (time <= now + 15000 && now - time <= eventMaxAgeMs);
  }
  function eventFor(game, play, part, teamId) {
    return {
      id: `${game.id}:${componentKey(play, part)}`, gameId: game.id,
      kind: part.kind, teamId,
      title: SCORE_TITLES[part.kind] || ({ interception: 'INTERCEPTION', fumble: 'FUMBLE RECOVERED', 'big-play': 'BIG PLAY' })[part.kind],
      detail: play.text || '', points: part.points ?? null, playId: play.id,
      period: play.period ?? null, clock: play.clock ?? null, yardsGained: part.component === 'conversion' ? null : integer(play.yardsGained),
      player: componentPlayer(play, part, teamId),
    };
  }
  function update({ game, details = null, contextKey = '', now = Date.now(), silent = false } = {}) {
    if (!validId(game?.id) || !validId(game.away?.id) || !validId(game.home?.id) || game.away.id === game.home.id || !Number.isFinite(now)) { reset(); return []; }
    const nextContext = `${contextKey}:${game.id}:${game.away.id}:${game.home.id}`;
    const plays = collectPlays(game, details);
    if (context !== nextContext || lastUpdate === null || silent || now < lastUpdate || now - lastUpdate > resumeGapMs) { seed(game, plays, nextContext, now); return []; }
    const wasActive = ACTIVE_PHASES.has(previousPhase);
    if (game.phase === 'final' && previousPhase !== 'final' && wasActive) finalUntil = now + 30000;
    const canEmit = ACTIVE_PHASES.has(game.phase) || (game.phase === 'final' && now <= finalUntil);
    const currentScores = scoresOf(game);
    const corrected = Object.entries(currentScores).some(([teamId, value]) => value !== null && previousScores[teamId] !== null && value < previousScores[teamId]);
    if (corrected || !canEmit) {
      pending.clear(); for (const list of credits.values()) list.clear();
      // A subsequently restored point must not revive an older play's newly
      // arrived conversion metadata. New play IDs can still prove a new score.
      if (corrected) for (const history of observed.values()) history.eligible = false;
      seedPlays(plays);
    }
    for (const [teamId, value] of Object.entries(currentScores)) {
      const before = previousScores[teamId];
      const high = highScores.get(teamId);
      const list = credits.get(teamId);
      if (value === null) list.clear();
      if (canEmit && !corrected && value !== null && before !== null && value > before) {
        const genericAllowed = high === null || before >= high;
        for (let point = before + 1; point <= value; point++) list.set(point, { at: now, genericAllowed });
        while (list.size > 64) list.delete(list.keys().next().value);
      }
      if (value !== null) highScores.set(teamId, Math.max(high ?? value, value));
      for (const [point, credit] of list) if (now - credit.at > pendingTtlMs) list.delete(point);
    }
    previousScores = currentScores; previousPhase = game.phase; lastUpdate = now;
    if (corrected || !canEmit) return [];

    const emitted = [];
    const priorCursor = cursor;
    for (const play of plays) {
      let history = observed.get(play.id);
      if (!history) {
        history = { eligible: priorCursor !== null && compareId(play.id, priorCursor) > 0 };
        observed.set(play.id, history);
      }
      if (cursor === null || compareId(play.id, cursor) > 0) cursor = play.id;
      for (const part of components(play)) {
        const key = componentKey(play, part);
        if (seen.has(key)) continue;
        if (!fresh(play, now)) { remember(key); continue; }
        if (!part.scoring) {
          remember(key);
          if (!history.eligible || game.phase === 'final') continue;
          const teamId = part.kind === 'big-play'
            ? validTeam(game, play.offenseTeamId || play.teamId)
            : validTeam(game, play.end?.teamId) || validTeam(game, play.defenseTeamId);
          // Do not name the offense as beneficiary of its own unconfirmed loss.
          if (!teamId || (part.kind !== 'big-play' && teamId === play.offenseTeamId)) continue;
          emitted.push(eventFor(game, play, part, teamId));
          continue;
        }
        const explicitTeam = validTeam(game, play.scoringTeamId);
        const afterScores = {};
        for (const side of ['away', 'home']) {
          const teamId = game[side].id;
          const supplied = score(play.scores?.[side]);
          // Only a new, explicitly attributed scoreboard play may use the
          // current score when ESPN omits per-play score snapshots.
          const available = [...(credits.get(teamId)?.keys() || [])];
          const canUseCurrentScore = history.eligible && explicitTeam === teamId && available.length === part.points && part.subtractAfter === 0;
          const total = supplied ?? (canUseCurrentScore ? currentScores[teamId] : null);
          afterScores[teamId] = total === null ? null : total - part.subtractAfter;
        }
        const exactCurrentEvidence = Object.entries(afterScores).some(([teamId, total]) => total !== null && credits.get(teamId)?.get(total)?.genericAllowed);
        if (!history.eligible && !exactCurrentEvidence) { remember(key); continue; }
        const existing = pending.get(key);
        pending.set(key, { play, part, teamId: explicitTeam, afterScores, at: existing?.at ?? now });
      }
    }
    while (observed.size > 128) observed.delete(observed.keys().next().value);
    while (pending.size > 32) { const key = pending.keys().next().value; pending.delete(key); remember(key); }
    for (const [key, candidate] of pending) {
      if (now - candidate.at > pendingTtlMs || !fresh(candidate.play, now)) { pending.delete(key); remember(key); continue; }
      const matches = [];
      for (const [teamId, total] of Object.entries(candidate.afterScores)) {
        if (candidate.teamId && candidate.teamId !== teamId) continue;
        const list = credits.get(teamId);
        if (!Number.isInteger(total) || total < candidate.part.points) continue;
        const points = Array.from({ length: candidate.part.points }, (_, index) => total - candidate.part.points + index + 1);
        if (points.every((point) => list?.has(point))) matches.push({ teamId, points });
      }
      if (matches.length !== 1) continue;
      const match = matches[0];
      for (const point of match.points) credits.get(match.teamId).delete(point);
      pending.delete(key); remember(key);
      emitted.push(eventFor(game, candidate.play, candidate.part, match.teamId));
    }
    for (const [teamId, list] of credits) {
      const mature = [...list].filter(([, credit]) => credit.genericAllowed && now - credit.at >= scoreFallbackDelayMs).map(([point]) => point).sort((a, b) => a - b);
      if (!mature.length) continue;
      for (const point of mature) list.delete(point);
      const team = game.away.id === teamId ? game.away : game.home;
      emitted.push({
        id: `${game.id}:score:${teamId}:${mature.join('-')}`, gameId: game.id, kind: 'score', teamId,
        title: SCORE_TITLES.score, detail: `${team.abbreviation || 'Team'} score increased by ${mature.length}.`,
        points: mature.length, playId: null, period: game.period ?? null, clock: game.clock ?? null, yardsGained: null, player: null,
      });
    }
    return emitted.slice(-limit);
  }
  return { update, reset };
}
