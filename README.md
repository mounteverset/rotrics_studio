# DexArm Studio

An offline desktop application foundation for the Rotrics DexArm. Drawing and jogging run in a simulator. The desktop app also offers **USB diagnostics**, with physical motion disabled.

## Build and install from source

### Requirements

- Git, Node.js **22.12 or newer**, and npm. Check your installation with `node --version` and `npm --version`.
- For the desktop app: a graphical desktop session and the operating-system libraries required by Electron. Linux needs a working display and Chromium/Electron libraries (including GTK, NSS, and audio libraries). Windows and macOS need an Electron-supported OS and CPU architecture.
- Internet access for the initial dependency installation and the first desktop launch. Electron 45 downloads its platform runtime on first use; later launches use that installed runtime.

### Clone and install

Run these commands in a terminal on the destination machine:

```sh
git clone https://github.com/mounteverset/rotrics_studio.git
cd rotrics_studio
npm ci
```

Use `npm ci` to install the exact versions recorded in `package-lock.json`, including development dependencies. Electron is a development dependency, so do not use `--omit=dev` for a desktop installation. Run the installation on each destination machine; do not copy `node_modules` between operating systems or CPU architectures.

### Start the desktop application

```sh
npm start
```

There is **no transpilation or bundling step and no `npm run build` command**. The checked-in HTML, CSS, JavaScript, and generated font paths are the application source; `npm start` opens them in Electron. The first launch downloads Electron if necessary. To download its runtime ahead of time, run `npx --no-install install-electron` after `npm ci`. No system font installation or font regeneration is needed. Installers, standalone executable packaging, code signing, and automatic updates are not configured.

### Start the browser interface

For drawing with bundled fonts, G-code generation/export, and simulation in a browser, Node.js alone is sufficient. Custom TTF/OTF imports additionally require `npm ci`:

```sh
npm run dev
```

Open [DexArm Studio locally](http://127.0.0.1:4173). The development server listens on loopback only; stop it with Ctrl+C. Browser mode has no USB diagnostics; use the desktop app for those.

### Verify the source checkout

After `npm ci`, run:

```sh
npm run check
npm test
npm run test:svg
npm run test:joypad
```

The first two commands work without a graphical desktop. `test:svg` uses Electron and needs its platform libraries and a display session. Tests use simulated transports and fake serial ports; no robot is required.

If installation or startup fails:

- If Electron's runtime download fails, check Internet/proxy access and run `npx --no-install install-electron`, then retry `npm start`.
- If Linux reports missing shared libraries or no display, install the Electron prerequisites for your distribution and run inside a graphical session. The browser interface remains available with `npm run dev`.
- SerialPort normally uses a prebuilt native binding. If npm reports blocked install scripts, review them with `npm install-scripts ls` on npm versions supporting that command; approve only the required package, such as `@serialport/bindings-cpp`, rather than enabling all dependency scripts. If your platform needs to compile it, install the platform's native build toolchain and Python required by node-gyp, then rerun `npm ci`.
- If a USB port cannot be opened, check OS permissions/drivers and whether another application owns it. USB diagnostics are optional; they do not enable physical motion.

After updating the checkout, run `git pull` followed by `npm ci` and the verification commands again. Local projects are separate `.dexarm.json` files; transfer them separately to the other machine.

## Try the workflow

1. **Layout:** adjust the star or import SVG, or click **Insert text**. Click it again to add another text box. Click a box on the canvas (or choose it from **Text boxes**) to edit that box's text, font, style, height, spacing, and multiline alignment.
2. Drag text boxes into place. Use **Box X/Y offset** for precise placement relative to the work origin. Focus a canvas box and use arrow keys for 1 mm moves, or Shift + arrow for 10 mm. Positive Y moves upward. The canvas shows the actual pen paths, pen-up travel, and work origin.
3. **Generate G-code:** click the prominent **2 · Generate G-code** button. No robot connection is required. Generation validates the complete layout and configured pen-up clearance against illustrative simulator limits. Review **Generated G-code** below the workspace or use **Download .gcode**. Editing text, placement, or job settings clears generated commands and requires regeneration.
4. **Send:** click **Connect simulator**, then **Home simulator**, then **3 · Send to simulator**. The simulator executes the generated layout. Physical **Send to robot** remains unavailable pending firmware and calibration validation; exported G-code is not certified for physical use.
5. Pause/resume at simulated command boundaries, or use **Stop simulation**. Stop disconnects the simulator and requires a fresh connection and home.
6. Switch to **Control** for discrete XYZ jogging. **Use pen position** in Draw changes the project origin; it does not change firmware settings.
7. Save a `.dexarm.json` project, then reopen it using **Open project**. Multi-text layouts use version 2 and retain individual text settings and positions alongside optional imported SVG. Older version 1 star, SVG, and writing projects still open; single writing is upgraded without changing its pen paths. Changes are held in memory until saved; there is no autosave. **Use star** replaces the complete layout; importing SVG replaces existing SVG while keeping text boxes.

The command activity drawer shows the most recent 150 sent/received lines. The progress display counts acknowledged commands; simulation completes after its `M400` acknowledgement.

## Joypad mode

Choose **Joypad** in the sidebar. Connect and home the simulator, connect a gamepad, and press a button while Studio has focus. Select the controller, center both sticks, release RB/R1, then click **Enable joypad**. Standard-mapped controllers only; unsupported mappings are reported.

Hold **RB/R1** to move: left stick controls X/Y and right stick up/down controls Z. Hold **LB/L1** for fine movement (0.2 mm instead of up to 1 mm per acknowledged step). **B/Circle**, **Escape**, or **Disable joypad** disarms it. Live input readouts show how the pad is mapped. Losing focus, leaving the workspace, unplugging, simulator errors or reaching bounds requires explicitly enabling again. Releasing hold stops new steps; a submitted step can finish. This mode controls the simulator only, with no pump, rotary or physical commands.

No new dependencies: the native Gamepad API works in supported Electron/browser environments. Check controller/OS compatibility locally; software tests use synthetic input. Run `npm run test:joypad` for the sandboxed Electron integration checks (graphical environment required). See [GitHub findings and integration decisions](docs/joypad-research.md).

## SVG placement

After **Import SVG**, use **SVG placement** to set X/Y offsets relative to the work origin and rotation (−180…180°, positive counterclockwise). **Design size** scales the SVG with its proportions preserved. Placement affects preview, saved projects, bounds validation and G-code; text boxes retain their own positions. **Remove SVG** removes only the artwork, keeping your text. Replacing the SVG resets its offsets and rotation. One imported SVG is supported per layout.

## Curved working area

The Draw grid shows the **theoretical pen reach** between an inner and outer curve: blue is inside, amber outside. Change **Work origin → Pen Z** to update it, or uncheck **Show theoretical pen reach**. Radii are measured from the fixed robot base at X0/Y0; moving the project origin does not move the reach area. The wider grid shows X −220…220 and Y 130…430 mm; reach is clipped to this view. A dashed rectangle marks the unchanged simulator limits (X −150…150, Y 180…380 mm).

The model uses the original [Rotrics Studio reach table](https://github.com/Rotrics-Dev/rotrics-studio-app/blob/447b97afb405ab046c9142c4f6f9d6edd6036e6a/web/src/utils/workAreaUtils.js), pen offset (101.5 + 12.5 mm), and 2 mm boundary margin. We interpolate between its 2 mm height samples for smooth updates. Source attribution and MIT license are in `assets/notices/rotrics-studio.txt`. This assumes robot-coordinate Z and the standard pen mounting; offsets from G92, custom tools, leveling, collisions, and pen-up travel are not modeled. It is a visual guide, not a hardware safety check. Simulator rectangular limits and G-code validation remain separate.

## Writing and pen fonts

Click **Import font…** in Draw and choose a local **TTF or OTF** file (up to 2 MB). Run `npm ci` first, including for browser use. Conversion runs locally in a worker with progress and cancellation; completed paths remain available if conversion is cancelled or times out. Select the imported face from the font menu for other text boxes. Up to four faces can be loaded per project. The imported face retains its actual weight and italic style; import another face file for a different style.

Both Outline and approximate Centerline are available. Coverage is printable ASCII; unavailable glyphs are reported. Centerline conversion can fail for complex decorative shapes; use Outline or another face for those characters. The import details show failures and any embedded license notice. Your original font file is not copied into the repository or saved project.

Choose **Draw → Insert text**, type your text, then adjust its font, style, letter height, spacing, and left/center/right multiline alignment. Press Enter for a new line. Insert more boxes and position each independently. The canvas updates as valid text is entered. Delete the selected text with **Delete text**; an empty layout can be saved but cannot generate G-code.

Choose **Pen path → Outline / Centerline** in the right-hand drawing menu. Each option has a tooltip and an illustrative T; the main canvas shows the actual generated paths. The selection also controls the compiled commands and is saved with your project.

**DejaVu Sans** and **DejaVu Serif** offer both modes using bundled, precomputed paths. Outline traces letter borders; Centerline follows their approximate middle. New text defaults to DejaVu Sans centerline. Three **Hershey** fonts (Sans, Serif, Script) remain available as stroke fonts; Outline is disabled for these because they contain no filled letter outlines. Everything works offline. See [font provenance](assets/fonts/README.md).

**Font style** offers Regular, Bold, Italic, and Bold italic for DejaVu using actual font variants. Hershey has a fixed regular stroke style. Centerline follows the selected variant but cannot change the physical pen thickness. Some converted centerline glyphs are unavailable in each style (for example regular Serif `#`, `:`, `;`, and italic Sans `A`); the editor reports these explicitly and never substitutes outlines. Choose another style/font or Outline. See the complete table in [font provenance](assets/fonts/README.md). Converted serifs may use several strokes.

- Letter height is the nominal capital height in millimeters (2–40 mm). Descenders and decorative strokes can extend beyond it. Writing uses its own letter height; the SVG Design size control is shown only when SVG artwork is present.
- Letter spacing adds 0–10 mm between glyph advances. Line spacing sets baseline distance to 1–3 times the letter height. Multiline alignment is relative to the longest logical line.
- Each logical text block is centered on its own X/Y offset from the work origin. Spaces and blank lines affect layout. Every pen stroke uses the project contact Z and configured pen lift (10 mm by default).
- Supported input: English uppercase/lowercase letters, digits, ASCII punctuation, spaces, and line breaks. Maximum 20 text boxes, each up to 160 characters and 8 lines, subject to the combined 200-stroke/2,000-point job limit (including SVG). Unsupported characters are reported explicitly; they are never silently dropped. Shorten text, lower the height, or choose a simpler font when validation reports a limit.
- Invalid edits leave the last valid canvas visible, show an inline explanation, and require successful G-code generation before Send is enabled. Text must also fit the illustrative workspace, including pen-up clearance.
- Saving retains each box’s editable text, font, style, path mode, position, size, spacing, and alignment. Text boxes can share the layout with one imported SVG. Imported font geometry is saved once in the project, so reopening it on another machine needs no font installation. Set **Rotation** (−180…180°) to turn a box around its center; positive angles turn counterclockwise. **Duplicate** adds an independently editable copy at the same position; drag it or change its X/Y offsets. Rotated paths are used for preview, bounds validation, saved projects and generated G-code.

Writing execution remains simulated. USB diagnostics cannot send writing or other motion commands to a physical robot.

An optional [custom-font centerline experiment](docs/experiments/centerline/README.md) tests ordinary outline fonts with OpenType.js and flo-mat. It produces centerline SVGs and validated simulator projects. The app also supports direct font imports; the report includes comparison images, measured results, and limitations.

## G-code workspace

Choose **G-code** to open a `.gcode`/`.nc`/`.txt` file or paste commands, then **Review G-code**. Review shows the XY path, full XYZ bounds, distance and ideal path time, and makes normalized commands available below the canvas and for download. Connect/home before **Send to simulator**. Editing source invalidates the review.

Supported: G21, G90/G91, G0/G1 XYZ/F, G4 P/S (up to 2 seconds), and M400; comments are accepted. Declare millimeters and absolute positioning before motion. An initial Z lift is supported; the first XY move must establish X/Y and a known Z. Maximum 256 KB / 5,000 commands; speeds remain 60–3,000 mm/min. Source coordinates are independent of the drawing origin.

Unsupported commands fail with line numbers. This does not import general 3D-printing/laser files: heating, extrusion, laser, arcs, home, origin resets and accessory commands are rejected. G0 is shown as dashed source travel and normalized to G1 for simulation. Top view omits Z movement and the initial approach; path-time estimates exclude that approach and acceleration and are not simulator completion estimates.

## Teach & Play

Choose **Teach & Play**. Add moves while offline, or connect/home and **Record simulator position**. Jogging and direct **Move simulator to XYZ** are available in this workspace and in Control. Each move has a name, absolute XYZ coordinates and speed. Add waits or select Suction cup/Soft gripper to add tool actions. Reorder/delete steps, set repeats, then **Generate sequence G-code**, review and **Play in simulator**.

**Save sequence / Open sequence** round-trip editable `.teach.json` files; **Download sequence G-code** exports compiled commands separately. Any edit requires regeneration. Suction/gripper action mappings and cleanup are simulated; the displayed pump state is not a physical sensor reading. Moves go directly between points—add explicit lift points for clearance. Physical hand guidance is not enabled.

Limits: 100 steps, 20 repeats, 0–2,000 ms per wait and 120 seconds of total repeated waits. Empty sequences can be saved; generation requires a move. Drawings, reviewed imports and sequences share the same job lock, pause/resume and stop behavior.

Drawing setup also provides separate **Work speed**, **Travel speed** and **Pen lift** controls. Pen lift is 1–30 mm and is included in bounds checks; XY travel and work speeds are 60–3,000 mm/min. Defaults preserve existing projects' output. Vertical lifts remain 600 mm/min. Control adds a configurable jog/move speed and explicit XYZ targets.

See the [legacy feature comparison and next milestones](docs/feature-parity.md) for the remaining laser, Scratch, accessory, firmware and physical-execution gaps; 3D printing is intentionally out of scope.

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

Tests use Node's built-in test runner, without third-party test dependencies. They cover serial message framing, command ordering, timeouts, disconnects, acknowledgement matching, job pause/resume/stop, homing prerequisites, decimal jogging, project validation, pen-up bounds, SVG path parsing, transforms, curve flattening, text layout/font coverage, editable writing projects, multi-text layouts and legacy migration, actual font styles, complete-layout compilation, motion settings, G-code parsing and canonicalization, sequence generation/playback, and USB diagnostics with fake ports. IPC tests verify sender/frame authorization and the exact query whitelist. Tests never open a physical serial port. Individual test files can also be run directly, e.g. `node tests/writing.test.js`.

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
src/core/gcode.js       Reviewed XYZ G-code import and modal-state normalization
src/core/teach.js       Named sequence validation, repeat and tool-action compilation
src/core/writing.js     Stroke-font lettering, multiline layout and validation
src/core/font-data.js   Three bundled Hershey stroke fonts
src/core/paired-font-data.js  DejaVu outline and centerline glyphs
src/core/custom-font.js Validated portable custom font geometry
src/core/font-converter.js  OpenType outline and MAT centerline conversion
src/renderer/font-worker.js  Cancellable background font conversion
src/renderer/          Native HTML/CSS/JavaScript interface and SVG preview
scripts/serve.js        Dependency-free browser development server
scripts/check-svg.cjs   Native XML importer check runner
tests/                 Protocol, controller, and project tests
assets/examples/       Example SVG artwork
assets/fonts/          Font source and licensing notes
docs/                  Research and product roadmap
```

The interface uses standard browser modules and native controls. Electron and SerialPort support desktop operation; OpenType.js and flo-mat support local custom font conversion. There is no framework build step, server deployment, cloud service, telemetry, or account requirement. The simulator runs inside the renderer; physical serial access stays in the main process behind a narrowly validated IPC interface.

## Current boundaries

- SVG import supports the subset described above. G-code import is limited to the reviewed XYZ subset above. Teach playback is simulated. 3D printing is intentionally excluded from the product scope. Laser, Scratch and firmware updates are not implemented.
- Workspace bounds (`X −150…150`, `Y 180…380`, `Z −20…100`) are illustrative simulator limits, **not validated DexArm limits**. Projects must fit both the drawing and its configured pen lift inside them.
- Simulator acknowledgements follow simulated completion. Real firmware can buffer motion; pause, cancellation, `M400`, command deadlines, and output shutdown need hardware verification before enabling physical commands.
- Stop is a simulator cancellation action, not a physical emergency stop. No claim is made about laser safety, collision avoidance, calibration, or hardware accuracy.
- Projects are versioned JSON capped at 4 MB on import and export. Imported settings and artwork are validated, unknown fields are discarded, and files are never executed.
- This is an independent prototype; official branding, old project compatibility, and reuse of upstream assets have not been established.

The next milestone is validating diagnostic transcripts and a capability matrix for a specific arm/firmware/OS before enabling physical motion. USB behavior has been tested with fake ports and native binding enumeration, not an actual DexArm. See [research and delivery plan](docs/studio-research-and-plan.md).
