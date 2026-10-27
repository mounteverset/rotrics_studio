# Font outlines to pen centerlines

Research date: 27 October 2026. Documentation/source review only; no conversion packages were installed or benchmarked.

Follow-up: a [runnable experiment and measured results](experiments/centerline/README.md) now test the vector approach on two real fonts. The findings below describe the initial research.

## What the requested feature means

An ordinary outline font stores the boundary of a filled letter. Converting text to SVG preserves that boundary; it does not recover the strokes used to write the letter. The requested feature is centerline extraction, also called skeletonization or medial-axis extraction, followed by cleanup and pen-stroke planning.

For a simple T, the desired result is a vertical stroke and a horizontal stroke. The output SVG needs two open subpaths rather than a closed polygon around the letter. This does not mean every glyph must be open: O should still have a loop, and B should retain two counters. A branched letter can require pen lifts to avoid retracing.

## Relevant packages

| Candidate | Documented capability | Assessment for this app |
| --- | --- | --- |
| [opentype.js](https://github.com/opentypejs/opentype.js) | Reads font files and exposes glyph Bézier outlines and metrics in JavaScript. MIT. | Font ingestion and outline extraction, not a centerline converter on its own. Pair with an extraction algorithm. |
| [flo-mat](https://github.com/FlorisSteenkamp/MAT) | JavaScript/TypeScript medial-axis and scale-axis transforms for closed line/quadratic/cubic Bézier loops, including shapes with holes. MIT. | First vector candidate to evaluate for an Electron/JavaScript implementation. Its scale-axis transform suppresses insignificant branches, but font-specific pruning and stroke planning still need evaluation. |
| [skeleton-tracing](https://github.com/LingDong-/skeleton-tracing) | Converts binary-image skeletons to polylines; JavaScript and WebAssembly implementations. MIT. Its documented pipeline includes raster thinning. | Candidate for a local raster fallback: render text, threshold/thin, trace, simplify, and plan strokes. Resolution and cleanup affect fidelity. |
| [AutoTrace](https://github.com/autotrace/autotrace) | Bitmap-to-vector conversion with a centerline mode and SVG output; command-line program and C library. Program GPL-2-or-later; library LGPL-2.1-or-later per upstream. | Useful reference and desktop comparison baseline. Packaging native binaries and reviewing distribution obligations adds work. |
| [centerline-fonts](https://github.com/ChristianHartmann/centerline) | Font-to-centerline pipeline with pruning, spline fitting, stroke splitting, and SVG/JSON output. Python, MIT. | Particularly relevant research candidate. Its project metadata reports version 0.0.1 and dependencies including fontTools, pyvoronoi, Shapely, NumPy, and SciPy. Evaluate the results independently before considering a Python runtime in this app. |

Sources: [flo-mat algorithm and API](https://raw.githubusercontent.com/FlorisSteenkamp/MAT/master/README.md), [flo-mat metadata](https://raw.githubusercontent.com/FlorisSteenkamp/MAT/master/package.json), [skeleton-tracing algorithm](https://raw.githubusercontent.com/LingDong-/skeleton-tracing/master/README.md), [centerline-fonts metadata](https://github.com/ChristianHartmann/centerline/blob/master/pyproject.toml).

Inkscape provides an existing manual comparison workflow through Path → Trace Bitmap → Centerline tracing (autotrace). It operates on a rasterized image, not directly on an editable font glyph. Its own documentation describes producing strokes rather than filled areas. [Inkscape tracing tutorial](https://inkscape.org/en/doc/tutorials/tracing/tutorial-tracing.ru.html/)

## Why extracting the middle is only part of the job

A geometric skeleton is not necessarily an ideal handwriting path. Letter corners and serifs may introduce branches; overly aggressive pruning can remove intended details. The conversion must preserve counters, disconnected dots, and intersections while producing a compact stroke graph. Graph edges then need to be grouped and ordered without accidentally drawing shared branches twice.

The recommended output is a set of open or closed strokes, not a single continuously drawn path for an entire glyph. Each stroke should be represented once, with explicit pen-up transitions. Stroke ordering and natural writing order are separate from geometric extraction.

A uniform-width pen cannot reproduce the variable thickness of every original typeface. Centerline conversion can retain its basic letterforms, but weight, contrast, and decorative terminals may change. Conversion quality needs a visual preview and must not be advertised as exact recovery of the font designer's original strokes.

## What our app currently does

Inspected `src/core/font-data.js` and `src/core/writing.js`:

- Hershey Sans T already contains exactly two straight strokes: `(8,1) → (8,22)` and `(1,1) → (15,1)`.
- Hershey Serif T contains two parallel vertical strokes plus serif details. It is a stroke font, but it does not meet a strict one-centerline-per-stem requirement.
- Script uses its own supplied glyph paths rather than deriving a skeleton from a chosen ordinary font.
- The app does not yet import custom TTF/OTF fonts, extract centerlines from them, or export writing as SVG. Its current text paths do feed the simulator and project save/load.

Therefore native stroke-font selection and conversion of an arbitrary chosen typeface should be separate writing modes.

## Proposed next implementation

1. Keep the native stroke-font mode; clearly identify which faces contain parallel strokes.
2. Prototype custom-font ingestion with opentype.js and vector centerlines with flo-mat. Process conversion outside the UI thread and cache results per font/glyph/settings.
3. Compare the prototype against AutoTrace raster output and the font-specific Python project on the same test fonts. Do not add multiple engines to the product before this comparison establishes a need.
4. Use a small test set: `T I L H X A O B i j g 8 @`, spaces, and accented letters. Include sans, serif, and script faces. Check stroke count, duplicate edges, loops/counters, disconnected dots, shape fidelity, conversion time, and SVG round-trip behavior.
5. Present original outlines in gray and candidate centerlines in blue. Offer a cleanup control, explicit warnings for failed glyphs, and Export centerline SVG with `fill="none"`. Never silently fall back to outlines when centerline extraction fails.
6. Reuse the existing stroke validation, workspace bounds, preview, and pen-lift command generator. Keep physical execution subject to the existing hardware-validation boundary.

The vector-first recommendation is an architectural judgment based on our existing JavaScript app and access to original font outlines, not a measured ranking of conversion quality. No code or dependencies were changed for this research.
