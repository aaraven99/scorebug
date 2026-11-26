# Scorebug typography

Research and asset verification: November 26, 2026.

## What is and is not verified

The supplied SF–KC reference visually matches FOX's angular 2020-era scorebug. An exact, publicly released font for those score numerals could not be verified from FOX, its designers, or a font foundry. **This project does not claim to include FOX's exact typeface.**

Industry Black Italic or Ultra Italic is a plausible visual lead, but the FOX attribution comes from recreation discussions rather than a primary confirmation. [Fort Foundry's official family page](https://fortfoundry.com/fonts/industry) confirms those styles and tabular figures. Its [license page](https://fortfoundry.com/licenses) distinguishes web and application embedding licenses. No Industry font is bundled or purchased.

[Zetafonts confirms that it made a custom typeface called Thicker Fox for FOX Sports](https://www.zetafonts.com/custom-projects/10324). That page does not identify the font in this specific 2020 reference, so it is not evidence of an exact match.

## Current treatment: Tomorrow

The current scorebug uses **Tomorrow ExtraBold Italic** for scores and **Tomorrow Bold Italic** for the clock and situation text. Its squared counters, cut corners, and heavy italic forms were selected after comparing actual rendered numerals against the supplied reference. This is an independent visual approximation. It replaces the earlier Saira treatment.

Both fonts are genuine italic faces, not browser-generated oblique text. They are distributed by [Google Fonts](https://fonts.google.com/specimen/Tomorrow) under the SIL Open Font License 1.1. The copyright belongs to the Tomorrow Project Authors; the [author's source project](https://github.com/MonicaRizzolli/Tomorrow) is identified in the bundled license.

Unmodified files from the official Google Fonts repository:

| Local file | Official source | Use |
| --- | --- | --- |
| `public/fonts/Tomorrow-ExtraBoldItalic.ttf` | [ExtraBold Italic](https://github.com/google/fonts/blob/main/ofl/tomorrow/Tomorrow-ExtraBoldItalic.ttf) | Score numerals, weight 800 |
| `public/fonts/Tomorrow-BoldItalic.ttf` | [Bold Italic](https://github.com/google/fonts/blob/main/ofl/tomorrow/Tomorrow-BoldItalic.ttf) | Game clock and labels, weight 700 |
| `public/fonts/Tomorrow-OFL.txt` | [Open Font License](https://github.com/google/fonts/blob/main/ofl/tomorrow/OFL.txt) | Copyright and redistribution terms |

The fonts are self-hosted. Keep their accompanying copyright and license when distributing the website or desktop app. No font outlines or internal names were changed.

## Verified properties and CSS

Both binaries report version **2.002**, an italic style flag, and an italic angle of **−10°**. They are static faces, with weight classes 700 and 800 respectively; they have no variable font axes. Their glyph maps include all score digits and clock punctuation.

```css
@font-face {
  font-family: "Scorebug Tomorrow";
  src: url("/fonts/Tomorrow-BoldItalic.ttf") format("truetype");
  font-style: italic;
  font-weight: 700;
  font-display: swap;
}

@font-face {
  font-family: "Scorebug Tomorrow";
  src: url("/fonts/Tomorrow-ExtraBoldItalic.ttf") format("truetype");
  font-style: italic;
  font-weight: 800;
  font-display: swap;
}
```

Small timeout labels use the system Arial/sans-serif stack to remain clear at desktop-widget sizes. The exact scorebug geometry, weight selection, and letter spacing are recreation choices, not verified original FOX font metrics.

## File integrity

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `Tomorrow-BoldItalic.ttf` | 62,280 | `c30f681ba51129cd2d81a93d5a8a5c8262d2e535ae53e73a001d3d3770636038` |
| `Tomorrow-ExtraBoldItalic.ttf` | 65,032 | `f7fe4bed14aaec1e25b1173c4eed35c3c5537e836c47db67b06189ec4adc7b19` |
| `Tomorrow-OFL.txt` | 4,477 | `1dd4eaacd1da1bfb7e1d14dd5af0279c17d4503fde55abc628bdaccc63ae9eca` |
