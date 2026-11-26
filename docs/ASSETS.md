# Asset sources and notices

## NFL team logos

The original PNG files in `public/logos/` were retrieved on November 26, 2026 from ESPN's [NFL teams catalog](https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams?limit=40). They are bundled with the app so the scoreboard remains visually complete when a browser cannot access ESPN's image CDN. Image pixels are unmodified, and the renderer preserves their aspect ratios. Chicago uses ESPN’s officially listed secondary C logo to suit the classic broadcast layout; the other teams use the catalog’s default logos.

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
| `public/logos/lar.png` | Los Angeles Rams | [ESPN PNG](https://a.espncdn.com/i/teamlogos/nfl/500/lar.png) |
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

## Score font

`public/fonts/Saira-Italic.ttf` is **Saira**, designed by Omnibus-Type, from the [official Google Fonts repository](https://github.com/google/fonts/blob/main/ofl/saira/Saira-Italic%5Bwdth%2Cwght%5D.ttf). The unmodified variable font was retrieved on November 26, 2026. Its file name is shortened locally; its internal names and outlines are unchanged.

Saira is distributed under the SIL Open Font License 1.1; the complete [license and copyright notice are included](../public/fonts/Saira-OFL.txt). This font contains genuine italic outlines with a −12° italic angle, a weight axis from 100 to 900, and a width axis from 50 to 125. The scorebug uses heavy, condensed settings; the italic form comes from the font itself.

This is an approximation of the supplied broadcast reference. An exact font match for the older FOX numerals could not be verified from a primary source. No commercial Industry font or proprietary FOX font is included. See [the font research notes](FONT-RESEARCH.md) for primary sources, verified font properties, and file hashes.

## Scorebug design

The code recreates the user's supplied classic broadcast scorebug reference, with transparent outer edges, the requested centered game clock, and no unsupported play-clock field. The left-center and right-center native positions use a vertical adaptation of that layout. The hover card's miniature field is drawn in SVG from normalized reported ball-position data; it is a schematic rather than a broadcast image or tracked-player visualization.

No FOX wordmark or other broadcaster identity is included. The layout does not represent an official FOX widget or data service.
