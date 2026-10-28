# Drawing editor — 28 October 2026

The editor now implements the requested software features: SVG canvas movement/resizing, independent dimensions with a proportion lock, mirroring, multiple SVGs, presets, selection/grouping/alignment/duplication, undo/redo, recovery autosave, paper guides/margins, hatching, stroke-order optimization, motion estimates and raised boundary simulation. 3D printing remains excluded.

## Project compatibility

The editor writes version 3 projects with `artworks` and `texts` arrays, optional `paper` metadata, and `options` for optimization/hatching. Artwork dimensions represent actual source extents in mm; X/Y locate the source midpoint relative to the work origin. Geometry and used imported fonts are embedded once per project. Opening a version 1/2 project upgrades its geometry rather than reinterpreting its size or center. Core parsing/compilation retains legacy default output when those files are used directly.

Limits: 20 SVG objects and 20 text objects, 40 total; combined planned output remains limited to 200 strokes / 2,000 points and existing simulator bounds. Closed SVG outlines are retained alongside generated hatch lines. Hatching uses even-odd containment per object; unrelated overlapping SVGs do not punch holes in one another. Open paths are preserved without fill. The tool does not infer SVG fill colors, nonzero fill rules, pressure, pen thickness or text fills. Dense hatching that exceeds limits is rejected with the last valid layout retained.

Canvas resize handles scale SVG dimensions from the center. Numeric fields allow independent stretching, including rotated/mirrored objects. Zero-width/height line artwork preserves its degenerate source axis. Group dragging, arrow movements, duplication and alignment act on whole groups; per-object numeric editing remains available. Alignment uses axis-aligned transformed geometry bounds and preserves internal offsets of groups. There is no freehand/path-node editing.

## Planning and estimates

Optimization is a deterministic nearest-endpoint ordering with reversible strokes; if it would increase pen-up XY distance from the work origin, original order is retained. It does not guarantee a globally shortest path. Preview and generated G-code share the planned strokes.

The estimate sums ink motion, XY travel and pen lifts using configured work/travel speeds and 600 mm/min vertical moves. It assumes XY initially at the work origin and excludes the unknown initial approach, acceleration and communication delays. It is not the simulator's wall-clock duration or a hardware timing guarantee.

Paper presets are original dimensional guides: A4, A5, 148×105 postcard and DL envelope, plus custom sizes. Paper and margin warnings are advisory, independent of hard simulator bounds. The six built-in drawing shapes are newly generated geometry; no official sticker assets were copied.

## History and recovery

Valid committed model states are kept in memory, up to 20 states and approximately 8 MiB of serialized history. Each drag is one edit. Undo/redo restores geometry, font data, paper and planning options; selection and input focus may reset. Native undo remains available inside text inputs.

A recovery copy is written to this origin's local browser storage after a 500 ms debounce. Restore is explicit at startup; opening the app does not silently overwrite the current layout with recovery data. Invalid drafts do not replace valid recovery. Storage failures are reported without deleting the previous copy. Project export remains necessary for backups and transfer to another computer.

## Boundary and physical operation

Run boundary is implemented in the simulator at `origin.z + penLift`, after complete source and raised-path validation, using the same home prerequisite and exclusive scheduler as other jobs. It is a rectangle preview; it does not draw ink or perform collision avoidance. Physical USB motion, homing, pen-contact calibration, drawing execution and verified pause/stop are still **not implemented**: the USB bridge remains query-only. These cannot be declared working without a connected device and measured behavior.

Before physical execution can be enabled: identify the connected firmware and tool, establish actual machine/work coordinates and pen contact height, validate motion-envelope/tool offsets and clearance, verify acknowledgement versus completed motion and M400, and measure stop/pause/unplug recovery. No automatic sending, firmware changes or physical moves were added in this batch.

Physical test IDs, acceptance evidence and run records are tracked in [dexarm-hardware-tests.md](dexarm-hardware-tests.md). All hardware entries are currently pending.

## Checks

Run `npm test`, `npm run check`, `npm run test:svg`, `npm run test:drawing` and `npm run test:joypad`. Electron checks need a graphical environment. The drawing integration check covers the actual renderer, history, planning, raised boundary moves and recovery; all execution is simulated.
