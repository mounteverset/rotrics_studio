# Hershey font data

[Source JSON](https://raw.githubusercontent.com/techninja/hersheytextjs/master/hersheytext.json) from [techninja/hersheytextjs](https://github.com/techninja/hersheytextjs).

Downloaded JSON SHA256: `1aacce429fbf5eacb060b2cd3d9ad595fa820d28c9667b9ab1177de8de14bd8a`

The [upstream README](https://github.com/techninja/hersheytextjs#readme) states that the JSON data is Public Domain. No upstream implementation code was copied; only JSON font data was converted using the existing local SVG path parser.

`src/core/font-data.js` exports `FONT_DATA`: `futural` (Sans), `timesr` (Serif), and `cursive` (Script). Each font contains ASCII 33–126 only (94 glyphs), with source index `code - 33`. Space is handled separately by the writing layout; DEL is excluded.

Source coordinates are preserved. Advance is `2 * glyph.o`. Conversion rejects commands other than absolute `M`/`L` and asserts that every parsed segment has two points. Each output stroke contains the first segment's starting point followed by each segment endpoint.

## Paired DejaVu outline and centerline data

`src/core/paired-font-data.js` exports `PAIRED_FONT_DATA`, keyed by `dejavu-sans` (DejaVu Sans) and `dejavu-serif` (DejaVu Serif). Each font keeps its regular `name`, `capHeight`, `spaceAdvance`, and 94 `glyphs` keyed by ASCII characters 33–126. Its `styles` object holds `bold`, `italic`, and `bold-italic` entries with their own metrics and glyph paths. Each glyph has `advance`, closed `outline` polylines, and `centerline` polylines or `null`. Runtime use needs only the generated JavaScript; no installed fonts or system paths are required.

Sources are DejaVu version 2.37, from the system `fonts-dejavu-core` package:

| Font file | SHA256 |
| --- | --- |
| `/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf` | `ae7b7855e115a5966d8b1b3f80f254ccc117ec86f9965e202ee2940453837280` |
| `/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf` | `5c1247acef7f2b8522a31742c76d6adcb5569bacc0be7ceaa4dc39dd252ce895` |
| `/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf` | `2d7b524ce7d51db78591b4e19c8185b89f3af0aa6534c5e524cf0c6f4ea673de` |
| `/usr/share/fonts/truetype/dejavu/DejaVuSans-BoldOblique.ttf` | `58d78a24ddff9ab30427550d68f0b9b7dd28d6690f9f4b3e4ebac7105252e9b2` |
| `/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf` | `8f2c103bfa3fd5de71f1b92b18f21906b5a26871fb7e19a9a4c9af539c3cc7ab` |
| `/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf` | `847b33e13925f19ff87e4d934d6b3cf7cac35ce16424f6f670e40c2f377cf2df` |
| `/usr/share/fonts/truetype/dejavu/DejaVuSerif-Italic.ttf` | `1d7476da447f9455a47c41adfd6ac2b1fc1b65e660f3ea4bf36128506c7e094c` |
| `/usr/share/fonts/truetype/dejavu/DejaVuSerif-BoldItalic.ttf` | `e4662d0bcf9039a5d1fb7b52f964aebdde4563be9e5a8521299936f4818c0ab2` |

`DejaVu-LICENSE.txt` is a verbatim copy of `/usr/share/doc/fonts-dejavu-core/copyright`, including the upstream font license and Debian packaging notices.

Reproduce from the repository root with the existing installed dependencies:

```sh
ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron scripts/generate-paired-fonts.mjs
```

Optionally pass exactly two regular source paths, Sans first and Serif second. The generator reads each family's style files from the same directory using the standard DejaVu filenames:

```sh
ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron scripts/generate-paired-fonts.mjs /path/DejaVuSans.ttf /path/DejaVuSerif.ttf
```

Generation uses the bundled Electron Node v24.22.0 (`Map.getOrInsert` is missing in Node 22), `opentype.js` 2.0.0, and `flo-mat` 5.0.5. It reads paths at a 100-unit em with `toPathData({ decimalPlaces: 5, optimize: false, flipY: false })`, then `getPathsFromStr`. Centerlines use `findMats` with `applySat: false, simplify: false`, `toScaleAxis` at 1.5, `simplifyMat` at tolerance 0.05, and `traverseEdges` / `getMatCurveToNext`, joined by the existing `planStrokes` helper. Both modes use the shared `flattenCurve` with point objects, tolerance 0.1, and the first point seeded in the output. Stored coordinates are rounded to five decimal places and flipped from SVG Y-down exactly once to Y-up with baseline zero. Metrics retain their source precision: `capHeight` is the height of the H bounds, and glyph/space advances are `advanceWidth / unitsPerEm * 100`.

Every retained stroke has at least two finite points and nonzero length. The combined modes of each glyph are capped at 2,000 points and 200 strokes. Each MAT component must retain nondegenerate edges and its topology after cleanup; a missing or degenerate component, conversion exception, or exceeded cap makes the entire centerline `null`, preserving the outline without substituting it for a centerline. The generator reports exact unavailable characters, ASCII codes, counts, and reasons.

Writing accepts optional `style: 'regular' | 'bold' | 'italic' | 'bold-italic'`. Omission uses regular geometry and remains omitted from validated settings, preserving legacy projects. Hershey supports only regular. Styles use actual font outlines and derived centerlines, with each variant's own cap height and advances; no synthetic slant or stroke widening is applied. Sans italic uses Oblique; Serif italic uses Italic. Font IDs and the five display names remain unchanged.

All eight variants provide all 94 ASCII outlines. The following centerlines are unavailable and explicitly rejected (there is no substitution); their outlines remain usable:

| Family | Style | Unavailable centerline characters |
| --- | --- | --- |
| Sans | regular | none |
| Sans | bold | `*`, `4` |
| Sans | italic | `A` |
| Sans | bold-italic | `*` |
| Serif | regular | `#`, `:`, `;` |
| Serif | bold | `*`, `.`, `?`, `L` |
| Serif | italic | `#`, `[`, `]` |
| Serif | bold-italic | `*` |

Coverage remains English letters, numbers, and ASCII punctuation, plus layout spaces and line breaks. Missing glyph records or mode paths are rejected explicitly for both DejaVu and Hershey.

The generator self-checks the serialized data before writing: two families with four variants of exactly 94 glyphs each, finite positive metrics, finite nonzero strokes, closed outlines, combined per-glyph caps, H extending upward from baseline zero to cap height, and Sans T having exactly two centerline strokes and closed outline loops. Source hashes, font/library versions, and conversion parameters are also recorded in the generated provenance comment.
