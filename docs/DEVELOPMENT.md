# Develop and test Scorebug

[Back to setup](../README.md) · [Data coverage and limits](DATA.md) · [Publish a release](GITHUB-ACCESS.md)

## Run the website

Install Node.js 22 or newer, then run:

```sh
git clone https://github.com/aaraven99/scorebug.git
cd scorebug
npm ci
npm run dev
```

Open `http://localhost:3000`. The local server and Vercel use the same API handlers. No API key is required for the basic score feeds. Optional OpenF1 live access is explained in [DATA.md](DATA.md#formula-1-timing).

## Run the floating desktop app

```sh
npm ci --prefix desktop
```

On a Mac, install Apple's Command Line Tools if they are missing. Run `xcode-select --install` and finish that installer, then build the drag-release helper:

```sh
npm run build:mac-helper --prefix desktop
```

Start the app:

```sh
npm run desktop
```

The Mac app requires macOS 13 or newer. Run native tests on the operating system being tested; browser previews cannot verify a Windows or Mac window.

## Check a change

```sh
npm test
npm test --prefix desktop
npm run build
npx playwright install --with-deps chromium webkit
npm run qa
npm run qa:mobile
```

The tests cover sports data, event detection, favorites, style rendering, game identity, polling, hover geometry and desktop updates. The browser checks run every league/style/orientation combination three times and repeat user workflows in Chromium and WebKit, including phone Standby. These are required for every edit; see [the QA guide](QA.md) and [project instructions](../AGENTS.md). Reports and screenshots are saved under `test-results/qa/` and uploaded by CI. On Windows or Mac, also run:

```sh
npm run test:smoke --prefix desktop
```

That opens real windows and checks preload access, positioning, snapping, transparency, stats extensions and full-screen mode. It includes deterministic NBA and F1 examples, so feed availability does not decide whether the window tests pass. Mac runs need the helper built first.

For release-script changes, run these with Python 3 (`python3` on macOS):

```sh
python scripts/test_package_windows_release.py
python scripts/test_combine_desktop_release.py
```

## Build installers

On Windows:

```sh
npm run dist:win --prefix desktop
python scripts/package_windows_release.py
```

On an Apple Silicon Mac:

```sh
npm run dist:mac --prefix desktop -- --arm64
```

Use `--x64` on an Intel Mac. Builds appear in `desktop/release/`. The release workflow also launches each packaged Mac app and verifies its architecture, signature and archives before preparing the public downloads. See [the release guide](GITHUB-ACCESS.md#publish-a-new-download) for the complete process.

The Windows installer supports automatic feature updates. Portable Windows copies and the current Mac builds need a new download for feature updates. Mac builds are ad-hoc signed, without Apple Developer ID signing or notarization. They may need **System Settings → Privacy & Security → Open Anyway** on first launch. [Apple explains this step](https://support.apple.com/en-us/102445).

## APIs

All three routes accept `GET` and `HEAD`. League names come from `public/sports.js`; omitting the scoreboard or teams league selects NFL. Dates use `YYYYMMDD`.

| Request | Returns |
| --- | --- |
| `/api/scoreboard?league=nba` | Current NBA games |
| `/api/scoreboard?league=mlb&date=20261101` | Games for a selected date |
| `/api/game?league=nba&id=nba:401000001` | One game's stats and events |
| `/api/game?league=f1&id=f1:401000001&date=20261101` | Details for a dated session |
| `/api/teams?league=nhl` | Teams available to save as favorites |

The IDs above illustrate the format. Use an actual ID from a scoreboard response. NFL keeps its existing IDs; other sports use a league prefix, such as `nba:` or `f1:`. Requests reject invalid leagues, dates and mismatched identities.

The client usually checks scores and selected-game details every two seconds without reloading the page. Requests do not overlap, failures back off, and stale data keeps its original timestamp. Provider updates can arrive later than the polling interval. F1 detailed timing has its own cache and access limits. [DATA.md](DATA.md) describes the feeds, fallbacks and unavailable fields.

## Where to edit

| Area | Main files |
| --- | --- |
| Leagues and provider data | `public/sports.js`, `lib/multisport.mjs`, `lib/openf1.mjs`; existing NFL adapters remain in `lib/` |
| Styles and scorebug drawing | `public/scorebug-styles.js`, `scorebug.js`, `scorebug-variants.js`, `scorebug.css` |
| Preferences, favorites and polling | `public/preferences-model.js`, `favorites.js`, `style-favorites.js`, `score-client.js`, `game-details-client.js` |
| Sport stats and animations | `public/sport-stats.js`, `sport-events.js`, `game-activity.js`, `score-animation.js` |
| Hover stats and full-screen view | `public/details-*`, `game-view.js`, `sport-view.js`, `game.js` |
| Phone Standby and multiple scores | `public/standby.html`, `standby.js`, `standby-model.js`, `standby-feeds.js`, `standby-screen.js`, `standby.css` |
| Repeated browser and visual QA | `scripts/qa-scorebug.mjs`, `tests/qa/`, `docs/QA.md` |
| Native windows and releases | `desktop/`, `scripts/package_*_release.py`, `scripts/combine_desktop_release.py`, `.github/workflows/desktop.yml` |

Keep game and team IDs scoped to their league. Style changes must retain the selected sport's data and hover targets. New stats should stay unavailable when a feed does not report them; samples and animation demos must remain clearly labeled.
