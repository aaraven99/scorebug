# Asset sources and notices

## NFL team logos

The original PNG files in `public/logos/` were retrieved on November 26, 2026. Thirty-one use artwork listed in ESPN's [NFL teams catalog](https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams?limit=40); Chicago uses the catalog's secondary C logo. The Rams use the original full-color monogram from the team's own brand asset archive, as described below. They are bundled so the scorebug can display every team without fetching images from a remote CDN.

The source PNG bytes and colors are unmodified. The renderer fits each mark's measured nontransparent bounds into the available space, preserves its aspect ratio, and leaves the surrounding desktop transparent. This corrects the excessive square padding that previously made wide marks too small. The Giants and Jets receive a thin light contour only within their team panels so their blue and green artwork stays visible against the matching background. Other marks use their original outlines and a small shadow; no logo is converted to monochrome or placed in a white box.

Team names and logos belong to their respective teams and/or the NFL. They identify teams in this unofficial scoreboard. This project is not affiliated with or endorsed by the NFL, its teams, ESPN, or FOX, and does not grant a license to those marks. The source URLs below identify the artwork used.

| Local file | Team | Original artwork |
| --- | --- | --- |
| `public/logos/ari.png` | Arizona Cardinals | [ESPN PNG](https://a.espncdn.com/i/teamlogos/nfl/500/ari.png) |
| `public/logos/atl.png` | Atlanta Falcons | [ESPN PNG](https://a.espncdn.com/i/teamlogos/nfl/500/atl.png) |
| `public/logos/bal.png` | Baltimore Ravens | [ESPN PNG](https://a.espncdn.com/i/teamlogos/nfl/500/bal.png) |
| `public/logos/buf.png` | Buffalo Bills | [ESPN PNG](https://a.espncdn.com/i/teamlogos/nfl/500/buf.png) |
| `public/logos/car.png` | Carolina Panthers | [ESPN PNG](https://a.espncdn.com/i/teamlogos/nfl/500/car.png) |
| `public/logos/chi.png` | Chicago Bears | [ESPN secondary C logo](https://a.espncdn.com/guid/19d73366-b5a5-cca2-a176-a2c024ce0bb3/logos/secondary_logo_on_white_color.png) |
| `public/logos/cin.png` | Cincinnati Bengals | [ESPN PNG](https://a.espncdn.com/i/teamlogos/nfl/500/cin.png) |
| `public/logos/cle.png` | Cleveland Browns | [ESPN PNG](https://a.espncdn.com/i/teamlogos/nfl/500/cle.png) |
| `public/logos/dal.png` | Dallas Cowboys | [ESPN PNG](https://a.espncdn.com/i/teamlogos/nfl/500/dal.png) |
| `public/logos/den.png` | Denver Broncos | [ESPN PNG](https://a.espncdn.com/i/teamlogos/nfl/500/den.png) |
| `public/logos/det.png` | Detroit Lions | [ESPN PNG](https://a.espncdn.com/i/teamlogos/nfl/500/det.png) |
| `public/logos/gb.png` | Green Bay Packers | [ESPN PNG](https://a.espncdn.com/i/teamlogos/nfl/500/gb.png) |
| `public/logos/hou.png` | Houston Texans | [ESPN PNG](https://a.espncdn.com/i/teamlogos/nfl/500/hou.png) |
| `public/logos/ind.png` | Indianapolis Colts | [ESPN PNG](https://a.espncdn.com/i/teamlogos/nfl/500/ind.png) |
| `public/logos/jax.png` | Jacksonville Jaguars | [ESPN PNG](https://a.espncdn.com/i/teamlogos/nfl/500/jax.png) |
| `public/logos/kc.png` | Kansas City Chiefs | [ESPN PNG](https://a.espncdn.com/i/teamlogos/nfl/500/kc.png) |
| `public/logos/lv.png` | Las Vegas Raiders | [ESPN PNG](https://a.espncdn.com/i/teamlogos/nfl/500/lv.png) |
| `public/logos/lac.png` | Los Angeles Chargers | [ESPN PNG](https://a.espncdn.com/i/teamlogos/nfl/500/lac.png) |
| `public/logos/lar.png` | Los Angeles Rams | [Official team brand archive](https://www.dropbox.com/scl/fi/813nkeu7ovhdz551pj5bc/Los-Angeles-Rams-Brand-Assets.zip?rlkey=z2hidixhowlioon9gximtfq1g&dl=0), full-color light-background monogram |
| `public/logos/mia.png` | Miami Dolphins | [ESPN PNG](https://a.espncdn.com/i/teamlogos/nfl/500/mia.png) |
| `public/logos/min.png` | Minnesota Vikings | [ESPN PNG](https://a.espncdn.com/i/teamlogos/nfl/500/min.png) |
| `public/logos/ne.png` | New England Patriots | [ESPN PNG](https://a.espncdn.com/i/teamlogos/nfl/500/ne.png) |
| `public/logos/no.png` | New Orleans Saints | [ESPN PNG](https://a.espncdn.com/i/teamlogos/nfl/500/no.png) |
| `public/logos/nyg.png` | New York Giants | [ESPN PNG](https://a.espncdn.com/i/teamlogos/nfl/500/nyg.png) |
| `public/logos/nyj.png` | New York Jets | [ESPN PNG](https://a.espncdn.com/i/teamlogos/nfl/500/nyj.png) |
| `public/logos/phi.png` | Philadelphia Eagles | [ESPN PNG](https://a.espncdn.com/i/teamlogos/nfl/500/phi.png) |
| `public/logos/pit.png` | Pittsburgh Steelers | [ESPN PNG](https://a.espncdn.com/i/teamlogos/nfl/500/pit.png) |
| `public/logos/sf.png` | San Francisco 49ers | [ESPN PNG](https://a.espncdn.com/i/teamlogos/nfl/500/sf.png) |
| `public/logos/sea.png` | Seattle Seahawks | [ESPN PNG](https://a.espncdn.com/i/teamlogos/nfl/500/sea.png) |
| `public/logos/tb.png` | Tampa Bay Buccaneers | [ESPN PNG](https://a.espncdn.com/i/teamlogos/nfl/500/tb.png) |
| `public/logos/ten.png` | Tennessee Titans | [ESPN PNG](https://a.espncdn.com/i/teamlogos/nfl/500/ten.png) |
| `public/logos/wsh.png` | Washington Commanders | [ESPN PNG](https://a.espncdn.com/i/teamlogos/nfl/500/wsh.png) |


### Rams color correction

ESPN's current default Rams PNG is a single-color blue mark. That color came from the downloaded artwork, rather than a filter in this app. The team's [April 2026 announcement](https://www.therams.com/news/rams-unveil-uniform-brand-refresh-ahead-of-2026-season) documents the move away from the older gradient treatment.

To match the user's requested blue **LA** and yellow/gold horn, this app deliberately uses the classic full-color mark. It is the unmodified `PNGs/Full Color/Monogram/Rams_Monogram_lt-bkgrd.png` inside the official team archive linked on page 35 of the [Rams Brand Book and Guidelines](https://stage-static.clubs.nfl.com/image/upload/browns/fw6klbpa6smlcmbemfhx.pdf). Page 6 of that same guide shows the full-color artwork and color variants. Its original white contour keeps the blue letters readable on the scorebug's blue panel; no extra recoloring or background was added.

### Logo verification

All 32 marks were inspected on both light and dark backgrounds, then in the actual team-color gradients at a 520px horizontal scorebug width and a 160px vertical width. The final checks covered visible colors, recognizable silhouettes, preserved proportions, and clearance from the score and timeout row. Wide marks now use their available space, and tall marks no longer touch the upper panel edge. This was a Chromium rendering check; it does not claim native Windows runtime validation.

[The verification manifest](team-logo-verification-v12.json) records each bundled PNG's source and SHA-256. Source URLs can change over time; these hashes identify the exact versions shipped here.

## Score font

`public/fonts/Tomorrow-ExtraBoldItalic.ttf` and `public/fonts/Tomorrow-BoldItalic.ttf` are **Tomorrow** by the Tomorrow Project Authors, from the [official Google Fonts repository](https://github.com/google/fonts/tree/main/ofl/tomorrow). The unmodified font files were retrieved on November 26, 2026; their internal names and outlines are unchanged.

Tomorrow is distributed under the SIL Open Font License 1.1; the complete [license and copyright notice are included](../public/fonts/Tomorrow-OFL.txt). The two static faces contain genuine italic outlines with a −10° italic angle and weight classes 800 and 700. The scorebug uses ExtraBold for score numerals and Bold for smaller situation text; the italic form comes from the font itself.

This is an approximation of the supplied broadcast reference. An exact font match for the older FOX numerals could not be verified from a primary source. No commercial Industry font or proprietary FOX font is included. See [the font research notes](FONT-RESEARCH.md) for primary sources, verified font properties, and file hashes.

## Scorebug design

The code recreates the user's supplied classic broadcast scorebug reference, with team-color gradients, thin silver-gray bevels around the graphic's panels, and a transparent exterior. The centered game clock, reported ball yard line, labeled timeout counts, and larger football possession symbol are rendered directly in SVG. There is no unsupported play-clock field. The left-center and right-center native positions use a vertical adaptation of that layout. Compact team-specific stats extensions inherit each team's color and show reported field-position and play text.

No FOX wordmark or other broadcaster identity is included. The layout does not represent an official FOX widget or data service.


## Additional sports, version 2.0

The 107 bundled NBA, WNBA, MLB and NHL PNGs below are unmodified originals retrieved from ESPN team metadata. Their visible alpha bounds are measured in `public/team-logo-artwork.js` so marks with different transparent padding stay centered. Namespaces keep matching abbreviations in different leagues separate. Other competitions use the provider's original HTTPS logo when available and a team abbreviation otherwise. Team marks belong to their respective owners.

| League | Team | Source |
| --- | --- | --- |
| MLB | Arizona Diamondbacks | [Original PNG](https://a.espncdn.com/i/teamlogos/mlb/500/ari.png) |
| MLB | Athletics | [Original PNG](https://a.espncdn.com/i/teamlogos/mlb/500/ath.png) |
| MLB | Atlanta Braves | [Original PNG](https://a.espncdn.com/i/teamlogos/mlb/500/atl.png) |
| MLB | Baltimore Orioles | [Original PNG](https://a.espncdn.com/i/teamlogos/mlb/500/bal.png) |
| MLB | Boston Red Sox | [Original PNG](https://a.espncdn.com/i/teamlogos/mlb/500/bos.png) |
| MLB | Chicago Cubs | [Original PNG](https://a.espncdn.com/i/teamlogos/mlb/500/chc.png) |
| MLB | Chicago White Sox | [Original PNG](https://a.espncdn.com/i/teamlogos/mlb/500/chw.png) |
| MLB | Cincinnati Reds | [Original PNG](https://a.espncdn.com/i/teamlogos/mlb/500/cin.png) |
| MLB | Cleveland Guardians | [Original PNG](https://a.espncdn.com/i/teamlogos/mlb/500/cle.png) |
| MLB | Colorado Rockies | [Original PNG](https://a.espncdn.com/i/teamlogos/mlb/500/col.png) |
| MLB | Detroit Tigers | [Original PNG](https://a.espncdn.com/i/teamlogos/mlb/500/det.png) |
| MLB | Houston Astros | [Original PNG](https://a.espncdn.com/i/teamlogos/mlb/500/hou.png) |
| MLB | Kansas City Royals | [Original PNG](https://a.espncdn.com/i/teamlogos/mlb/500/kc.png) |
| MLB | Los Angeles Angels | [Original PNG](https://a.espncdn.com/i/teamlogos/mlb/500/laa.png) |
| MLB | Los Angeles Dodgers | [Original PNG](https://a.espncdn.com/i/teamlogos/mlb/500/lad.png) |
| MLB | Miami Marlins | [Original PNG](https://a.espncdn.com/i/teamlogos/mlb/500/mia.png) |
| MLB | Milwaukee Brewers | [Original PNG](https://a.espncdn.com/i/teamlogos/mlb/500/mil.png) |
| MLB | Minnesota Twins | [Original PNG](https://a.espncdn.com/i/teamlogos/mlb/500/min.png) |
| MLB | New York Mets | [Original PNG](https://a.espncdn.com/i/teamlogos/mlb/500/nym.png) |
| MLB | New York Yankees | [Original PNG](https://a.espncdn.com/i/teamlogos/mlb/500/nyy.png) |
| MLB | Philadelphia Phillies | [Original PNG](https://a.espncdn.com/i/teamlogos/mlb/500/phi.png) |
| MLB | Pittsburgh Pirates | [Original PNG](https://a.espncdn.com/i/teamlogos/mlb/500/pit.png) |
| MLB | San Diego Padres | [Original PNG](https://a.espncdn.com/i/teamlogos/mlb/500/sd.png) |
| MLB | Seattle Mariners | [Original PNG](https://a.espncdn.com/i/teamlogos/mlb/500/sea.png) |
| MLB | San Francisco Giants | [Original PNG](https://a.espncdn.com/i/teamlogos/mlb/500/sf.png) |
| MLB | St. Louis Cardinals | [Original PNG](https://a.espncdn.com/i/teamlogos/mlb/500/stl.png) |
| MLB | Tampa Bay Rays | [Original PNG](https://a.espncdn.com/i/teamlogos/mlb/500/tb.png) |
| MLB | Texas Rangers | [Original PNG](https://a.espncdn.com/i/teamlogos/mlb/500/tex.png) |
| MLB | Toronto Blue Jays | [Original PNG](https://a.espncdn.com/i/teamlogos/mlb/500/tor.png) |
| MLB | Washington Nationals | [Original PNG](https://a.espncdn.com/i/teamlogos/mlb/500/wsh.png) |
| NBA | Atlanta Hawks | [Original PNG](https://a.espncdn.com/i/teamlogos/nba/500/atl.png) |
| NBA | Brooklyn Nets | [Original PNG](https://a.espncdn.com/i/teamlogos/nba/500/bkn.png) |
| NBA | Boston Celtics | [Original PNG](https://a.espncdn.com/i/teamlogos/nba/500/bos.png) |
| NBA | Charlotte Hornets | [Original PNG](https://a.espncdn.com/i/teamlogos/nba/500/cha.png) |
| NBA | Chicago Bulls | [Original PNG](https://a.espncdn.com/i/teamlogos/nba/500/chi.png) |
| NBA | Cleveland Cavaliers | [Original PNG](https://a.espncdn.com/i/teamlogos/nba/500/cle.png) |
| NBA | Dallas Mavericks | [Original PNG](https://a.espncdn.com/i/teamlogos/nba/500/dal.png) |
| NBA | Denver Nuggets | [Original PNG](https://a.espncdn.com/i/teamlogos/nba/500/den.png) |
| NBA | Detroit Pistons | [Original PNG](https://a.espncdn.com/i/teamlogos/nba/500/det.png) |
| NBA | Golden State Warriors | [Original PNG](https://a.espncdn.com/i/teamlogos/nba/500/gs.png) |
| NBA | Houston Rockets | [Original PNG](https://a.espncdn.com/i/teamlogos/nba/500/hou.png) |
| NBA | Indiana Pacers | [Original PNG](https://a.espncdn.com/i/teamlogos/nba/500/ind.png) |
| NBA | LA Clippers | [Original PNG](https://a.espncdn.com/i/teamlogos/nba/500/lac.png) |
| NBA | Los Angeles Lakers | [Original PNG](https://a.espncdn.com/i/teamlogos/nba/500/lal.png) |
| NBA | Memphis Grizzlies | [Original PNG](https://a.espncdn.com/i/teamlogos/nba/500/mem.png) |
| NBA | Miami Heat | [Original PNG](https://a.espncdn.com/i/teamlogos/nba/500/mia.png) |
| NBA | Milwaukee Bucks | [Original PNG](https://a.espncdn.com/i/teamlogos/nba/500/mil.png) |
| NBA | Minnesota Timberwolves | [Original PNG](https://a.espncdn.com/i/teamlogos/nba/500/min.png) |
| NBA | New Orleans Pelicans | [Original PNG](https://a.espncdn.com/i/teamlogos/nba/500/no.png) |
| NBA | New York Knicks | [Original PNG](https://a.espncdn.com/i/teamlogos/nba/500/ny.png) |
| NBA | Oklahoma City Thunder | [Original PNG](https://a.espncdn.com/i/teamlogos/nba/500/okc.png) |
| NBA | Orlando Magic | [Original PNG](https://a.espncdn.com/i/teamlogos/nba/500/orl.png) |
| NBA | Philadelphia 76ers | [Original PNG](https://a.espncdn.com/i/teamlogos/nba/500/phi.png) |
| NBA | Phoenix Suns | [Original PNG](https://a.espncdn.com/i/teamlogos/nba/500/phx.png) |
| NBA | Portland Trail Blazers | [Original PNG](https://a.espncdn.com/i/teamlogos/nba/500/por.png) |
| NBA | San Antonio Spurs | [Original PNG](https://a.espncdn.com/i/teamlogos/nba/500/sa.png) |
| NBA | Sacramento Kings | [Original PNG](https://a.espncdn.com/i/teamlogos/nba/500/sac.png) |
| NBA | Toronto Raptors | [Original PNG](https://a.espncdn.com/i/teamlogos/nba/500/tor.png) |
| NBA | Utah Jazz | [Original PNG](https://a.espncdn.com/i/teamlogos/nba/500/utah.png) |
| NBA | Washington Wizards | [Original PNG](https://a.espncdn.com/i/teamlogos/nba/500/wsh.png) |
| NHL | Anaheim Ducks | [Original PNG](https://a.espncdn.com/i/teamlogos/nhl/500/ana.png) |
| NHL | Boston Bruins | [Original PNG](https://a.espncdn.com/i/teamlogos/nhl/500/bos.png) |
| NHL | Buffalo Sabres | [Original PNG](https://a.espncdn.com/i/teamlogos/nhl/500/buf.png) |
| NHL | Carolina Hurricanes | [Original PNG](https://a.espncdn.com/i/teamlogos/nhl/500/car.png) |
| NHL | Columbus Blue Jackets | [Original PNG](https://a.espncdn.com/i/teamlogos/nhl/500/cbj.png) |
| NHL | Calgary Flames | [Original PNG](https://a.espncdn.com/i/teamlogos/nhl/500/cgy.png) |
| NHL | Chicago Blackhawks | [Original PNG](https://a.espncdn.com/i/teamlogos/nhl/500/chi.png) |
| NHL | Colorado Avalanche | [Original PNG](https://a.espncdn.com/i/teamlogos/nhl/500/col.png) |
| NHL | Dallas Stars | [Original PNG](https://a.espncdn.com/i/teamlogos/nhl/500/dal.png) |
| NHL | Detroit Red Wings | [Original PNG](https://a.espncdn.com/i/teamlogos/nhl/500/det.png) |
| NHL | Edmonton Oilers | [Original PNG](https://a.espncdn.com/i/teamlogos/nhl/500/edm.png) |
| NHL | Florida Panthers | [Original PNG](https://a.espncdn.com/i/teamlogos/nhl/500/fla.png) |
| NHL | Los Angeles Kings | [Original PNG](https://a.espncdn.com/i/teamlogos/nhl/500/la.png) |
| NHL | Minnesota Wild | [Original PNG](https://a.espncdn.com/i/teamlogos/nhl/500/min.png) |
| NHL | Montreal Canadiens | [Original PNG](https://a.espncdn.com/i/teamlogos/nhl/500/mtl.png) |
| NHL | New Jersey Devils | [Original PNG](https://a.espncdn.com/i/teamlogos/nhl/500/nj.png) |
| NHL | Nashville Predators | [Original PNG](https://a.espncdn.com/i/teamlogos/nhl/500/nsh.png) |
| NHL | New York Islanders | [Original PNG](https://a.espncdn.com/i/teamlogos/nhl/500/nyi.png) |
| NHL | New York Rangers | [Original PNG](https://a.espncdn.com/i/teamlogos/nhl/500/nyr.png) |
| NHL | Ottawa Senators | [Original PNG](https://a.espncdn.com/i/teamlogos/nhl/500/ott.png) |
| NHL | Philadelphia Flyers | [Original PNG](https://a.espncdn.com/i/teamlogos/nhl/500/phi.png) |
| NHL | Pittsburgh Penguins | [Original PNG](https://a.espncdn.com/i/teamlogos/nhl/500/pit.png) |
| NHL | Seattle Kraken | [Original PNG](https://a.espncdn.com/i/teamlogos/nhl/500/sea.png) |
| NHL | San Jose Sharks | [Original PNG](https://a.espncdn.com/i/teamlogos/nhl/500/sj.png) |
| NHL | St. Louis Blues | [Original PNG](https://a.espncdn.com/i/teamlogos/nhl/500/stl.png) |
| NHL | Tampa Bay Lightning | [Original PNG](https://a.espncdn.com/i/teamlogos/nhl/500/tb.png) |
| NHL | Toronto Maple Leafs | [Original PNG](https://a.espncdn.com/i/teamlogos/nhl/500/tor.png) |
| NHL | Utah Mammoth | [Original PNG](https://a.espncdn.com/i/teamlogos/nhl/500/utah.png) |
| NHL | Vancouver Canucks | [Original PNG](https://a.espncdn.com/i/teamlogos/nhl/500/van.png) |
| NHL | Vegas Golden Knights | [Original PNG](https://a.espncdn.com/i/teamlogos/nhl/500/vgk.png) |
| NHL | Winnipeg Jets | [Original PNG](https://a.espncdn.com/i/teamlogos/nhl/500/wpg.png) |
| NHL | Washington Capitals | [Original PNG](https://a.espncdn.com/i/teamlogos/nhl/500/wsh.png) |
| WNBA | Atlanta Dream | [Original PNG](https://a.espncdn.com/i/teamlogos/wnba/500/atl.png) |
| WNBA | Connecticut Sun | [Original PNG](https://a.espncdn.com/i/teamlogos/wnba/500/con.png) |
| WNBA | Chicago Sky | [Original PNG](https://a.espncdn.com/i/teamlogos/wnba/500/chi.png) |
| WNBA | Dallas Wings | [Original PNG](https://a.espncdn.com/i/teamlogos/wnba/500/dal.png) |
| WNBA | Golden State Valkyries | [Original PNG](https://a.espncdn.com/i/teamlogos/wnba/500/gs.png) |
| WNBA | Indiana Fever | [Original PNG](https://a.espncdn.com/i/teamlogos/wnba/500/ind.png) |
| WNBA | Los Angeles Sparks | [Original PNG](https://a.espncdn.com/i/teamlogos/wnba/500/la.png) |
| WNBA | Las Vegas Aces | [Original PNG](https://a.espncdn.com/i/teamlogos/wnba/500/lv.png) |
| WNBA | Minnesota Lynx | [Original PNG](https://a.espncdn.com/i/teamlogos/wnba/500/min.png) |
| WNBA | New York Liberty | [Original PNG](https://a.espncdn.com/i/teamlogos/wnba/500/ny.png) |
| WNBA | Phoenix Mercury | [Original PNG](https://a.espncdn.com/i/teamlogos/wnba/500/phx.png) |
| WNBA | Portland Fire | [Original PNG](https://a.espncdn.com/i/teamlogos/wnba/500/por.png) |
| WNBA | Seattle Storm | [Original PNG](https://a.espncdn.com/i/teamlogos/wnba/500/sea.png) |
| WNBA | Toronto Tempo | [Original PNG](https://a.espncdn.com/i/teamlogos/wnba/500/tor.png) |
| WNBA | Washington Mystics | [Original PNG](https://a.espncdn.com/i/teamlogos/wnba/500/wsh.png) |

### Additional broadcast typography

Barlow Condensed Bold and ExtraBold, by Jeremy Tribby and the Barlow Project Authors, are bundled under the SIL Open Font License. They give selected tall-number packages a compact upright score face. These are visual approximations; no broadcaster's proprietary typeface is claimed.

- [Official Google Fonts source](https://github.com/google/fonts/tree/main/ofl/barlowcondensed)
- Local license: `public/fonts/BarlowCondensed-OFL.txt`
