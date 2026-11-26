# Scorebug

A small, live NFL scorebug inspired by the classic FOX broadcast graphic. It can float above your work in a browser, or sit on your Windows desktop like a pet: transparent, frameless, always on top, and draggable with automatic snapping.

**The game clock is centered. There is no play clock.** Scores, quarter, possession, and down-and-distance come from the live feed. Chicago is the default team; you can choose any game in the schedule.

The outer edges are transparent, with no gray outline around the scorebug. The native app automatically changes to a vertical stack at the left-center and right-center positions. Hover over it to see a small field, the latest reported play, and current team totals.

## Windows: the desktop-pet experience

If you received **Scorebug-Portable-Windows.zip**, extract it, quit any older Scorebug instance from its tray menu, and open the included portable EXE. You can use that package immediately without GitHub or Vercel. Existing game and position preferences are retained.

To build your own copy through GitHub, first [put the updated source in the existing GitHub repository](#update-the-existing-github-repository). The Windows downloads appear after the updated workflow completes successfully.

1. Open [Build Windows desktop app](https://github.com/aaraven99/scorebug/actions/workflows/desktop.yml).
2. Open the latest successful run and download **Scorebug-Windows-x64** from its **Artifacts** section. GitHub requires you to be signed in to download workflow artifacts.
3. Extract the ZIP. Open `Scorebug-Portable-<version>-x64.exe` to run without installing, or use `Scorebug-Setup-<version>-x64.exe` for a normal installation. The filenames include the version built by that workflow run.
4. The scorebug appears at the bottom center and automatically selects the Bears game from the current schedule.
5. Drag it near a corner, side center, top/bottom center, or screen center. It snaps when you release the mouse. You can also right-click the scorebug and choose **Position**.

The packaged app includes everything it needs. **Vercel, Node.js, Python, and PowerToys are not needed to run the Windows app.** An internet connection is needed for scores. The application is unsigned; it does not have a purchased Windows code-signing certificate.

### Placement and hover details

**Left center** and **Right center** automatically use a narrow vertical scorebug. The other seven anchors use the horizontal broadcast layout. Dragging freely without snapping preserves the current shape. The game clock remains centered in either layout, and the play clock is omitted.

Hover briefly over the scorebug to open the details card. It shows:

- A field schematic with the reported ball position and first-down line, when available.
- The latest reported play description.
- Total yards, passing yards, rushing yards, third-down efficiency, turnovers, and time of possession for both teams.

The field shows the team with possession moving to the right for consistent reading; it represents the reported ball position, not tracked player locations. Missing field data and statistics remain unavailable instead of showing invented values.

On the desktop, the card opens in its own transparent, frameless window, toward the inside of the screen when space allows. The scorebug keeps its size and position. Moving from the scorebug into the card keeps it open; moving away closes it. You can also open it explicitly from the toolbar or **Current game details** in the right-click menu.

### Desktop controls

| Action | How |
| --- | --- |
| Move | Drag the scorebug |
| Choose an exact position | Right-click → Position, or open settings and use the nine-dot grid |
| Show field, latest play, and team stats | Hover over the scorebug, or right-click → Current game details |
| Change game, date, or size | Hover → settings button, or right-click → Choose game & settings |
| Use another monitor | Right-click → Monitor |
| Lock it in place | Right-click → Lock position |
| Turn automatic snapping on/off | Right-click → Snap near corners, sides & center |
| Recover its location | Tray menu → Reset to bottom center |
| Open settings | **Ctrl + Alt + Shift + S** |
| Quit | Hover → ×, tray menu → Quit Scorebug, or **Ctrl + Alt + Shift + Q** |

The settings window can be closed while the scorebug continues running. Placement, game choice, scale, and lock settings are saved. Snapping uses the monitor's work area so it stays clear of the taskbar. Display changes are handled by moving it back into a visible area.

Automatic drag-release snapping is implemented for **Windows**. Exact positions and dragging also work when running from source on supported macOS/Linux desktops, but those platforms do not have packaged releases here.

The updated Windows native runtime has **not been verified on Windows in this workspace**. The repository includes a Windows CI smoke check that must pass before its portable app and installer are packaged; a successful web build or geometry test alone does not establish Windows compositor behavior.

## Update the existing GitHub repository

In GitHub Desktop, clone `https://github.com/aaraven99/scorebug` using **File → Clone repository → URL**. Copy the supplied source project's contents into that clone, review the changed files, enter a commit summary, click **Commit to [branch]**, then **Push origin**. See [the complete GitHub Desktop instructions](docs/GITHUB-ACCESS.md), including how to use an existing clone.

Your repository ownership and the connected app's permissions are separate. The standard ChatGPT GitHub connection is documented as read-only; reconnecting it or changing repository selection does not grant write permissions. GitHub Desktop uses your own authenticated GitHub account. A writable Codex repository workspace is another option. The [access guide](docs/GITHUB-ACCESS.md) links the official documentation and explains the observed integration error.

## Deploy the web version on Vercel

Once the updated source is pushed, import **aaraven99/scorebug** from GitHub. The web project is ready for this Vercel configuration:

| Setting | Value |
| --- | --- |
| Framework preset | **Other** |
| Root directory | Repository root (`./`) |
| Install command | `npm ci` |
| Build command | `npm run build` |
| Output directory | `dist` |
| Node version | 24.x (22.x also supported) |
| Environment variables / API keys | None |

The included `vercel.json` sets the build and output directory. Vercel deploys `api/scoreboard.js` and `api/game.js` as Node.js functions. The desktop package has its own dependencies and is **not** installed by the web build.

On the deployed site, choose a game and click **Float in browser**. Chrome/Edge's Document Picture-in-Picture creates an always-on-top window. Drag that window where you want it and keep its original tab open. Its live-data runtime executes inside the floating window.

Browser Picture-in-Picture retains browser window controls and cannot automatically snap or provide a fully transparent desktop background. Use the native desktop app for those features.

The page and floating browser widget also offer the hover details card, constrained to their browser window. A browser can still draw its own outer frame even though the scorebug graphic itself has transparent edges.

### PowerToys fallback

If browser floating mode is unavailable, choose **Clean view**:

- **Win + Ctrl + T** pins the active window above others.
- **Win + Ctrl + Shift + T** opens Crop And Lock's live thumbnail selector; select the scorebug.

## Run from source

Requires Node.js 22 or newer.

```sh
git clone https://github.com/aaraven99/scorebug.git
cd scorebug
npm ci
npm run dev
```

Open `http://localhost:3000`. The web app has no runtime npm dependencies.

For the desktop companion:

```sh
npm ci --prefix desktop
npm run desktop
```

For a Windows portable app and installer, run on Windows:

```sh
npm run dist:win --prefix desktop
```

The `Build Windows desktop app` GitHub Actions workflow runs automatically when desktop/web source changes on `main`. Downloads are stored as build artifacts for 30 days; rerun the workflow if an artifact expires.

## Live data and update behavior

- The server reads [ESPN's public NFL scoreboard endpoint](https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard) and its [game summary endpoint](https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary). These are unofficial integrations with publicly reachable endpoints, not officially supported or guaranteed APIs.
- Scores, quarter, reported game clock, possession, down-and-distance, and last play are refreshed by polling every **10 seconds**. The page does **not** reload.
- The hover card uses the current scoreboard's ball position and latest play, with the summary feed supplying team totals and a play-description fallback. It requests details only while open and refreshes them approximately every **10 seconds**.
- The server shares in-flight requests between concurrent clients and caches scoreboard results for **5 seconds** and game summaries for **10 seconds**. API responses use `Cache-Control: no-store` so a browser does not quietly reuse old score data.
- A fetched timestamp means **last checked**, not the timestamp when the play happened. ESPN and your video broadcast may have different delays.
- The game clock displays ESPN's latest reported time. It does not count down locally because the feed does not reliably say whether the clock is running.
- The feed does not reliably expose the play clock. The scorebug omits it entirely and centers the game clock instead.
- Scheduled games, halftime, quarter breaks, finals, delays, suspensions, postponements, and cancellations have distinct displays. Missing data is not replaced with sample scores.
- A failed request keeps the last received scores with a visible **FEED DELAYED** flag. Retries back off to 20/40/60 seconds and resume normal polling after success. Focus, connectivity restoration, and page restoration also trigger a refresh.
- If the separate stats request fails, the card labels the last received totals as delayed and retries. The main score feed continues independently.
- Desktop renderer throttling is disabled. The computer still needs to be awake and online. Browsers can slow or discard ordinary background tabs; the visible floating window is the intended browser experience.

The **Compare reference** button only previews the SF/KC design from the supplied screenshot. That preview is explicitly labeled and is never used as the live feed or as an error fallback.

### API

```text
GET /api/scoreboard
GET /api/scoreboard?date=20261126
GET /api/game?id=<numeric-game-id>
```

The optional date is validated as a real `YYYYMMDD` calendar date. The default is ESPN's current NFL schedule. Responses include `games`, `fetchedAt`, `source`, and `sourceUrl`. Each game includes normalized teams, scores, phase/status, clock, possession, situation, and broadcast information.

`/api/game` accepts one numeric ESPN game ID and returns `gameId`, `fetchedAt`, `teamStats`, `lastPlay`, `recentPlays`, and other normalized game-detail fields. Its summary may lag the scoreboard; the UI uses the scoreboard for the current field situation.

Both endpoints have an 8-second upstream timeout, response-size limits, shape validation, and no client-configurable upstream URL.

## Typography

The score and clock use a self-hosted **Saira** variable font with genuine italic outlines and heavy, condensed settings. This replaces the earlier type treatment with a closer broadcast-style approximation. The exact font in the supplied FOX reference could not be verified from a primary source, so this project does not claim an exact font match. See [font research and verified axes](docs/FONT-RESEARCH.md) and the bundled [SIL Open Font License](public/fonts/Saira-OFL.txt).

## Project layout

```text
public/                Browser UI and independent floating-widget runtime
public/scorebug.js      Scalable classic scorebug renderer
public/score-client.js  Selection, shared preferences, polling, and freshness
public/details-*       Hover-card behavior and live details runtime
public/field.js         Reported ball-position schematic
api/scoreboard.js       Same-origin Vercel/Node API handler
api/game.js             On-demand game-summary API handler
lib/nfl.mjs            ESPN normalization and short-lived shared cache
lib/details.mjs         Summary/play/stat normalization and shared cache
server.mjs             Local HTTP server, embedded by the desktop app
desktop/               Native Electron app, snapping geometry, packaging
tests/                 Feed/selection/lifecycle regression tests
```

## Verification

```sh
npm test
npm test --prefix desktop
npm run build
```

The regression suites cover feed and summary normalization, missing/malformed data, field-position mapping, date/game-ID validation, caching, selection, stale labels, polling restart, and snapping on offset/small/multiple monitors. Native geometry and hover-intent tests cover card placement, pointer transitions, and dismissal.

Windows CI is configured to launch the actual native app and check transparency, always-on-top status, all nine positions and their orientations, locking, settings IPC, and the inward details window before packaging. That workflow provides the Windows runtime gate; this update's actual Windows behavior remains unverified until the workflow and a Windows desktop run succeed.

## Credits

An unofficial personal fan project inspired by the supplied classic FOX scorebug. Not affiliated with or endorsed by FOX, ESPN, the NFL, or any team. Team names and marks belong to their owners. See [asset sources](docs/ASSETS.md) and the bundled [Saira font license](public/fonts/Saira-OFL.txt).
