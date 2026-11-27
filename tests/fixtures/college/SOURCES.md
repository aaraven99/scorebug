# College feed fixtures

These samples were fetched directly from ESPN on November 27, 2026. They are recorded responses for tests, not current scores. Links, ads, news and unrelated metadata were removed. Scoreboard event lists and team directories retain every returned record. Basketball summaries retain the first 12 and last 32 plays; the football summary retains the first two and last two previous drives plus the current drive. All retained scores, names, IDs, periods, stats, photos and plays come from the responses.

## Schedules and filter verification

| File | Source | Observed result |
| --- | --- | --- |
| `cfb-scoreboard.json` | [Division I, Nov. 27](https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=20261127&limit=300&groups=90) | 13 games; live quarters, downs, possession and timeouts |
| `cfb-division-one-scoreboard.json` | [Division I, Nov. 21](https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=20261121&limit=300&groups=90) | 116 unique games |
| `cbb-scoreboard.json` | [Men's Division I, Nov. 27](https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=20261127&limit=1000&groups=50) | 55 games, including unranked schools |
| `wcbb-scoreboard.json` | [Women's Division I, Nov. 27](https://site.api.espn.com/apis/site/v2/sports/basketball/womens-college-basketball/scoreboard?dates=20261127&limit=1000&groups=50) | 78 games, including unranked schools |

The exact production basketball URLs were checked again at 18:01 UTC on November 27, 2026. [Men's with `limit=300&groups=50`](https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?limit=300&groups=50&dates=20261127) returned the same 55 event IDs, and [women's with `limit=300&groups=50`](https://site.api.espn.com/apis/site/v2/sports/basketball/womens-college-basketball/scoreboard?limit=300&groups=50&dates=20261127) returned the same 78 event IDs as the recorded limit-1000 fixtures. Both set comparisons had zero missing or additional IDs.

`coverage-verification.json` records the actual group names, parent references and event IDs from these additional requests:

- [Football group 90: NCAA Division I](https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/2026/types/2/groups/90)
- [Football group 80: FBS, child of 90](https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/2026/types/2/groups/80)
- [Football group 81: FCS, child of 90](https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/2026/types/2/groups/81)
- [FBS Nov. 21, limit 300](https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=20261121&limit=300&groups=80): 58 games.
- [FCS Nov. 21, limit 300](https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=20261121&limit=300&groups=81): 62 games. Four matchups appear in both lists; their union exactly matches the 116-game Division I response.
- [FBS Nov. 21, limit 1000](https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=20261121&limit=1000&groups=80): only 25 games. The application therefore keeps limit 300.
- [Incorrect football group 50, Nov. 27](https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=20261127&limit=1000&groups=50): zero games. This was the bug fixed in 2.0.2.
- [Men's default scoreboard, Nov. 27](https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=20261127&limit=1000): 14 games, compared with 55 using group 50.
- [Women's default scoreboard, Nov. 27](https://site.api.espn.com/apis/site/v2/sports/basketball/womens-college-basketball/scoreboard?dates=20261127&limit=1000): 10 games, compared with 78 using group 50.

A comma-separated football filter `groups=80,81` returned HTTP 400. Repeating `groups=80&groups=81` selected only group 80. The verified parent group 90 avoids additional requests and incomplete merged schedules.

## Details and period format

| File | Source | Verified format and coverage |
| --- | --- | --- |
| `cfb-summary.json` | [Mississippi State at Ole Miss](https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=401856762) | Four 900-second regulation quarters; untimed overtime. Team/player totals, quarter scores, drives and college headshots. |
| `cbb-summary.json` | [Virginia vs. Xavier](https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/summary?event=401920429) | Two 1,200-second regulation halves; 300-second overtime. Player totals, scoring plays and half scores. |
| `wcbb-summary.json` | [North Dakota at Florida International](https://site.api.espn.com/apis/site/v2/sports/basketball/womens-college-basketball/summary?event=401927987) | Four 600-second regulation quarters; 300-second overtime. Player totals, scoring plays and quarter scores. |

The period counts and lengths are present in each response's `format.regulation` object. No local clock is inferred from them. Unknown timeouts and shot clocks remain null.

## Full supplied team directories

- `cfb-teams.json`: [football directory, limit 1000](https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams?limit=1000), 763 records. This directory includes lower divisions; it is broader than the Division I scoreboard. Passing `groups=80` or `groups=81` to this directory did not filter its records.
- `cbb-teams.json`: [men's basketball directory, limit 1000](https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams?limit=1000), 365 records.
- `wcbb-teams.json`: [women's basketball directory, limit 1000](https://site.api.espn.com/apis/site/v2/sports/basketball/womens-college-basketball/teams?limit=1000), 363 records.

The directory responses did not expose pagination metadata. All supplied records survive normalization, including schools at the end of the lists. Team counts are observations from these samples, not fixed assumptions in production. School 130 (Michigan) becomes `cfb:130`, `cbb:130` and `wcbb:130`; a football favorite never silently becomes a basketball favorite.
