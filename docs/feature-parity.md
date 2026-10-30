# Rotrics Studio feature parity

Reviewed 27 October 2026 against the manufacturer's manual and the public Studio `dev` source. The source branch and old manual are behavior references, not proof that every released installer behaves identically. This replacement includes simulation and separate physical USB pen controls tested against fake serial devices. **No physical feature parity is claimed.** Pending device tests are tracked in the [running hardware ledger](dexarm-hardware-tests.md).

## Baseline and current coverage

| Original capability | Replacement status | Remaining gap |
| --- | --- | --- |
| Connect, position reports, device/firmware information | Desktop USB connection, M114/M115, explicit home/jog/XYZ and validated drawing/G-code streaming | USB pen jobs implemented; physical qualification and module detection/selection pending |
| Home and XYZ jogging | Simulator home, discrete jog, configurable speed, direct XYZ moves | Physical homing, motion envelopes, and fast motion mode need validation |
| Drawing SVG/text, dimensions, origin, generate/download G-code | Implemented; Version 3 multi-SVG/text layouts, real font styles and centerlines, canvas transforms/mirroring, presets, grouping/alignment, undo/recovery, hatching, travel optimization, paper guides and motion estimates | Physical drawing/work-height calibration; general SVG/path editing |
| Work speed, travel speed, pen offset | Separate drawing work/travel speeds and adjustable pen lift | Limits remain illustrative; default legacy output is preserved |
| Import third-party G-code, review and execute | XYZ subset import, modal-state handling, path/bounds review, canonical export, simulator playback | Does not accept arbitrary Cura/laser/extrusion code, arcs, offsets, homing, or accessories |
| Teach & Play, repeat, tool actions | Editable named waypoints, simulator position capture, waits, repeat, reorder/delete, suction/gripper simulation, sequence JSON save/open and G-code export | Physical hand guidance, motor release/recapture, rotary tool, hardware playback |
| Pause/resume/stop, progress | One shared acknowledged simulator scheduler for drawings, imports and sequences | Real firmware buffering and stop/output shutdown need hardware tests |
| Laser SVG/raster/text, power and processing modes | Not implemented | Image processing and laser job preparation; verified hardware output controls |
| STL/OBJ model placement, slicing, print settings | Intentionally out of scope | 3D printing is excluded from the current and foreseeable scope; not a remaining parity gap |
| Joypad control | Dedicated standard-Gamepad workspace with XYZ hold-to-jog, fine steps, input monitor and automatic disarm | Real controller/OS qualification; physical, rotary and pump control remain unimplemented |
| Scratch visual programming | Not implemented | Blocks editor, execution semantics, and project compatibility |
| Rotary, conveyor, rail | Not implemented | Accessory configuration, limits and motion models |
| Settings/languages, firmware upgrades | Versioned local files and diagnostics only | Localization, firmware workflow, calibration and OS installers |

## This implementation batch

### Imported G-code

Use the **G-code** workspace to open `.gcode`/`.nc`/`.txt` or paste source, then **Review G-code**. Review validates the entire input before enabling playback. Original source is not streamed directly: units, relative moves, rapid moves and modal feed rates are resolved into canonical linear XYZ commands. Unsupported lines fail explicitly, with no partial runnable job. Any source edit clears review and disables Send/Download.

Supported: explicit G21 and G90 setup, G0/G1 with XYZ/F, G91 after position is known, G4 P/S waits up to 2 seconds, M400, semicolon and single-line parenthesis comments. An initial absolute Z-only lift is allowed so this application's drawing exports can be reopened without inventing an initial XY position. The first XY move must establish both X and Y and a known Z. Targets and feed rates must fit simulator limits. Maximum 256 KB and 5,000 nonempty command lines.

G0 is displayed as source rapid travel and normalized to G1 for deterministic linear simulation. Bounds include Z but the canvas is a top view: initial approach, vertical motion, contact state and collisions cannot be inferred from it. Distance/ideal path-time estimates omit the unknown initial approach and acceleration and do not predict the simulator's acknowledgement timing. No heating, extrusion, laser, home, origin reset, or firmware/accessory commands are accepted.

### Teach & Play

Choose **Teach & Play**, connect/home to record simulator positions, or add editable moves while offline. Arrange named absolute XYZ moves, waits and tool actions; set a repeat count, generate, review and play. Save/open `.teach.json` to retain editable steps. G-code export is separate from the drawing project.

Suction pick uses M1000; suction release uses M1002, following the original Studio Teach settings. Gripper pick/grip uses M1001 and release uses M1000. Neutral uses M1002 and off uses M1003. Pneumatic sequences start off and finish with neutral/off. The simulator shows its acknowledged pump state; this is not a physical sensor reading. A completed sequence cleans up its simulated outputs; a stopped/lost connection is shown as unknown rather than claiming a physical shutdown.

Moves are direct between waypoints; no lift or collision avoidance is inserted. Add intermediate lift/clearance points yourself. Maximum 100 steps, 20 repetitions, waits of 0–2,000 ms each and at most 120 seconds of total repeated waits. These limits keep waits within the current command timeout. Empty sequences can be saved; playback requires at least one move. All job types share the same home prerequisite and run lock.

### Drawing and manual control

This batch adds optional per-text rotation (−180 to 180 degrees counterclockwise about the box center) and duplication of the selected text box, both retained in editable saved projects and generated G-code; no hardware behavior is claimed.

Drawing projects accept optional `travelFeedrate` (60–3,000 mm/min) and `penLift` (1–30 mm). Contact motion uses the existing work `feedrate`; XY travel uses the independent travel speed, and vertical lifts retain 600 mm/min. Clearance is included in full-path bounds validation. Missing fields retain the old travel speed and 10 mm lift so existing projects compile identically. Manual Control adds explicit XYZ targets and a jog/move speed setting.

## Next parity batches

1. Physical drawing qualification and richer G-code visualization/diagnostics. The drawing editor batch is documented in [drawing-editor.md](drawing-editor.md).
2. Laser/raster job preparation, with tool-specific previews and formats. 3D printing, including external-slicer print inspection, is intentionally excluded from the current and foreseeable scope. Treat hardware execution as a separate milestone.
3. Blocks programming and accessories, followed by firmware/settings/localization and platform packaging.

Physical execution requires device/firmware identification and observed serial transcripts, calibrated coordinates/tool offsets, motion-envelope tests, and verified pause/stop/output-off behavior. USB pen commands now use main-process validation and a dedicated physical job lock; tools, printing and raw commands remain rejected.

## Sources inspected

- [Manufacturer Studio overview](https://manual.rotrics.com/product-overview/software-rotrics-studio): Basic, G-code, Teach & Play, drawing, laser, printing, Scratch, settings.
- [Drawing workflow and parameters](https://manual.rotrics.com/get-start/drawing-and-writing): placement, work/jog speeds, pen offset and generation/download/send.
- [Teach and pneumatic manual](https://manual.rotrics.com/get-start/picking-and-placing): movement and pneumatic action meanings.
- [Legacy G-code UI](https://github.com/Rotrics-Dev/rotrics-studio-app/blob/dev/web/src/containers/basic/ui/Gcode/Index.jsx): file import, front-end choice, start/stop send.
- [Legacy Teach & Play UI](https://github.com/Rotrics-Dev/rotrics-studio-app/blob/dev/web/src/containers/basic/ui/TeachAndPlay/Index.jsx) and [settings](https://github.com/Rotrics-Dev/rotrics-studio-app/blob/dev/web/src/containers/basic/lib/settings/teach_and_play.json): repeat, step array, tool-specific action and rotary controls.
- [Official Python API](https://github.com/Rotrics-Dev/DexArm_API/blob/master/pydexarm/pydexarm.py): command examples, G4 waits and module/action commands. Where its suction-place helper differs, this implementation follows the legacy Teach settings and manual release-to-neutral behavior.

The theoretical reach table and pen offsets were adapted from the original MIT-licensed Studio; attribution is retained in `assets/notices/rotrics-studio.txt`. No firmware code was copied. Full released-app runtime, other operating systems, physical robot operations and hazardous tools were not tested.
