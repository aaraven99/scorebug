# Scorebug

A live NFL scorebug that floats above your other apps.

## Get the Windows app

**[Download Scorebug for Windows](https://github.com/aaraven99/scorebug/releases/latest/download/Scorebug-Setup-Windows.exe)**

1. If an older Scorebug is running, right-click its tray icon and choose **Quit Scorebug**.
2. Run the downloaded **Scorebug-Setup-Windows.exe**.
3. Open **Scorebug**. Your saved game, size, and position carry over.

Install it once. Future updates download in the background and install when you quit Scorebug. You can also open Settings and choose **Restart to update** when an update is ready. The app won’t restart in the middle of a game.

Settings also has **Check for updates** and an **Automatically check for updates** checkbox. Turning that checkbox off stops background checks. Any update you already downloaded still installs when you quit.

Prefer no installation? [Download the portable ZIP](https://github.com/aaraven99/scorebug/releases/latest/download/Scorebug-Portable-Windows.zip), extract it, and open **Scorebug-Portable-…-x64.exe**. Portable copies need manual updates. To switch to automatic updates, quit the portable app and run the installer above.

No PowerToys, Python, Node.js, or Vercel setup is needed. The app is unsigned.

## Use it

- **Automatic** follows a game that is live now, including halftime and quarter breaks. It has no favorite team. Choose a game yourself to keep that matchup pinned.
- **Drag near a side edge and release** for the vertical layout. Top and bottom positions stay horizontal.
- **Hover a team’s colored panel** for its stats. Move into the expanded stats to keep them open.
- **Click the gear** to choose a game or change the size.
- **Right-click** for position, monitor, lock, and quit options.

Scores and stats check for updates about every 2 seconds without reloading. The game clock shows the latest time reported by the feed; the provider can still lag behind the game or your TV. The computer needs to stay awake and online. Ordinary browser tabs may slow down in the background; the Windows app keeps checking.

If a feed fails, Scorebug switches between ESPN, theScore, and FOX automatically. Team stats can be marked delayed while backup play updates continue. If every feed is down, the last score stays visible with a **FEED DELAYED** label while Scorebug keeps trying.

## Put the web version on Vercel

Import [aaraven99/scorebug](https://github.com/aaraven99/scorebug) and use:

| Setting | Value |
| --- | --- |
| Framework | Other |
| Root directory | `./` |
| Install command | `npm ci` |
| Build command | `npm run build` |
| Output directory | `dist` |
| Node.js | 24.x |
| Environment variables | None |

Use `main` as the production branch. On the site, pick a game and click **Float in browser**. The desktop app works independently of Vercel.

Visitor counts are included. In your Vercel project, enable **Web Analytics**, then deploy to production. Open **Analytics** to see visits and page views. Only production website pages are counted.

## More details

[Run from source and tests](docs/DEVELOPMENT.md) · [GitHub updates and releases](docs/GITHUB-ACCESS.md) · [Fonts and assets](docs/ASSETS.md)

Unofficial fan project. Not affiliated with FOX, ESPN, the NFL, or any team.
