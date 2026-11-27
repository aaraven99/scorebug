# All-league directory and feed audit

Recorded directly from ESPN on November 27, 2026. These JSON files contain the full named team or competitor list returned by the application after normalizing the recorded sources. They are test snapshots, not live scores. Each file records its source URLs, request timestamps, scope and completeness. Current and historical golfers are intentionally included. A player appearing here does not imply that they are entered in the current event.

## Coverage observed

| League | Search entries | Directory scope | Scoreboard games | Sample details |
| --- | ---: | --- | ---: | --- |
| NFL | 32 | Full reported team directory | 16 | Pregame detail |
| NBA | 30 | Full reported team directory | 11 | Pregame detail |
| WNBA | 15 | Full reported team directory | 1 | Game summary |
| MLB | 30 | Full reported team directory | 1 | Game summary |
| NHL | 32 | Full reported team directory | 15 | Game summary |
| Formula 1 | 37 | Named provider catalog | 5 | Classification / event detail |
| Premier League | 20 | Full reported team directory | 1 | Pregame detail |
| Champions League | 36 | Full reported team directory | 9 | Game summary |
| MLS | 30 | Full reported team directory | 2 | Pregame detail |
| LaLiga | 20 | Full reported team directory | 1 | Pregame detail |
| Bundesliga | 18 | Full reported team directory | 1 | Pregame detail |
| Serie A | 20 | Full reported team directory | 1 | Pregame detail |
| Ligue 1 | 18 | Full reported team directory | 1 | Pregame detail |
| NWSL | 16 | Full reported team directory | 1 | Game summary |
| Women's Super League | 14 | Full reported team directory | 5 | Game summary |
| World Cup | 48 | Full reported team directory | 1 | Game summary |
| College football | 763 | Full reported team directory | 79 | Game summary |
| Men's college basketball | 365 | Full reported team directory | 55 | Game summary |
| Women's college basketball | 363 | Full reported team directory | 78 | Game summary |
| NASCAR Cup | 59 | Named provider catalog | 1 | Classification / event detail |
| IndyCar | 33 | Named provider catalog | 1 | Classification / event detail |
| ATP tennis | 150 | Published ranking + entrants (partial) | 0 | No published match draw |
| WTA tennis | 187 | Published ranking + entrants (partial) | 38 | Classification / event detail |
| PGA Tour | 4,426 | Named provider catalog | 1 | Classification / event detail |
| LPGA Tour | 3,111 | Named provider catalog | 1 | Classification / event detail |
| NRL | 19 | Full reported team directory | 9 | Pregame detail |
| Six Nations | 6 | Full reported team directory | 3 | Game summary |
| Super Rugby Pacific | 12 | Full reported team directory | 3 | Pregame detail |
| Women's college volleyball | 349 | Full reported team directory | 11 | Game summary |
| Men's college volleyball | 81 | Full reported team directory | 3 | Pregame detail |

**Total: 10,340 named records across all 30 supported leagues.** All 30 scoreboard routes, 23 team-directory routes and 23 sampled match-summary routes returned HTTP 200. Every supplied named team in those directories survives normalization. Volleyball’s `-1` and `-2` rows were explicit `TBD TBD` placeholders; those are not selectable teams.

The football team directory is broader than the Division I scoreboard. The source omitted a logo for 91 football schools, 2 women’s volleyball teams and 27 men’s volleyball teams. Names remain available; no logos are invented. Other athlete catalogs may also omit a photo or flag.

## Primary source routes

Every exact request and outcome appears in `../directory-audit-evidence.json` and each league file’s `auditSources`. The successful broad competitor sources are:

- [ATP published rankings](https://site.api.espn.com/apis/site/v2/sports/tennis/atp/rankings?limit=300): 150 players. The current tournament had no published draw, so the ranking keeps names searchable without a match this week.
- [WTA published rankings](https://site.api.espn.com/apis/site/v2/sports/tennis/wta/rankings?limit=300): 150 ranked players, combined with actual event entrants for 187 distinct search records. This is not a complete world tennis directory.
- [Formula 1 named driver catalog](https://sports.core.api.espn.com/v3/sports/racing/f1/athletes?limit=1000&page=1): 37 records in one page. Its ID set matches the [2026 season collection](https://sports.core.api.espn.com/v2/sports/racing/leagues/f1/seasons/2026/athletes?limit=1000). The list includes reserve and previously listed drivers.
- [NASCAR Cup named driver catalog](https://sports.core.api.espn.com/v3/sports/racing/nascar-premier/athletes?limit=1000&page=1): 59 records in one page.
- [IndyCar named driver catalog](https://sports.core.api.espn.com/v3/sports/racing/irl/athletes?limit=1000&page=1): 33 records in one page.
- [PGA named catalog, page 1](https://sports.core.api.espn.com/v3/sports/golf/pga/athletes?limit=1000&page=1): 4,426 records over five pages. Pages 1–4 each contain 1,000; page 5 contains 426.
- [LPGA named catalog, page 1](https://sports.core.api.espn.com/v3/sports/golf/lpga/athletes?limit=1000&page=1): 3,111 records over four pages. Pages 1–3 each contain 1,000; page 4 contains 111.

Golf pagination was fetched and checked in full. A request with `limit=5000` still reported pageSize 1000; the implementation follows the reported page count instead of assuming the requested limit was honored. All loaded page indices and counts must agree. Fetches use at most four simultaneous page reads and six pages total under one 18-second deadline, leaving room under the 20-second function limit.

## Unusable or misleading alternatives

- The common v3 athlete-list routes tested for all seven individual-sport leagues returned HTTP 400.
- PGA rankings returned HTTP 500 with both `limit=1000` and `limit=300`; its standings route returned 404. The complete named catalog is used instead.
- Formula 1’s site standings route returned 404; its named core catalog works.
- Core v3 `active=true` did not filter the historical ATP catalog: a returned record explicitly had `active:false`. The full ATP historical catalog contains 18,233 records, while PGA has 4,426; these are not presented as active rosters.
- A current scoreboard alone was insufficient for global favorite search: ATP had no draw and PGA’s upcoming event had no entrants. A valid empty schedule is not treated as a transport failure.

## Regression evidence

`../competitor-directories/` preserves the actual relevant source fields for every golf page, driver catalog, tennis ranking and current individual-sport scoreboard. Display names, IDs and supplied photos/flags are unchanged; unrelated biographical fields and links were removed from the compact catalog fixtures.

The global search test checks every one of the 10,340 names with the original spelling, a compact uppercase spelling and a trimmed lowercase spelling, then checks it within its own league. That is 41,360 query checks. Separate tests cover three-request concurrency, cancellation/resume, provider Retry-After, failed-directory retries, persistent-cache restoration and quota denial, mismatched pages, fallback to event-only coverage and retention of cached full golfer lists.

Missing or failed broader directories are explicitly labeled. The application never calls a published ranking or a current-event roster every athlete in the sport.

The exact production Formula 1, NASCAR and IndyCar catalog URLs with `page=1`, plus the exact ATP `limit=300` ranking URL, were rechecked at 19:25 UTC. They returned the identical 37/59/33/150 ID sets with zero additions or omissions. These final checks are recorded in `productionDirectoryChecks` in the audit evidence.
