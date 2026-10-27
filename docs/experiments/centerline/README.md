# Centerline conversion experiment

Tested 27 October 2026 using locally installed DejaVu Sans and DejaVu Serif. This is a runnable development experiment, not a new font-import control in the app. No physical device was connected.

## Inspect or try the results

- [Sans comparison](sans/comparison.png): original outlines, raw skeleton, and pruned centerlines.
- [Serif comparison](serif/comparison.png): the same test with serif details retained.
- [Sans centerline SVG](sans/centerlines.svg) and [Serif centerline SVG](serif/centerlines.svg): geometry only, suitable for **Import SVG**.
- [Sans project](sans/drawing.dexarm.json) and [Serif project](serif/drawing.dexarm.json): open directly with **Open project**, then preview and run in the simulator.
- [Single-T project](t/drawing.dexarm.json): a short two-stroke test of the user's original example.

Comparison SVGs contain labels and filled outlines and are for inspection, not import. Only `centerlines.svg` contains the clean drawing paths. JSON projects contain precomputed artwork; they do not retain editable text/font controls.

## Reproduce with another font

```sh
npm ci
npm run experiment:centerline -- /path/to/font.ttf "T A O B i g 8" docs/experiments/my-font
```

This writes `centerlines.svg`, `comparison.svg`, `drawing.dexarm.json`, and `metrics.json` into the selected output directory, replacing files with those names if they exist. The checked-in PNGs are rendered inspection artifacts; the experiment itself generates SVGs rather than requiring an image-rendering dependency.

The runner uses Electron's bundled Node 24 runtime: current `flo-mat` dependencies use `Map.getOrInsert`, which is missing in our Node 22 development runtime despite the packages' broader engine metadata. The app itself and its normal tests still run under Node 22. There is no global compatibility patch.

Input is a local font file under 10 MB and up to 40 characters on one line. Unsupported/missing glyphs, empty skeletons, invalid geometry, and drawings exceeding the app's geometry/workspace limits fail explicitly. The child process has a 60-second deadline. The experiment is not hardened as a general untrusted-font upload service.

## Pipeline

1. `opentype.js` 2.0.0 reads the selected font and extracts each glyph's vector outline at 100-unit em size. SVG serialization explicitly disables OpenType.js's additional Y flip to preserve upright text.
2. `flo-mat` 5.0.5 computes the medial axis, then applies a scale-axis transform at 1.5.
3. Its simplifier reduces the remaining curves at a 0.05-coordinate-unit tolerance. This is an experimental vector tolerance, not a guarantee of physical drawing accuracy.
4. A small graph planner deduplicates reversed identical edges, joins connected curves, and prefers straight continuation at junctions. Each retained edge is consumed once. It is not a globally optimal or natural-handwriting stroke planner.
5. The SVG export uses unfilled, stroked paths. The same curves are flattened, normalized, and passed through the existing project validation and command generator to produce a simulator project.

Font advances are used with an additional 12-unit visual gap; there is no kerning, ligature shaping, multiline layout, variable-font axis selection, or glyph caching in this experiment.

## Findings

| Glyph | Sans pen strokes | Serif pen strokes | Observed topology |
| --- | ---: | ---: | --- |
| T | 2 | 3 | One connected shape, no cycles |
| A | 2 | 5 | One counter retained |
| O | 1 | 1 | One closed centerline loop |
| B | 2 | 3 | Two cycles retained |
| i | 2 | 3 | Dot and stem remain separate components |
| g | 2 | 2 | One cycle in these particular glyphs |
| 8 | 2 | 2 | Two cycles retained |

On this machine the recorded per-glyph extraction, cleanup, and planning times for the two seven-character samples were approximately 4–67 ms. These exclude font parsing, project flattening, process startup, and artifact writes, and are single-run observations rather than a performance benchmark. The generated full samples require 464 and 557 simulator commands respectively.

The Sans T goes from 63 raw medial-axis pieces to 5 simplified pieces joined into **two pen strokes**, without an enclosing font-outline loop. The Serif T retains meaningful terminal/serif branches and therefore remains three strokes. Corners and junctions may curve, terminals shorten, and the `i` dot becomes a tiny segment rather than a filled dot. These are centerline approximations, not perfect recovery of intended handwriting strokes.

Components and cycle counts are checked before and after pruning/simplification. This catches topology changes introduced by cleanup relative to the raw computed skeleton; it does not prove that the raw skeleton matches every possible font outline correctly. Visual inspection was performed on both comparison images.

Validation also passed the existing unit suite plus nine graph-planning tests, the 39 native SVG checks, and explicit native imports of all three exported SVGs. Their command counts match the generated projects: 464 (Sans), 557 (Serif), and 37 (single T). All three projects completed through the existing simulator controller. No physical commands were sent.

Conclusion: the vector approach is viable for an experimental custom-font mode. It needs explicit cleanup choices and preview warnings before being offered as a reliable automatic conversion for arbitrary fonts. Existing built-in stroke fonts remain the dependable writing option.
