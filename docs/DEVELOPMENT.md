# Development and Windows checks

[Back to the short setup guide](../README.md).

## Live updates and animations

Scores and the selected game's summary refresh approximately every **10 seconds**, including while the stats card is closed. The page does not reload. The current score and field situation come from the scoreboard; summary data supplies team totals and structured play evidence. The server shares concurrent requests and briefly caches scoreboard data for 5 seconds and summaries for 10 seconds.

Animations are driven by newly observed feed events:

- **Scoring:** touchdowns, field goals, safeties, extra points, and two-point conversions require matching play evidence and a confirmed scoreboard increase. An unresolved increase becomes a neutral **SCORE UPDATE** after a short wait; late details do not replay it.
- **Turnovers:** a reported interception or opponent fumble recovery must be explicitly marked as a turnover. A punt, own-team recovery, or simple possession change does not qualify.
- **Big plays:** a reported rush of at least **20 yards** or pass reception of at least **25 yards**, using structured net yardage.

First load, game/date changes, and resuming after a long polling gap establish a silent baseline. Old plays are not celebrated. Timeout and first-down changes do not trigger animations.

Banners enter and exit with a short wipe. When the play identifies the scorer, receiver, interceptor, or recovering player, the banner includes their reported name and available ESPN headshot. Photo failures fall back to the team crest. Passing touchdowns credit the receiver; an extra point has its own kicker. Ambiguous attribution remains a team announcement. Website demos reuse fresh players from the selected game's reported roster.

The [ESPN scoreboard](https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard) and [summary](https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary) endpoints are publicly reachable but are not a supported or guaranteed API integration. Feed and broadcast delays can differ. The clock displays the latest reported time and is not locally counted down. Missing values remain unavailable; the unsupported play clock is omitted.

### Backup feeds

The primary ESPN request gets up to 7 seconds. If it fails, available backup routes race within a 14-second total budget:

- ESPN's alternate site API.
- The independent [theScore feed](https://api.thescore.com/nfl/events), with up to 7 seconds for its response.
- ESPN's web CDN, for the current week only. Its scoreboard does not honor arbitrary dates, so dated requests never use that route.

Game summaries separately fall back to ESPN's alternate site API and its CDN game package. These are alternate routes to ESPN, not independent providers. Each response is validated for shape and identity; stale CDN cache responses are rejected when their headers disclose a delay. A successful HTTP request cannot prove that a provider's underlying data is current.

Failed routes cool down for 30–60 seconds; the primary is retried automatically. A warm server retains the last successful snapshot for up to 6 hours. The browser also saves bounded, date-specific snapshots so a refresh during an outage can restore the last received score. Cached data keeps its original update time and shows **FEED DELAYED**. Retries back off to 20/40/60 seconds after all feeds fail. A fresh backup is labeled **Backup feed**.

Matchups are linked across providers only when the away team, home team, and kickoff time match. Provider IDs stay separate from ESPN summary IDs. A backup's clock, down, possession, and timeouts come from one coherent frame; unsupported values remain unavailable. Source changes and recovery from cached data establish silent animation baselines.

Desktop renderer throttling is disabled, but the computer must remain awake and online; browsers may throttle or discard ordinary background tabs.

**Sample matchup** is a labeled SF/KC design preview, never the live feed or an error fallback.

## Run and verify from source

Requires Node.js 22 or newer.

```sh
git clone https://github.com/aaraven99/scorebug.git
cd scorebug
npm ci
npm run dev
```

Open `http://localhost:3000`. For the desktop companion:

```sh
npm ci --prefix desktop
npm run desktop
```

Verification and Windows packaging commands:

```sh
npm test
npm test --prefix desktop
npm run build
# Run on Windows:
npm run test:smoke --prefix desktop
npm run dist:win --prefix desktop
```

The suites cover feed normalization, missing/malformed data, event deduplication and silent baselines, polling recovery, team hit areas, screen-edge snapping, and outward stats placement. Windows CI checks the actual native window, preload, positioning, team-stats IPC, and transparency before packaging. Workflow artifacts are retained for 30 days. Run **Build Windows desktop app** on `main` with its publish checkbox enabled, or push a matching version tag, to publish the verified downloads at a stable URL. Publication uses that run's exact commit and checks asset hashes before making the draft public; see [publishing a release](GITHUB-ACCESS.md#publish-a-new-download).

### API and code map

```text
GET /api/scoreboard
GET /api/scoreboard?date=YYYYMMDD
GET /api/game?id=<numeric-game-id>
```

Dates and game IDs are validated. Upstream requests use fixed URLs, a 4 MB response limit, and the timeout budget described above. Responses include `sourceId`, `feedStatus` (`primary`, `backup`, or `cached`), and `stale`. `fetchedAt` always refers to the last successful snapshot, including during an outage.

`public/scorebug.js` renders both layouts; `score-client.js` and `game-details-client.js` manage updates. `game-events.js`, `game-activity.js`, and `score-animation.js` handle event detection and announcements. `details-*` implements team stats. `lib/feed-service.mjs` manages failover, while `lib/nfl.mjs`, `lib/details.mjs`, and `lib/thescore.mjs` normalize provider data. `server.mjs` serves locally; `desktop/` contains the native window and packaging.

