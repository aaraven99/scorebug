# Development and Windows checks

[Back to the short setup guide](../README.md).

## Live updates and animations

Scores and the selected game's summary check for updates approximately every **2 seconds**, including while the stats card is closed. Requests never overlap: if a request takes longer, the next check follows it. The page does not reload. The current score and field situation come from the scoreboard; summary data supplies team totals and structured play evidence. The server shares concurrent requests and caches both feeds for **1 second**. This is a polling target, not a guarantee that the provider reports each play within two seconds.

Animations are driven by newly observed feed events:

- **Scoring:** touchdowns, field goals, safeties, extra points, and two-point conversions require matching play evidence and a confirmed scoreboard increase. An unresolved increase becomes a neutral **SCORE UPDATE** after a short wait; late details do not replay it.
- **Turnovers:** a reported interception or opponent fumble recovery must be explicitly marked as a turnover. A punt, own-team recovery, or simple possession change does not qualify.
- **Big plays:** a reported rush of at least **20 yards** or pass reception of at least **25 yards**, using structured net yardage.

First load, game/date changes, and resuming after a long polling gap establish a silent baseline. Old plays are not celebrated. Timeout and first-down changes do not trigger animations.

Banners enter and exit with a short wipe. When the play identifies the scorer, receiver, interceptor, or recovering player, the banner includes their reported name and available ESPN headshot. Photo failures fall back to the team crest. Passing touchdowns credit the receiver; an extra point has its own kicker. Ambiguous attribution remains a team announcement. Website demos reuse fresh players from the selected game's reported roster.

The [ESPN scoreboard](https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard) and [summary](https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary) endpoints are publicly reachable but are not a supported or guaranteed API integration. Feed and broadcast delays can differ. The clock displays the latest reported time and is not locally counted down. Missing values remain unavailable; the unsupported play clock is omitted.

### Backup feeds

The primary ESPN request starts first. Available backups join immediately if it fails, or after **1.5 seconds** if it is still loading. A fast primary uses only one request. Each route has up to **6 seconds**, within an **8-second total budget**:

- ESPN's alternate site API.
- The independent [theScore feed](https://api.thescore.com/nfl/events).
- FOX's current-week scoreboard, using its public website data route. Routing metadata is cached for up to 60 seconds; game frames still use the one-second shared cache. Dated requests do not use FOX until that date route is verified.
- ESPN's web CDN, for the current week only. Its scoreboard does not honor arbitrary dates, so dated requests never use that route.

Game summaries separately fall back to ESPN's alternate site API, its CDN game package, and its core play feed. The core feed is the upstream used by [nfllivepy](https://github.com/jlkazan/nfllivepy/blob/main/nfllivepy/requester/pbp_requester.py); it remains ESPN data. This adapter requests only the selected game's plays and identity, with at most two fixed-host requests under the same timeout. It does not scan every game's play history.

Core play updates keep cumulative team stats at their last known values with a **Stats delayed** label. `statsFetchedAt` records the original full-stat check, while `playsUpdatedAt` records a play modification. A cold play-only response leaves unavailable totals blank. It never promotes a historical play position into the current down or clock.

Each response is validated for shape and identity. A live CDN response older than 5 seconds triggers a fresh alternative; if every alternative fails, a validated response aged 6–45 seconds can still show the score with a delayed label. Older frames and explicit stale-cache warnings are rejected. A successful HTTP request cannot prove that a provider's underlying data is current.

Failed routes cool down for **4/8/16/30 seconds**, or longer when the provider sends `Retry-After`. A working backup is reused without racing every route on every check. A slow losing route is probed again after 10 seconds. The primary returns automatically when healthy. After an outage, client retries back off to **4/8/16/30 seconds** and return to the two-second cadence on success.

A warm server retains the last successful snapshot for up to 6 hours. The browser also saves bounded, date-specific snapshots so a refresh during an outage can restore the last received score. Cached data keeps its original update time and shows **FEED DELAYED**. Provider update times and clear backwards progress across sources keep an older fallback from replacing newer known information. The same source can still publish score and clock corrections. A fresh backup is labeled **Backup feed**.

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
python scripts/test_package_windows_release.py
# Run on Windows:
npm run test:smoke --prefix desktop
npm run dist:win --prefix desktop
python scripts/package_windows_release.py
```

The suites cover feed normalization, missing/malformed data, event deduplication and silent baselines, polling recovery, team hit areas, screen-edge snapping, outward stats placement, and the desktop update lifecycle. Release-package tests reject mismatched versions, external installer links, bad hashes, and broken blockmaps. Windows CI checks the actual native window, preload, positioning, team-stats IPC, and transparency before packaging. Workflow artifacts are retained for 30 days. Bump the matching package versions and merge to `main` to publish the verified downloads automatically. Publication uses that run's exact commit and checks asset hashes before making the draft public; see [publishing a release](GITHUB-ACCESS.md#publish-a-new-download).

## Windows feature updates

The installed Windows app uses `electron-updater` with releases from `aaraven99/scorebug`. It downloads new stable versions in the background and applies ready updates when the app quits. **Restart to update** applies one immediately. An offline check or failed download leaves the running scorebug intact.

Automatic updates run only in the packaged Windows installer version. Development runs and portable copies do not install updates. The settings page explains how portable users can switch to the installer. Saved preferences use the same Scorebug user-data folder.

Publishing must include `latest.yml`, its exact versioned NSIS installer, and the matching blockmap. The packager validates these before the release job makes them public. The app is unsigned; update integrity comes from the GitHub HTTPS feed and manifest hashes, without an Authenticode publisher guarantee.

### API and code map

```text
GET /api/scoreboard
GET /api/scoreboard?date=YYYYMMDD
GET /api/game?id=<numeric-game-id>
```

Dates and game IDs are validated. Upstream requests use fixed URLs, a 4 MB response limit, and the timeout budget described above. Responses include `sourceId`, `feedStatus` (`primary`, `backup`, or `cached`), and `stale`. `fetchedAt` always refers to the last successful snapshot, including during an outage.

`public/scorebug.js` renders both layouts; `score-client.js` and `game-details-client.js` manage updates. `game-events.js`, `game-activity.js`, and `score-animation.js` handle event detection and announcements. `details-*` implements team stats. `lib/feed-service.mjs` manages failover, while `lib/nfl.mjs`, `lib/details.mjs`, and `lib/thescore.mjs` normalize provider data. `server.mjs` serves locally; `desktop/` contains the native window and packaging.

