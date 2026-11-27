# Scorebug

Keep a live score above your other apps. Choose your sport, save your favorite teams and scorebug styles, and start watching.

**[Open Scorebug in your browser](https://sports-scorebug.vercel.app/)**

## Download the app

| Your computer | Download |
| --- | --- |
| Windows | **[Windows installer](https://github.com/aaraven99/scorebug/releases/latest/download/Scorebug-Setup-Windows.exe)** |
| Mac with an M-series chip | **[Mac — Apple silicon](https://github.com/aaraven99/scorebug/releases/latest/download/Scorebug-Mac-Apple-Silicon.dmg)** |
| Mac with an Intel processor | **[Mac — Intel](https://github.com/aaraven99/scorebug/releases/latest/download/Scorebug-Mac-Intel.dmg)** |

**Windows:** quit an older copy if it is running, open the installer, then open Scorebug. Future versions download automatically and install when you quit. You can also choose **Restart to update** in Settings. Your preferences carry over.

**Mac:** requires macOS 13 or newer. Open the DMG and drag Scorebug into Applications. Check **Apple menu → About This Mac** if you are unsure which download to use. This first Mac release is not Apple-notarized. If macOS blocks it and you trust the download, try opening the app, then go to **System Settings → Privacy & Security → Open Anyway**. Mac updates are manual for now: quit Scorebug and replace the app in Applications. Your preferences stay saved.

Prefer a Windows app without an installer? [Download the portable ZIP](https://github.com/aaraven99/scorebug/releases/latest/download/Scorebug-Portable-Windows.zip), extract it, and open the Scorebug-Portable application. Portable copies need manual updates.

If a download does not start, [open the latest release](https://github.com/aaraven99/scorebug/releases/latest) and expand **Assets**. Choose the file for your computer. No PowerToys, Python, Node.js, or Vercel setup is needed to use the app.

## Start watching

1. **Choose a sport or league.** Leave **Automatic** selected to follow a live game, or click a game to keep watching that one. The **College sports** group includes college football and men's and women's college basketball.
2. **Save your teams.** Under **Favorite teams**, open **Add a team or competitor**, type a name, and click its result. **All sports** searches across every supported league, including college sports. The directories load in the background; progress and any missing coverage appear beneath the results. **Filter by sport** narrows the results if you want. When a favorite plays live, its game appears in **Favorite teams** and in its league’s **Live now** list. Automatic prefers a live favorite in the selected league.
3. **Pick and save your styles.** Choose a look in **Scorebug style** or **Browse styles**. Click its star to save it under **Favorite styles**, then click its saved name whenever you want to switch. In **Browse styles**, turn on **Favorites only** to show your saved looks.
4. **Place the scorebug.** Drag the desktop app to an edge and release to snap it. Side positions use a compact vertical layout. On the website, choose **Normal** or **Side**, then **Float in browser**.

Teams, saved styles, and layout are remembered on this device. To remove a saved style, click its star again or the × beside its name.

Starring a look keeps your current game and style. Your selected style also stays selected when you change sports—for example, NBA in NFL-Blades still shows basketball scores and stats.

Hover a team logo or its timeout marks for that team’s stats. Hover the middle clock area to compare the teams and see the reported field position. The field stays in the middle panel. Racing layouts use the session header for the classification and timing details.

For a larger view, open **Game center**. It puts the available score, team or driver standings, statistics, player details, and play history together. The **Try an animation** controls preview events without changing the live score.

For Formula 1, use **Drivers shown** beneath the style controls to show a few drivers or the full field. The floating window grows with the list and fits it within your screen. Driver names appear on their own line in animations; safety car, VSC, and race-control flags apply to the whole session and do not name a driver.

## Watch on your phone

Open **[Standby](https://sports-scorebug.vercel.app/standby.html)** in your phone's browser. Turn your phone sideways for a quiet score display. Portrait works too.

1. Tap **Change** on a score to choose its sport, game and style.
2. Tap **Add game** to follow up to **four games at once**. Each card has its own selections, and your board is remembered on this device.
3. Tap **Keep screen awake** if you want the display to stay on. The status tells you whether the browser granted it. **Dim display** lowers the brightness within the page, and **Hide controls** makes more room for scores.
4. Tap **Game stats** on a card to open that game's full details.

**Full screen** works where the browser supports it. On iPhone, you can also use **Share → Add to Home Screen** and open Scorebug from that icon. This is a website, so no App Store download is needed. It runs while the page is open and visible; it is not an iPhone lock-screen widget. Scores refresh when you return to the page.

Games from the same league and date share one update stream. A failed connection keeps the last confirmed score on screen with a delayed label.

## Sports and styles

There are **30 league and competition choices**: NFL and college football; NBA, WNBA, and college basketball; MLB; NHL; ten soccer competitions; Formula 1, NASCAR, and IndyCar; ATP and WTA tennis; PGA and LPGA golf; three rugby competitions; and college volleyball.

The **83 selectable styles** follow the score and timing layouts in the supplied reference atlas. Each has Normal and Side views. They are responsive interpretations, with adjustments for readable stats and hover panels. [See all styles](docs/STYLES.md).

Animations use the selected sport’s events: touchdowns and turnovers, three-pointers and lead changes, home runs, goals, set wins, and reported race flags. Names and photos appear when the source provides them. Opening an event does not replay its old highlights.

## Live data

The selected game checks for updates about every **2 seconds**. Other leagues containing your favorites check about every **5 seconds**. Nothing needs a page refresh. Your computer must stay awake and online; an ordinary browser tab can slow down in the background.

Providers can be slower than these checks or than your TV. Scorebug shows the clock the source reports. If a source fails, it tries the available backups. If all sources fail, the last received score remains visible with a delayed label. Missing stats stay unavailable.

**Formula 1:** practice, qualifying, sprint qualifying, sprints, and races appear when scheduled. Public session data works without an account. Richer live OpenF1 timing requires an existing paid OpenF1 account configured on the server; it is not included with the app. Gaps, tyres, and flags appear only when reported. OpenF1 timing has its own update cadence.

**Cricket:** cricket-inspired visual styles are included, but a verified live cricket feed is not included in this release. Some smaller leagues also provide less detail than NFL or NBA. [See the sports, providers, and coverage limits](docs/DATA.md).

## Put your own copy on Vercel

Import [aaraven99/scorebug](https://github.com/aaraven99/scorebug) and use these settings:

| Setting | Value |
| --- | --- |
| Framework | Other |
| Root directory | `./` |
| Install command | `npm ci` |
| Build command | `npm run build` |
| Output directory | `dist` |
| Node.js | 24.x |
| Production branch | `main` |
| Required environment variables | None |

OpenF1 credentials are optional; [setup details are here](docs/DATA.md#formula-1-timing). The desktop app works independently of Vercel.

Visitor counting is included. Enable **Web Analytics** in the Vercel project, then deploy to production. Only production website pages are counted.

## For contributors

[Run from source and test](docs/DEVELOPMENT.md) · [Deep QA checks](docs/QA.md) · [Publish an app update](docs/GITHUB-ACCESS.md) · [Fonts and artwork](docs/ASSETS.md)

Unofficial fan project. Not affiliated with the broadcasters, leagues, teams, or data providers whose names appear in the app.
