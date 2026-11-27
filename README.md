# Scorebug

A live NFL scorebug that floats above your other apps.

## Get the Windows app

**[Download the latest Scorebug](https://github.com/aaraven99/scorebug/releases/latest/download/Scorebug-Portable-Windows.zip)**

1. Download the ZIP and extract it into a folder.
2. If an older Scorebug is running, right-click its tray icon and choose **Quit**.
3. Open the **Scorebug-Portable-…-x64.exe** inside the extracted folder.

That’s it. No installation, PowerToys, Python, Node.js, or Vercel is needed. Your saved game, size, and position carry over when you update. The app is unsigned.

Prefer an installer? [Download the Windows setup file](https://github.com/aaraven99/scorebug/releases/latest/download/Scorebug-Setup-Windows.exe).

## Use it

- **Drag near a side edge and release** for the vertical layout. Top and bottom positions stay horizontal.
- **Hover a team’s colored panel** for its stats. Move into the stats card to keep it open.
- **Click the gear** to choose a game or change the size.
- **Right-click** for position, monitor, lock, and quit options.

Scores update about every 10 seconds without reloading. The game clock shows the latest time from the feed. The computer needs to stay awake and online.

If a feed fails, Scorebug switches to a backup automatically. If every feed is down, it keeps the last received score visible with a **FEED DELAYED** label and keeps trying.

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

## More details

[Run from source and tests](docs/DEVELOPMENT.md) · [GitHub updates and releases](docs/GITHUB-ACCESS.md) · [Fonts and assets](docs/ASSETS.md)

Unofficial fan project. Not affiliated with FOX, ESPN, the NFL, or any team.
