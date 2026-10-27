# DexArm Studio

An offline desktop application foundation for the Rotrics DexArm. Drawing and jogging run in a simulator. The desktop app also offers **USB diagnostics**, with physical motion disabled.

## Run

Requires Node.js 22.12 or newer and npm.

```sh
npm ci
npm start
```

Electron downloads its platform runtime on first launch, which requires Internet access. Subsequent launches use the downloaded runtime. A desktop session and the usual Electron system libraries are required. Installers and signing are not configured yet.

For the same interface in a browser, no dependency installation is needed:

```sh
npm run dev
```

Open **http://127.0.0.1:4173**. The development server listens on loopback only; stop it with Ctrl+C.

## Try the workflow

1. **Layout:** adjust the star or import SVG, or click **Insert text**. Click it again to add another text box. Click a box on the canvas (or choose it from **Text boxes**) to edit that box's text, font, style, height, spacing, and multiline alignment.
2. Drag text boxes into place. Use **Box X/Y offset** for precise placement relative to the work origin. Focus a canvas box and use arrow keys for 1 mm moves, or Shift + arrow for 10 mm. Positive Y moves upward. The canvas shows the actual pen paths, pen-up travel, and work origin.
3. **Generate G-code:** click the prominent **2 · Generate G-code** button. No robot connection is required. Generation validates the complete layout and the 10 mm pen-up clearance against illustrative simulator limits. Review **Generated G-code** below the workspace or use **Download .gcode**. Editing text, placement, or job settings clears generated commands and requires regeneration.
4. **Send:** click **Connect simulator**, then **Home simulator**, then **3 · Send to simulator**. The simulator executes the generated layout. Physical **Send to robot** remains unavailable pending firmware and calibration validation; exported G-code is not certified for physical use.
5. Pause/resume at simulated command boundaries, or use **Stop simulation**. Stop disconnects the simulator and requires a fresh connection and home.
6. Switch to **Control** for discrete XYZ jogging. **Use pen position** in Draw changes the project origin; it does not change firmware settings.
7. Save a `.dexarm.json` project, then reopen it using **Open project**. Multi-text layouts use version 2 and retain individual text settings and positions alongside optional imported SVG. Older version 1 star, SVG, and writing projects still open; single writing is upgraded without changing its pen paths. Changes are held in memory until saved; there is no autosave. **Use star** replaces the complete layout; importing SVG replaces existing SVG while keeping text boxes.

The command activity drawer shows the most recent 150 sent/received lines. The progress display counts acknowledged commands; simulation completes after its `M400` acknowledgement.

## Writing and pen fonts

Choose **Draw → Insert text**, type your text, then adjust its font, style, letter height, spacing, and left/center/right multiline alignment. Press Enter for a new line. Insert more boxes and position each independently. The canvas updates as valid text is entered. Delete the selected text with **Delete text**; an empty layout can be saved but cannot generate G-code.

Choose **Pen path → Outline / Centerline** in the right-hand drawing menu. Each option has a tooltip and an illustrative T; the main canvas shows the actual generated paths. The selection also controls the compiled commands and is saved with your project.

**DejaVu Sans** and **DejaVu Serif** offer both modes using bundled, precomputed paths. Outline traces letter borders; Centerline follows their approximate middle. New text defaults to DejaVu Sans centerline. Three **Hershey** fonts (Sans, Serif, Script) remain available as stroke fonts; Outline is disabled for these because they contain no filled letter outlines. Everything works offline. See [font provenance](assets/fonts/README.md).

**Font style** offers Regular, Bold, Italic, and Bold italic for DejaVu using actual font variants. Hershey has a fixed regular stroke style. Centerline follows the selected variant but cannot change the physical pen thickness. Some converted centerline glyphs are unavailable in each style (for example regular Serif `#`, `:`, `;`, and italic Sans `A`); the editor reports these explicitly and never substitutes outlines. Choose another style/font or Outline. See the complete table in [font provenance](assets/fonts/README.md). Converted serifs may use several strokes.

- Letter height is the nominal capital height in millimeters (2–40 mm). Descenders and decorative strokes can extend beyond it. Writing uses its own letter height; the SVG Design size control is shown only when SVG artwork is present.
- Letter spacing adds 0–10 mm between glyph advances. Line spacing sets baseline distance to 1–3 times the letter height. Multiline alignment is relative to the longest logical line.
- Each logical text block is centered on its own X/Y offset from the work origin. Spaces and blank lines affect layout. Every pen stroke uses the same contact Z and 10 mm lift as other drawings.
- Supported input: English uppercase/lowercase letters, digits, ASCII punctuation, spaces, and line breaks. Maximum 20 text boxes, each up to 160 characters and 8 lines, subject to the combined 200-stroke/2,000-point job limit (including SVG). Unsupported characters are reported explicitly; they are never silently dropped. Shorten text, lower the height, or choose a simpler font when validation reports a limit.
- Invalid edits leave the last valid canvas visible, show an inline explanation, and require successful G-code generation before Send is enabled. Text must also fit the illustrative workspace, including pen-up clearance.
- Saving retains each box’s editable text, font, style, path mode, position, size, spacing, and alignment. Text boxes can share the layout with one imported SVG. Font uploads and text rotation are not implemented.

Writing execution remains simulated. USB diagnostics cannot send writing or other motion commands to a physical robot.

An optional [custom-font centerline experiment](docs/experiments/centerline/README.md) tests ordinary outline fonts with OpenType.js and flo-mat. It produces centerline SVGs and validated simulator projects. This is a development command, not an app font-upload control; the report includes comparison images, measured results, and limitations.

## USB diagnostics (desktop only)

1. Run `npm start` and select **Control**. The **USB diagnostics** panel is separate from the simulated device controls.
2. Click **Refresh ports**, then select the computer-facing serial port. The list includes other serial devices; it does not identify or certify a DexArm. Check the model-specific data cable and computer port in the Rotrics manual. Close other applications that might own the port.
3. Click **Connect USB**. The app opens that port at 115200 baud, 8 data bits, no parity, one stop bit, and no flow control. Connecting sends **no commands**. Opening a serial connection may still reset some hardware, so connect only the intended device with its work area clear.
4. Click **Read firmware** (`M115`) or **Read position** (`M114`). These are the only commands accepted by both the IPC interface and device service. There is no raw command console or physical home/jog/run action.
5. Inspect the separate reports and USB transcript. **Export diagnostic report** downloads the selected port path, firmware report, latest reported coordinates, status, and recent transcript as local JSON. Review it before sharing; it can contain device-specific information.
6. Click **Disconnect USB** when finished. Disconnection does not halt a robot or switch off its tools. Errors require an explicit reconnection; no commands are retried automatically.

The simulator may run while USB diagnostics are connected. Its canvas, coordinates, Home, Stop, and job controls always refer to the **simulator**, never the physical arm. Physical reports are not calibrated tracking, and a firmware name is not proof of hardware identity. There is no automatic polling.

In the browser preview, USB controls explain that Electron is required and remain unavailable. If the native serial bindings fail to load, the simulator remains usable. Port errors usually require checking drivers, permissions, the data cable, or another application's ownership; the app does not change system permissions.

## Validation

```sh
npm test
npm run check
npm run test:svg
```

Tests use Node's built-in test runner, without third-party test dependencies. They cover serial message framing, command ordering, timeouts, disconnects, acknowledgement matching, job pause/resume/stop, homing prerequisites, decimal jogging, project validation, pen-up bounds, SVG path parsing, transforms, curve flattening, text layout/font coverage, editable writing projects, multi-text layouts and legacy migration, actual font styles, complete-layout compilation, and USB diagnostics with fake ports. IPC tests verify sender/frame authorization and the exact query whitelist. Tests never open a physical serial port. Individual test files can also be run directly, e.g. `node tests/writing.test.js`.

`npm run test:svg` uses a hidden Electron window to test the actual XML importer against valid and adversarial SVG fixtures. It requires Electron's desktop system dependencies. It does not connect to hardware or require the preview server.

## SVG import

- Supported elements: `path`, `line`, `polyline`, `polygon`, unrounded `rect`, `circle`, `ellipse`, and groups.
- Supported path commands: absolute/relative `M L H V C S Q T Z`, including implicit repeated coordinates and separate subpaths. SVG arc commands (`A`) are rejected; convert them to Bézier paths first.
- Supported transforms: `matrix`, `translate`, `scale`, and `rotate`, including nested groups. Other transforms must be converted to a matrix first.
- Geometry is centered on the project origin, SVG Y is flipped into machine Y, aspect ratio is retained, and the longest artwork dimension becomes **Design size**. Root width/height and viewBox whitespace do not set physical dimensions. Curves are approximated by line segments; this is not a physical accuracy guarantee.
- This is an **outline plotter**, not a full SVG renderer. Fill, color, and stroke width do not create hatching or thick strokes. Text, images, references, styles/classes, clipping, masks, filters, dashes, markers, nested SVG viewports, and active content are rejected. Export a plain SVG with visible paths, converting text and arcs to Bézier paths.
- Limits: 256 KB input, 200 strokes, 2,000 flattened points, 1,000 XML elements, and 30 levels of nesting. Simplify complex artwork before importing.
- Imported XML is parsed in a detached document. Original nodes are never inserted into the application; only numeric geometry is saved or drawn. Failed imports leave the current project unchanged.

## Layout

```text
src/main/main.cjs       Electron entry point; sandboxed renderer, no Node access
src/main/preload.cjs    Narrow USB diagnostics bridge
src/main/device.js      Main-process USB connection and diagnostic state
src/main/device-ipc.cjs IPC authorization and command validation
src/protocol/          Command scheduler and deterministic serial simulator
src/core/              Device/job state and validated drawing projects
src/core/writing.js     Stroke-font lettering, multiline layout and validation
src/core/font-data.js   Three bundled Hershey stroke fonts
src/core/paired-font-data.js  DejaVu outline and centerline glyphs
src/renderer/          Native HTML/CSS/JavaScript interface and SVG preview
scripts/serve.js        Dependency-free browser development server
scripts/check-svg.cjs   Native XML importer check runner
tests/                 Protocol, controller, and project tests
assets/examples/       Example SVG artwork
assets/fonts/          Font source and licensing notes
docs/                  Research and product roadmap
```

The interface uses standard browser modules and native controls. Electron and SerialPort are the direct dependencies. There is no framework build step, server deployment, cloud service, telemetry, or account requirement. The simulator runs inside the renderer; physical serial access stays in the main process behind a narrowly validated IPC interface.

## Current boundaries

- SVG import supports the subset described above. G-code import, laser, printing, teaching, and firmware updates are not implemented.
- Workspace bounds (`X −150…150`, `Y 180…380`, `Z −20…100`) are illustrative simulator limits, **not validated DexArm limits**. Projects must fit both the drawing and its 10 mm lift inside them.
- Simulator acknowledgements follow simulated completion. Real firmware can buffer motion; pause, cancellation, `M400`, command deadlines, and output shutdown need hardware verification before enabling physical commands.
- Stop is a simulator cancellation action, not a physical emergency stop. No claim is made about laser safety, collision avoidance, calibration, or hardware accuracy.
- Projects are versioned JSON capped at 256 KB on import. Imported settings and artwork are validated, unknown fields are discarded, and files are never executed.
- This is an independent prototype; official branding, old project compatibility, and reuse of upstream assets have not been established.

The next milestone is validating diagnostic transcripts and a capability matrix for a specific arm/firmware/OS before enabling physical motion. USB behavior has been tested with fake ports and native binding enumeration, not an actual DexArm. See [research and delivery plan](docs/studio-research-and-plan.md).
# rotrics_studio
