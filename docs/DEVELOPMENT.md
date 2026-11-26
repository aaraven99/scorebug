# Development and Windows checks

[Back to the short setup guide](../README.md).

## Live updates and animations

Scores and the selected game's summary refresh approximately every **10 seconds**, including while the stats card is closed. The page does not reload. The current score and field situation come from the scoreboard; summary data supplies team totals and structured play evidence. The server shares concurrent requests and briefly caches scoreboard data for 5 seconds and summaries for 10 seconds.

Animations are driven by newly observed feed events:

- **Scoring:** touchdowns, field goals, safeties, extra points, and two-point conversions require matching play evidence and a confirmed scoreboard increase. An unresolved increase becomes a neutral **SCORE UPDATE** after a short wait; late details do not replay it.
- **Turnovers:** a reported interception or opponent fumble recovery must be explicitly marked as a turnover. A punt, own-team recovery, or simple possession change does not qualify.
- **Big plays:** a reported rush of at least **20 yards** or pass reception of at least **25 yards**, using structured net yardage.

First load, game/date changes, and resuming after a long polling gap establish a silent baseline. Old plays are not celebrated. Timeout and first-down changes do not trigger animations.

The [ESPN scoreboard](https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard) and [summary](https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary) endpoints are publicly reachable but are not a supported or guaranteed API integration. Feed and broadcast delays can differ. The clock displays the latest reported time and is not locally counted down. Missing values remain unavailable; the unsupported play clock is omitted.

A score-feed failure preserves the last received scores with **FEED DELAYED** and backs off retries to 20/40/60 seconds. Stats failures label old totals as delayed. Normal polling resumes after success. Desktop renderer throttling is disabled, but the computer must remain awake and online; browsers may throttle or discard ordinary background tabs.

**Compare reference** is a labeled SF/KC design preview, never the live feed or an error fallback.

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

The suites cover feed normalization, missing/malformed data, event deduplication and silent baselines, polling recovery, team hit areas, screen-edge snapping, and outward stats placement. Windows CI checks the actual native window, preload, positioning, team-stats IPC, and transparency before packaging. Workflow artifacts are retained for 30 days. Tagged releases keep the public downloads available at a stable URL; see [publishing a release](GITHUB-ACCESS.md#publish-a-new-download).

### API and code map

```text
GET /api/scoreboard
GET /api/scoreboard?date=YYYYMMDD
GET /api/game?id=<numeric-game-id>
```

Dates and game IDs are validated. Both upstream requests have an 8-second timeout, response-size limits, and fixed source URLs.

`public/scorebug.js` renders both layouts; `score-client.js` and `game-details-client.js` manage updates. `game-events.js`, `game-activity.js`, and `score-animation.js` handle event detection and announcements. `details-*` implements team stats. `api/` and `lib/` normalize ESPN data; `server.mjs` serves locally; `desktop/` contains the native window and packaging.

