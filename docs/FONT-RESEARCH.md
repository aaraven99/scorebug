# Scorebug typography

Research and asset verification: November 26, 2026.

## What is and is not verified

The supplied SF–KC reference visually matches FOX's angular 2020-era scorebug. An exact, publicly released font for those score numerals could not be verified from FOX, its designers, or a font foundry. **This project does not claim to include FOX's exact typeface.**

Industry Black Italic or Ultra Italic is a plausible visual lead, but the FOX attribution comes from recreation discussions rather than a primary confirmation. [Fort Foundry's official family page](https://fortfoundry.com/fonts/industry) confirms those styles and tabular figures. Its [license page](https://fortfoundry.com/licenses) distinguishes web and application embedding licenses. No Industry font is bundled or purchased.

[Zetafonts confirms that it made a custom typeface called Thicker Fox for FOX Sports](https://www.zetafonts.com/custom-projects/10324). That page does not identify the font in this specific 2020 reference, so it is not evidence of an exact match.

## Bundled replacement

The replacement is **Saira**, designed by Omnibus-Type, with its genuine italic outlines. This is a closer broadcast-style approximation, not an official FOX font. [The designer identifies Saira as a free, open-source family](https://www.omnibus-type.com/fonts/saira/).

Unmodified files from the official Google Fonts repository:

| Local file | Official source |
| --- | --- |
| `public/fonts/Saira-Italic.ttf` | [Saira-Italic\[wdth,wght\].ttf](https://github.com/google/fonts/blob/main/ofl/saira/Saira-Italic%5Bwdth%2Cwght%5D.ttf) |
| `public/fonts/Saira-OFL.txt` | [Saira SIL Open Font License 1.1](https://github.com/google/fonts/blob/main/ofl/saira/OFL.txt) |

The font is self-hosted. Keep its accompanying copyright and license when distributing the website or desktop app. The font file has only been renamed on disk; its outlines and internal names have not been changed.

## Verified font properties and CSS

The binary reports version **1.101**, an italic style flag, and an italic angle of **−12°**. These are real italic outlines; no synthetic skew is needed.

| Axis | Minimum | Default | Maximum |
| --- | ---: | ---: | ---: |
| `wght` | 100 | 100 | 900 |
| `wdth` | 50 | 100 | 125 |

Start with **Black / weight 900**, width **75**, for the score. Use weight 700–800 for the smaller clock and situation text. These settings are visual approximation choices; the screenshot does not establish exact original font metrics.

```css
@font-face {
  font-family: "Saira Scorebug";
  src: url("/fonts/Saira-Italic.ttf") format("truetype");
  font-style: italic;
  font-weight: 100 900;
  font-stretch: 50% 125%;
  font-display: swap;
}

.score {
  font-family: "Saira Scorebug", sans-serif;
  font-style: italic;
  font-weight: 900;
  font-stretch: 75%;
  font-variation-settings: "wght" 900, "wdth" 75;
}
```

Do not omit the weight: this variable font defaults to Thin / 100. Explicit `font-variation-settings` wins over the corresponding high-level weight and stretch properties, so adjust both if combining them.

## File integrity

- Font size: 534,712 bytes.
- Font SHA-256: `965972c2543b72948aedb55fae36e23175661d0f9d2d8d7f14a1009e466912f8`
- License SHA-256: `f2665d4718b452b3818a877191355ac884a6b9b419d35408fe7ee487e9e8f30f`
- [Official Google Fonts metadata](https://github.com/google/fonts/blob/main/ofl/saira/METADATA.pb) identifies the italic source and both variation axes.
