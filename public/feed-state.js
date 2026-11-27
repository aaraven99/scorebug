export const LIVE_POLL_INTERVAL_MS = 2000;
export const FEED_REQUEST_TIMEOUT_MS = 10000;
const MAX_TIMER_MS = 2147483647;
const time = (value) => typeof value === 'string' ? Date.parse(value) : NaN;
const ADMIN_PLAY_TYPES = new Set(['2', '21', '65', '66', '70', '74', '75']);

function playOrder(left, right) {
  if (!left || !right) return 0;
  if (Number.isFinite(left.sequenceNumber) && Number.isFinite(right.sequenceNumber)) return Math.sign(left.sequenceNumber - right.sequenceNumber);
  if (/^\d{1,24}$/.test(left.id || '') && /^\d{1,24}$/.test(right.id || '')) return BigInt(left.id) < BigInt(right.id) ? -1 : BigInt(left.id) > BigInt(right.id) ? 1 : 0;
  return 0;
}
function latestAction(data) {
  const plays = [data?.lastPlay, ...(Array.isArray(data?.eventPlays) ? data.eventPlays : []), ...(Array.isArray(data?.recentPlays) ? data.recentPlays : [])];
  return plays.filter((play) => play && !ADMIN_PLAY_TYPES.has(play.typeId)).reduce((latest, play) => !latest || playOrder(play, latest) > 0 ? play : latest, null);
}

/** HTTP Retry-After allows either whole seconds or an HTTP date. */
export function retryAfterMs(value, now = Date.now()) {
  if (typeof value !== 'string' || !value.trim()) return 0;
  const raw = value.trim();
  const delay = /^\d+$/.test(raw) ? Number(raw) * 1000 : time(raw) - now;
  return Number.isFinite(delay) ? Math.min(MAX_TIMER_MS, Math.max(0, delay)) : 0;
}

export function responseRetryMs(response, body, now = Date.now()) {
  const hint = Number.isFinite(body?.retryAfterMs) ? Math.min(MAX_TIMER_MS, Math.max(0, body.retryAfterMs)) : 0;
  return Math.max(hint, retryAfterMs(response.headers?.get?.('retry-after'), now));
}

function retainedHistory(next, previous) {
  const plays = new Map();
  for (const data of [previous, next]) {
    const history = Array.isArray(data.playByPlay) ? data.playByPlay : data.eventPlays;
    for (const play of [...(Array.isArray(history) ? history : []), ...(Array.isArray(data.scoringPlays) ? data.scoringPlays : [])]) {
      if (!play || typeof play !== 'object') continue;
      const key = play.id || `${play.sequenceNumber}:${play.period}:${play.clock}:${play.text}`;
      // A new version of the same play replaces its older version, including
      // a provider correction which takes a score away or marks a no-play.
      plays.set(key, play);
    }
  }
  const ordered = [...plays.values()].sort((a, b) => playOrder(b, a));
  return {
    playByPlay: ordered.slice(0, 250),
    scoringPlays: ordered.filter((play) => play.scoringPlay && !play.isNoPlay).slice(0, 250),
  };
}

/** Play-only backups cannot turn retained cumulative totals into fresh stats. */
export function retainKnownStats(next, previous) {
  if (next?.dataScope !== 'plays' || !previous || next.gameId !== previous.gameId
    || next.away?.id !== previous.away?.id || next.home?.id !== previous.home?.id || !next.away?.id || !next.home?.id) return next;
  const history = retainedHistory(next, previous);
  const oldTime = previous.statsFetchedAt || (previous.dataScope !== 'plays' ? previous.fetchedAt : null);
  const previousStamp = time(oldTime), nextStamp = time(next.statsFetchedAt);
  if (!Number.isFinite(previousStamp) || (Number.isFinite(nextStamp) && nextStamp >= previousStamp)) return { ...next, ...history };
  const retained = {};
  for (const key of ['teamStats', 'leaders', 'allTeamStats', 'quarterScores', 'playerStats', 'gameInfo']) {
    if (previous[key] !== undefined) retained[key] = previous[key];
  }
  // Retained drives are history. The live situation and active drive remain
  // unknown when the backup only reports plays.
  if (Array.isArray(previous.drives)) retained.drives = previous.drives.map((drive) => ({ ...drive, isActive: false }));
  return { ...next, ...retained, ...history, statsStale: true, statsFetchedAt: oldTime };
}

/** Keep a two-second start-to-start cadence without overlapping requests. */
export function nextPollDelay({ interval = LIVE_POLL_INTERVAL_MS, failures = 0, started, now, retryAt = 0 }) {
  const delay = failures ? Math.min(30000, interval * 2 ** Math.min(failures, 4)) : Math.max(100, interval - Math.max(0, now - started));
  return Math.max(delay, retryAt - now);
}

function sameGame(a, b) {
  if ((a?.leagueId || 'nfl') !== (b?.leagueId || 'nfl')) return false;
  if (a?.id && a.id === b?.id) return true;
  if (!a?.away?.id || !a?.home?.id || a.away.id !== b?.away?.id || a.home.id !== b?.home?.id) return false;
  const left = time(a.startTime), right = time(b.startTime);
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= 300000;
}

function clockSeconds(value) {
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(value || '');
  return match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
}

function gameRegresses(next, previous) {
  const nextStamp = time(next.sourceUpdatedAt), previousStamp = time(previous.sourceUpdatedAt);
  // A provider's actual update time can confirm a newer correction. Fetch
  // time alone says nothing about when a score or play changed.
  if (Number.isFinite(nextStamp) && Number.isFinite(previousStamp) && nextStamp !== previousStamp) return nextStamp < previousStamp;
  if ((previous.state === 'in' && next.state === 'pre') || (previous.phase === 'final' && ['pre', 'in'].includes(next.state))) return true;
  if (!Number.isFinite(next.period) || !Number.isFinite(previous.period)) return false;
  if (next.period < previous.period) return true;
  if (next.period > previous.period) return false;
  const scoresNotAhead = ['away', 'home'].every((side) => Number.isFinite(next[side]?.score)
    && Number.isFinite(previous[side]?.score) && next[side].score <= previous[side].score);
  if (!scoresNotAhead) return false;
  const nextPlay = next.lastPlayDetails || next.lastPlay, previousPlay = previous.lastPlayDetails || previous.lastPlay;
  if (Number.isFinite(nextPlay?.sequenceNumber) && Number.isFinite(previousPlay?.sequenceNumber)
    && nextPlay.sequenceNumber < previousPlay.sequenceNumber) return true;
  const nextClock = clockSeconds(next.clock), previousClock = clockSeconds(previous.clock);
  // Small clock corrections are common. A different route going substantially
  // backwards without any score progress is evidence of an older snapshot.
  const elapsed = ['soccer','rugby'].includes(next.sport);
  return Number.isFinite(nextClock) && Number.isFinite(previousClock) && (elapsed ? nextClock < previousClock - 15 : nextClock > previousClock + 15);
}

/** Reject known older snapshots, while allowing a healthy source's corrections. */
export function snapshotIsOlder(next, previous, now = Date.now()) {
  if (!next || !previous) return false;
  // Full summaries and the core play feed can reach different server workers.
  // Their known play order is comparable even without a current game period.
  const coreOrder = next.gameId && next.gameId === previous.gameId && (next.dataScope === 'plays' || previous.dataScope === 'plays')
    ? playOrder(latestAction(next), latestAction(previous)) : 0;
  if (coreOrder < 0) return true;
  const nextFetch = time(next.fetchedAt), previousFetch = time(previous.fetchedAt);
  const olderFetch = coreOrder <= 0 && Number.isFinite(nextFetch) && Number.isFinite(previousFetch) && nextFetch < previousFetch;
  const nextStamp = time(next.sourceUpdatedAt), previousStamp = time(previous.sourceUpdatedAt);
  // A delayed HTTP response can still contain a newer provider frame than a
  // recently fetched, lagging route. Compare actual update times first.
  if (Number.isFinite(nextStamp) && Number.isFinite(previousStamp) && nextStamp !== previousStamp) return nextStamp < previousStamp;
  const compareProgress = Number.isFinite(previousFetch) && now - previousFetch <= 15 * 60 * 1000
    && next.sourceId && previous.sourceId && next.sourceId !== previous.sourceId;
  if (Array.isArray(next.games) && Array.isArray(previous.games)) {
    let confirmedNewer = false;
    const regresses = previous.games.some((game) => {
      const matches = next.games.filter((candidate) => sameGame(game, candidate));
      if (!matches.length) return Boolean(compareProgress) && game.state === 'in';
      if (matches.length !== 1) return false;
      const current = time(matches[0].sourceUpdatedAt), old = time(game.sourceUpdatedAt);
      if (Number.isFinite(current) && Number.isFinite(old) && current !== old) {
        if (current < old) return true;
        confirmedNewer = true;
        return false;
      }
      return Boolean(compareProgress) && gameRegresses(matches[0], game);
    });
    return regresses || (!confirmedNewer && olderFetch);
  }
  return olderFetch || (Boolean(compareProgress) && next.gameId === previous.gameId && gameRegresses(next, previous));
}
