# Where scores come from

Scorebug reads public score feeds on its server. The website and desktop app use the same adapters. Missing stats stay blank; the app does not invent a running clock, possession, field position, shot clock, or race flag.

## Sports in this release

| Sport | Leagues | Available information |
| --- | --- | --- |
| Football | NFL, college football | Scores, clock, possession, timeouts, down and distance, reported field position, box scores and plays |
| Basketball | NBA, WNBA, men's and women's college basketball | Scores, periods, clock, team/player stats, shooting percentages and plays; timeouts, bonus and shot clock when reported |
| Baseball | MLB | Runs, innings, balls/strikes/outs, runners, batting/pitching stats and plays when reported |
| Hockey | NHL | Scores, periods, clock, team/player stats and plays; power-play information when reported |
| Soccer | Premier League, Champions League, MLS, LaLiga, Bundesliga, Serie A, Ligue 1, NWSL, Women's Super League, World Cup | Scores, match clock, team stats, cards and reported match events |
| Motorsport | Formula 1, NASCAR Cup, IndyCar | Session schedules and reported classification. F1 includes practice, qualifying, sprint qualifying, sprint and race sessions when scheduled |
| Tennis | ATP, WTA | Individual singles/doubles matches, set results, tiebreaks and reported current points/service |
| Golf | PGA Tour, LPGA Tour | Leaderboard, score relative to par and reported round/hole scores |
| Rugby | NRL, Six Nations, Super Rugby Pacific | Scores, match clock and available match details |
| Volleyball | Men's and women's college volleyball | Sets won and points in each reported set |

Not every league supplies a full box score or play-by-play. A tournament can appear before its tennis draw is published. That is shown as no available matches, rather than two invented competitors.

The cricket designs are selectable styles. A reliable live cricket feed is **not** included: the tested ESPN IPL route returned empty match objects, and the Cricinfo current-matches endpoint denied access. The app does not label sample cricket data as live.

## College sports

Find the college leagues under **College sports** in the league or favorite-team selector. College football includes ESPN's reported Division I games, both FBS and FCS. Men's and women's basketball include unranked Division I games as well as ranked teams. Football uses quarters, men's basketball uses two halves, and women's basketball uses four quarters. The clock, downs, possession, timeouts, player photos and box scores appear when the feed supplies them.

Football uses ESPN's Division I group `90`; basketball uses group `50`. These are different filters. The scoreboard request keeps `limit=300`: during validation, setting the football limit to `1000` silently reduced a 58-game FBS schedule to 25 games. The Nov. 21, 2026 Division I check returned 116 distinct games, exactly the combined FBS and FCS lists with shared matchups counted once.

Selecting a college league for favorite-team search loads its complete available team directory once, then searches locally as you type. Schools in different sports have separate favorites. ESPN's football directory also lists schools outside Division I; the football schedule covers Division I. College feeds use the same ESPN route fallbacks and clearly marked cached data described below.

## Formula 1 timing

The public ESPN feed supplies scheduled weekend sessions and classification. Free historical OpenF1 data adds driver/team details, gaps, tyres, results and race-control history.

**Live OpenF1 timing requires an OpenF1 live account.** No subscription is created by Scorebug. Without one, the app still shows ESPN's available session data and explains the timing limit.

For an existing live account, set `OPENF1_USERNAME` and `OPENF1_PASSWORD` as server environment variables. Alternatively, use `OPENF1_TOKEN`; a supplied token must be renewed when it expires. The username/password route renews its token automatically. These values are never included in browser responses or committed to this repository.

Only the selected session requests detailed timing. Live timing is cached for 10 seconds, historical results for 5 minutes, and request limits and `Retry-After` are respected. This is separate from the app's two-second score polling. A tyre stint is not presented as a pit stop, and a sector-yellow flag does not clear a safety car. The current adapter does not automatically detect fastest laps: the result endpoint does not provide that field, and race duration is not a lap time. Its animation remains available in the demo.

## Fallbacks

NFL retains its ESPN, theScore and FOX adapters. MLB also has an independent fallback to MLB's official Stats API. It provides scores, innings, count and runners when reported. Full player stats and play-by-play may be unavailable during an ESPN outage.

Other leagues use ESPN's site API and web API routes plus the last confirmed cached response. Those two ESPN routes are route fallbacks from the same provider, not independent data companies. The direct NBA and NHL feeds rejected validation requests, so this release does not claim independent fallbacks for those leagues. Delayed cached scores retain their original timestamp and are marked delayed.

MLB's team IDs are matched to all 30 verified ESPN team identities. A game keeps its ESPN ID only when the home team, away team and start time identify one game in both schedules. Ambiguous doubleheaders retain their official MLB IDs. That prevents details from a different game appearing under the selected score.

A missing box score can fall back to the selected game's scoreboard. Previously received team stats remain marked stale rather than being presented as new statistics. Invalid or mismatched game IDs are rejected.

The WNBA team directory omits Connecticut during calendar 2026. A separate verified team request keeps the Connecticut Sun selectable for that season, including their actual logo. Team counts and branding continue to come from the provider.

## Source references

- [ESPN NBA scoreboard](https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard)
- [ESPN Formula 1 sessions](https://site.api.espn.com/apis/site/v2/sports/racing/f1/scoreboard)
- [Official MLB schedule and linescore](https://statsapi.mlb.com/api/v1/schedule?sportId=1&hydrate=linescore,team)
- [Official MLB team directory](https://statsapi.mlb.com/api/v1/teams?sportId=1&season=2026)
- [ESPN MLB team identities](https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/teams?limit=1000)
- [ESPN Connecticut Sun team details](https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/teams/18)
- [ESPN Division I college football scoreboard](https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?limit=300&groups=90)
- [ESPN Division I football group definition](https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/2026/types/2/groups/90)
- [ESPN men's Division I basketball scoreboard](https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?limit=300&groups=50)
- [ESPN women's Division I basketball scoreboard](https://site.api.espn.com/apis/site/v2/sports/basketball/womens-college-basketball/scoreboard?limit=300&groups=50)
- [ESPN college football team directory](https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams?limit=1000)
- [ESPN men's college basketball team directory](https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams?limit=1000)
- [ESPN women's college basketball team directory](https://site.api.espn.com/apis/site/v2/sports/basketball/womens-college-basketball/teams?limit=1000)
- [OpenF1 data documentation](https://openf1.org/docs/)
- [OpenF1 access and rate limits](https://openf1.org/)
- [OpenF1 authentication](https://openf1.org/auth.html)

The complete ESPN route allowlist lives in `public/sports.js`. Test samples and their exact source URLs are recorded in `tests/fixtures/multisport/SOURCES.md` and `tests/fixtures/college/SOURCES.md`.
