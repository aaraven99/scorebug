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
