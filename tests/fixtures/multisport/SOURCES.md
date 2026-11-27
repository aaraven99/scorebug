# Multisport fixture sources

These samples were downloaded from the providers' public JSON endpoints. Test files keep relevant original event, box-score and play fields and omit videos, news, advertising and other unrelated content. Scoreboard samples contain one event (two for NBA/NHL); the golf sample keeps the first four competitors. Summary plays contain all scoring plays plus opening/closing examples. Synthetic edge cases in the test file are identified as constructed copies of these samples.

| Fixture | Source URL |
| --- | --- |
| nba-scoreboard | https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=20261125 |
| nba-summary | https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=401909317 |
| mlb-scoreboard | https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard |
| mlb-summary | https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary?event=401908046 |
| nhl-scoreboard | https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates=20261125 |
| nhl-summary | https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/summary?event=401892781 |
| soccer-summary | https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/summary?event=401879225 |
| ucl-summary | https://site.api.espn.com/apis/site/v2/sports/soccer/uefa.champions/summary?event=401915378 |
| official-mlb | https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-10-28&hydrate=linescore,team |
| official-mlb-teams | https://statsapi.mlb.com/api/v1/teams?sportId=1&season=2026 |
| wnba-connecticut | https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/teams/18 |
| f1-scoreboard | https://site.api.espn.com/apis/site/v2/sports/racing/f1/scoreboard?dates=20261108 |
| atp-scoreboard | https://site.api.espn.com/apis/site/v2/sports/tennis/atp/scoreboard?dates=20261122 |
| pga-scoreboard | https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard?dates=20261122 |
| nrl-scoreboard | https://site.api.espn.com/apis/site/v2/sports/rugby-league/3/scoreboard |
| superrugby-scoreboard | https://site.api.espn.com/apis/site/v2/sports/rugby/242041/scoreboard |
| ncaavb-scoreboard | https://site.api.espn.com/apis/site/v2/sports/volleyball/womens-college-volleyball/scoreboard?dates=20261125 |
| volleyball-summary | https://site.api.espn.com/apis/site/v2/sports/volleyball/womens-college-volleyball/summary?event=401931745 |
| openf1-sessions | https://api.openf1.org/v1/sessions?year=2026&country_name=Brazil |
| openf1-drivers | https://api.openf1.org/v1/drivers?session_key=11412 |
| openf1-results | https://api.openf1.org/v1/session_result?session_key=11412 |
| openf1-control | https://api.openf1.org/v1/race_control?session_key=11412 |
| openf1-stints | https://api.openf1.org/v1/stints?session_key=11412 |

The five-session F1 sample is a conventional race weekend. Sprint/sprint-qualifying parsing is exercised separately with explicit constructed competition types. OpenF1's public session directory also confirmed six scheduled sprint sessions in the 2026 season: https://api.openf1.org/v1/sessions?year=2026&session_name=Sprint

The official MLB payload and directory preserve all supplied game/team records. `lib/official-teams.mjs` matches that directory to the exact full team names returned by https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/teams?limit=1000. The UCL fixture retains the full commentary and roster statistics to verify scorer selection and soccer-specific play-by-play.

Independent NBA (`cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json`) and NHL (`api-web.nhle.com/v1/score/now`, including dated variants) feeds rejected full-payload validation requests with HTTP 403. Those adapters were not added. Cricket's ESPN IPL route returned empty match objects and Cricinfo's current-matches route returned HTTP 403; cricket remains a design/demo option rather than an advertised live-data league.
