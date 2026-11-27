# Browser checks

These checks run the actual Scorebug pages and SVG renderer in a browser. Every matchup score, clock, race gap and classification position in this suite is synthetic test data, not a reported sporting result. Team and competitor identities come from the audited league directories; the fixed Formula 1 grid additionally keeps the Kimi Antonelli regression. Controlled scores and API failures make results repeatable without needing a real game to be on.

## Run them

Use the Node version declared in `package.json`, then install the locked dependencies and both browsers:

```sh
npm ci
npx playwright install --with-deps chromium webkit
```

Run the complete Chromium checks and the phone checks in WebKit:

```sh
npm run qa
npm run qa:mobile
```

The server starts inside the test process on a free local port. You do not need to run `npm start` separately.

Useful smaller commands:

```sh
npm run qa:matrix
npm run qa:flows
node scripts/qa-scorebug.mjs --suite matrix --browser chromium --passes 1 --case-limit 180 --output /tmp/scorebug-qa-diagnostic
```

`--case-limit` is a diagnostic option. Its report is labelled as a partial run and cannot replace the release checks. Release commands repeat the entire suite three times. A missing browser, missing audited directory, exception, failed assertion, or unexpected browser error produces a failing exit status; it is not counted as a pass.

Normally, use the Playwright browser installed above. `SCOREBUG_QA_CHROMIUM_EXECUTABLE` can point to a separately installed Chromium for a local environment where the browser download is blocked. The report records that override and the actual browser version. Release CI installs the normal Playwright browsers.

## What the counts mean

The matrix has **30 leagues × 83 styles × 2 orientations × 3 complete passes = 14,940 cases**. Every case is rendered at three widths, for **44,820 layout trials**:

| Orientation | Widths |
| --- | --- |
| Normal | 600, 420, 300 pixels |
| Side | 160, 144, 112 pixels |

All three passes repeat the same combinations and widths. A pass is not just a different screen size.

The browser measures real layout after loading the bundled fonts. It checks game, league, style and orientation identifiers; SVG references; keyboard-accessible detail targets; finite geometry; text staying within the SVG; score, clock and sport-specific situation labels; classification order; critical logo/score/caption/possession/name/gap overlaps; and timeout corners staying inside visible team panels. Logo checks use the visible artwork bounds. Text overlap checks use actual glyph measurements, so empty font padding is not mistaken for a collision. Critical text colors are checked against the actual painted background, with outlined text handled separately.

The interaction suite uses actual controls to change every league and style in Chromium. WebKit repeats all leagues with a representative spread of styles, then runs the same phone and lifecycle checks. The exhaustive renderer matrix remains the Chromium suite. These counts are reported separately from individual assertions.

Each pass also covers favorite styles, team favorites, global search, saved settings, shared pop-out preferences, side layout, the full racing grid, Game Center, every supported sport's demo menu, animation entry and exit, failed feeds, stale snapshots, recovery, and listener/timer stability. All demo kinds must enter and complete a real CSS exit. Natural timeout is checked separately without shortening its hold.

Rapid real selections and immediate reloads also check the shared URL updater in settings, Game Center and pop-outs. The related unit tests cover Safari history throttling, explicit shared links and cache-quota recovery. User choices can evict only the disposable directory and scoreboard caches when an actual quota error occurs; blocked storage still reports a failed save.

A delayed-navigation regression holds the actual Game Center reload response while the outgoing page finishes updating its URL. The reloaded page must keep the newest saved selection, including when more than one URL update happens during the delay. A fresh shared link must still open the selection in that link.

An image-failure scenario aborts the actual remote logo requests, checks that the broken image is hidden and replaced by a readable abbreviation, then verifies that a fresh successful image load removes the fallback. The successful response in that scenario uses the app icon as a PNG fixture; it proves loading recovery, not the accuracy of an external crest. Bundled real logos are separately decoded. Contact-sheet reports record which external images loaded and which show text replacements.

A separate favorite-removal check holds a real logo request until the pointer is down on Remove, then fails that request. The button must keep its exact bounds and the original pointer release must remove the favorite. The check also verifies a second removal and saved preferences after a reload; its diagnostics retain scroll and layout measurements if the gesture fails.

The team-search corpus is in `tests/fixtures/directory-audit/`. The report lists the source coverage and number of available teams or competitors for each league. Every available name is searched globally and within its league using the real browser search module. The UI separately adds a representative favorite from each nonempty directory. An event entrant list is not called a complete worldwide athlete directory, and an empty provider directory is not filled with invented entrants for this coverage count.

## Phone Standby

Phone checks use portrait and landscape viewports, including a small 320 × 568 screen and its landscape counterpart. They exercise four independent cards, saved choices, remove/add, hiding controls, keyboard recovery, dimming, pooled polling, page hide/show, and visibility changes.

Quiet landscape is checked for all four cards fitting on the screen. A short portrait display may scroll vertically to keep the cards readable; the checks still reject horizontal overflow and content escaping its card.

Wake Lock and Fullscreen permission outcomes are simulated through browser API mocks so success, denial, unsupported APIs, operating-system release, pause and resume can all be tested every time. The report does not claim those mocks prove that an actual iPhone will grant a wake lock. Real-browser rendering and input still run in Chromium and WebKit.

## Reports and screenshots

Outputs are written to:

```text
test-results/qa/chromium/
test-results/qa/webkit/
```

Open `report.html` for the summary and failures. `report.json` contains the browser version, source commit/tree, whether the working tree was dirty, counts, timing, coverage and network/lifecycle results. `matrix-cases.json` contains every matrix case and width profile. Screenshots include contact sheets of all styles, league examples, phone views and failures.

The report also shows a `browserDiagnostics` count. [Playwright issue #43120](https://github.com/microsoft/playwright/issues/43120) documents WebKit reporting cancelled requests from an outgoing document as access-control page errors. Our repeated browser probes reproduced this without any cross-origin request or uncaught application error. The suite separates only the exact native WebKit signature for the observed `/api/scoreboard` and `/api/game` endpoint/caller pairs, during an explicit reload between its actual main-document request and first commit. The complete errors and navigation ledger remain in the JSON. Other engines, origins, endpoints, callers, error signatures and times still fail the gate.

Native `ErrorEvent` and `unhandledrejection` listeners run independently and persist their records across reloads. Every such error fails the run, including a deliberately thrown message that resembles the native diagnostic. Unavailable error telemetry also fails. The screen-permission mocks follow trusted browser visibility events, so they cannot restart polling after a real `pagehide`.

Generated screenshots are not automatically marked as manually reviewed. A reviewer should open the relevant sheets, inspect the failures and representative layouts, and record which images they inspected. Do not describe 44,820 automated layouts as 44,820 manual visual reviews.

The first full matrix on the development machine took about one minute. UI runs take longer because actual interactions, animation exits and polling/visibility intervals are exercised. Use each report's elapsed time for that machine rather than treating the first timing as a performance guarantee.

## What remains separate

Keep the unit tests, build, and native release gates:

```sh
npm test
npm run build
npm --prefix desktop test
```

Windows and both Mac architectures still run the source and packaged-app checks in the desktop release workflow. Browser checks cannot prove native transparency, window snapping, macOS Spaces behavior, signing, installer behavior, or Windows automatic updates.

The deterministic suite also cannot prove that a public feed is currently live, complete or fast. Read `docs/DATA.md` for actual provider coverage and limits. Unexpected API failures in production need a separate live investigation; a deliberately injected 503 in the QA report is expected only in its failure/recovery scenario.
