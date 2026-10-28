# DexArm Studio: research and product plan

Research date: 24 October 2026. This document separates published facts from proposed design and hardware questions. No robot was connected or tested.

## Recommendation

Build a fresh, offline desktop application for one DexArm connected over USB. Preserve compatibility with stock firmware. Deliver a trustworthy control panel and an SVG-to-pen-drawing workflow before expanding to teach-and-play and laser engraving. 3D printing is explicitly excluded from the current and foreseeable scope.

Assumptions: the first audience is an individual maker or small lab; one operator controls one arm; desktop operating systems matter more than mobile; a physical arm will be available for validation. The first release OS should follow the actual development machine and robot access. Supporting Windows, macOS, and Linux is a product objective, not a tested claim.

Success means a new user can connect, understand the installed tool and coordinate system, prepare a small drawing, preview its travel, execute it, and recover clearly from an interrupted connection.

## Published findings

| Finding | Product implication | Source |
| --- | --- | --- |
| Studio already covers basic control, drawing, engraving, printing, Scratch, and teach-and-play. | Keep non-printing use cases in the roadmap; 3D printing is intentionally out of scope. Improve the shared preparation and execution experience. | [Studio manual](https://manual.rotrics.com/product-overview/software-rotrics-studio) |
| The download page lists Studio 1.0.4 and firmware 2.3.5, dated 29 March 2022. | These are published download entries, not proof that every device runs that firmware or that development has stopped. | [Downloads](https://rotrics.com/pages/downloads) |
| The public Studio repository has electron, server, and web projects; its README requires Python 2.7 and separately linked Scratch repositories. It is MIT licensed. | Use it as a behavior reference; inspect reusable algorithms and assets individually before carrying them into a new application. | [Studio source](https://github.com/Rotrics-Dev/rotrics-studio-app) |
| DexArm exposes Marlin-compatible ASCII G-code over serial: 115200 baud, 8 data bits, one stop bit, no parity or flow control. The API describes waiting for `ok`. | A single serialized command scheduler should own the connection. | [DexArm API](https://github.com/Rotrics-Dev/DexArm_API) |
| Published specifications include up to four degrees of freedom, 0.05 mm repeatability, 500 g maximum payload, 380 mm reach in the pneumatic section, and irregular work areas. | Model tool and accessory capabilities explicitly; validate the working envelope rather than displaying a universally usable rectangle. Repeatability is not absolute positioning accuracy. | [Specifications](https://rotrics.com/pages/dexarm-spec) |
| Official pages disagree on some printing dimensions. | Do not hardcode a marketing build volume as a safe motion boundary. | [Specifications](https://rotrics.com/pages/dexarm-spec), [Product page](https://rotrics.com/products/dexarm) |
| The setup guide specifies USB-A-to-C for the computer; dual-C cables are used for accessories. | Show a device-specific illustrated connection guide and verify the actual hardware revision. | [Quick start](https://manual.rotrics.com/get-start/quick-start-guide) |
| Official troubleshooting includes connection, limits, accuracy, and application errors. | Prioritize actionable diagnostics; these topics establish support needs, not measured failure rates. | [Knowledge base](https://rotrics.com/pages/knowledgebase) |

The specifications advertise Wi-Fi, but this research did not establish a supported network-control protocol or its availability across devices. USB is the initial transport.

## Protocol and hardware constraints

The official Python implementation uses `M1112` for home, `M114` for position reporting, `G92` for work origin, and `M888` for tool configuration. Tool selections are pen P0, laser P1, pneumatic P2, and printer P3. Treat the returned tool setting as configuration, not proof of which attachment is physically mounted. Its movement helper rounds coordinates to whole millimeters, and its serial read can wait indefinitely; a new controller should preserve decimal precision and apply command-specific deadlines. [Python implementation](https://raw.githubusercontent.com/Rotrics-Dev/DexArm_API/master/pydexarm/pydexarm.py)

Separate “sent,” “acknowledged,” and “finished.” General Marlin provides `M400` to wait for planner completion; verify that behavior on each supported DexArm firmware before using it as the completion barrier. Likewise, position reports must not be presented as independent physical tracking without validating what they represent. [Marlin M400](https://marlinfw.org/docs/gcode/M400.html)

Do not implement pause as merely stopping serial transmission and claiming the robot has stopped: buffered motion may remain. Validate pause, abort, output shutdown, and recovery separately. General Marlin documents `M112` as a control shutdown whose response can depend on queue handling and the emergency parser; it is explicitly not a safety-rated emergency stop. DexArm support and configuration require verification. A UI button cannot guarantee shutdown after a cable disconnect or application crash. [Marlin M112](https://marlinfw.org/docs/gcode/M112.html)

The manufacturer identifies the laser as Class 4. Release laser execution only after verifying the actual enclosure, interlock behavior, output-off behavior, and appropriate operating procedure. A software confirmation is not a physical interlock. [Laser specifications](https://rotrics.com/pages/dexarm-spec)

## Proposed interface

Use one persistent workspace with task-specific tools. Start with a light neutral canvas, restrained blue action color, amber warnings, and red reserved for stop/fault actions. Support a dark theme later if users need it. Use readable text, visible units, labeled icons, strong focus indicators, and status text alongside color.

```text
+------------------------------------------------------------------+
| DexArm Studio   Project name    USB: Connected   Pen   [Stop]      |
+------------+-------------------------------------+---------------+
| Projects   | Prepare  >  Preview  >  Run          | Device        |
| Control    |                                     | Homed: Yes    |
| Draw       |       Scaled XY workspace           | Work origin   |
| Teach*     |       Reachable region              | XYZ / units   |
| Laser*     |       Artwork + travel paths        | Jog controls  |
|            |       Origin + tool footprint       | Tool settings |
| Settings   |                                     | [Preview job] |
+------------+-------------------------------------+---------------+
| Job state / progress / warnings                 [Activity drawer] |
+------------------------------------------------------------------+
* Later releases; omit unavailable tasks from the first release.
```

The central interaction is **Prepare → Preview → Run**:

1. **Connect:** choose a port; show device identity when verifiable; explain missing drivers, occupied ports, permissions, and cable problems. Connecting never initiates motion.
2. **Prepare:** confirm attachment, home explicitly with the area clear, set work origin and pen contact height, and import artwork.
3. **Preview:** display dimensions in millimeters, pen-down paths, pen-up travel, start/end points, and unreachable segments. Offer a deliberate dry run above the surface after validating clearance.
4. **Run:** show current job state, elapsed time, estimated remaining time, and separately identified sent/confirmed progress. Lock conflicting controls.
5. **Recover:** state what is known and unknown; retain the project and diagnostic log. Reconnection does not resume a job automatically.

Persistent device controls should show connection, initialization status, tool configuration, machine/work coordinates, and telemetry age. Jogging starts with conservative speed and discrete steps; keyboard motion works only when the control panel has focus and no text field is active. A homing action must be visually distinct from setting work zero.

For teaching, begin with a readable sequence: move, grip/release, wait, repeat. Record named points deliberately; add physical hand-guiding only after motor-release and position-recapture behavior is established. Pneumatic actions should say “Grip” or “Release” for the chosen attachment rather than expose ambiguous pump direction.

The best differentiators are a setup assistant that explains why Run is unavailable, honest previews, recoverable projects, and diagnostics that identify the next useful action. A decorative 3D robot view is lower priority than an accurate 2D workspace. Any later simulation must disclose that it does not guarantee collision avoidance.

## Technical proposal

Use Electron with TypeScript and a small component UI, provisionally React. Keep serial I/O, job execution, and file access outside the renderer. Use narrow, validated IPC commands. No cloud account or separately deployed server is needed for the first version. Adopt a current supported Electron release, context isolation, sandboxing, disabled renderer Node integration, a restrictive content policy, and packaged local content. [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security)

Before locking this choice, package a tiny serial proof of concept on the initial target OS. Alternatives: Tauri if the team already knows Rust and accepts its serial integration work; Web Serial for a browser demo with explicitly limited browser support. The web platform currently marks Web Serial as limited availability and requires a secure context. [Web Serial documentation](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API)

Keep implementation in one repository and a few directories: `src/main/` for desktop/device access, `src/protocol/` for parsing and scheduling, `src/jobs/` for preparation/validation, `src/renderer/` for UI, and `tests/` for protocol transcripts and job fixtures. Do not build a plugin framework or a multi-robot service.

The controller needs explicit states: disconnected, connected/uninitialized, ready, running, pausing, paused, stopping, and faulted. Unknown physical state is explicit after errors. All command producers, including diagnostics and the console, use the same scheduler; raw commands cannot bypass job ownership.

Start with one command awaiting acknowledgement at a time, bounded queues, fragmented-line parsing, command-specific timeouts, and a retained transcript. Never blindly resend a movement after a timeout: it may have executed. Polling must share the scheduler without starving control requests. Evaluate throughput with real dense SVG jobs before optimizing buffering.

Projects should initially be versioned local JSON containing artwork, placement, tool settings, work coordinates, and generated-job metadata. Save atomically. Keep firmware calibration distinct from project offsets and avoid repeated persistent firmware writes. Parse imported SVG as untrusted content, suppress external resources/scripts, and define the supported SVG subset. Imported G-code requires modal-state tracking, tool compatibility checks, and rejection of unsupported commands; an incomplete bounding-box parser must not claim safety.

3D printing, including print inspection, external-slicer workflows, and embedded slicing, is intentionally out of scope. For blocks, evaluate contemporary Blockly before importing the old Scratch forks. Reusing algorithms or distributing firmware requires separate license and dependency review; the firmware repository declares GPL-3.0. [Firmware source](https://github.com/Rotrics-Dev/Marlin_For_DexArm)

## Delivery plan and acceptance gates

Illustrative effort: roughly 8–12 engineer-weeks for an MVP, assuming one experienced developer, one accessible arm, stock firmware, one initial OS, and no firmware modifications. This is a planning estimate, not a commitment; revise it after the hardware investigation. Laser release work is additional; 3D printing is excluded.

| Stage | Work | Exit condition |
| --- | --- | --- |
| 1. Hardware discovery; 1–2 weeks | Inventory firmware, tools, USB identity, coordinate behavior, acknowledgements, completion barriers, stop semantics, and limits. Observe original Studio on the same arm. | Written capability matrix and reproducible serial transcripts; no unverified stop promises. |
| 2. Controller foundation; 2–3 weeks | Connection UI, scheduler, parser, state machine, home, conservative jog, position display, error logs, protocol simulator. | Timeout/unplug/reconnect tests show no duplicate motion or automatic restart; conflicting commands are blocked. |
| 3. Drawing workflow; 2–3 weeks | Supported SVG subset, scale/place, pen height, toolpath generation, travel preview, project save/load, streaming. | A reference SVG draws at the requested dimensions within an agreed measured tolerance; job completion waits for verified completion semantics. |
| 4. Release hardening; 2–3 weeks | Usability sessions, installer, device diagnostics, accessibility, recovery messaging, regression runs. | Five representative users attempt connect-to-draw; document completion rate and obstacles. Publish initial OS and firmware compatibility explicitly. |
| 5. Extensions; separately estimated | Pneumatic teaching, laser with verified safeguards, then blocks and accessories. 3D printing is excluded. | Each module passes its own physical acceptance checks before enabling execution. |

Essential automated checks: split/coalesced serial messages, acknowledgements mixed with telemetry, command timeout after possible execution, disconnect during a job, modal coordinate handling, unsupported G-code, SVG transforms, and invalid/out-of-envelope paths. Essential hardware checks: home and work-zero distinction, tool offsets, path clearance, boundary approach, actual pause/abort latency with queued motion, UI crash, cable removal, and power-cycle recovery. Run hazardous-tool tests only under the verified physical setup.

## Decisions to settle before implementation

- Which exact DexArm, firmware, tools, and accessories are available?
- Which OS is the first supported release, and who are the first five users?
- Is drawing the primary job, or should pneumatic teaching take its place?
- Is existing project-file compatibility required? Research did not establish its format.
- Will this be an independent community application or an officially branded successor? Confirm naming and asset permissions before public distribution.

Deferred: Scratch migration, camera alignment, Wi-Fi control, conveyor/rail coordination, remote operation, cloud sync, plugin marketplace, and AI-generated motion. These do not improve the first connect-to-draw acceptance gate enough to justify their initial cost.

Limits: this is a documentation/source review, not a complete audit of the old app. Some package/source pages could not be fetched; exact legacy dependency versions and current OS installer behavior remain unverified. No implementation or hardware qualification has been performed.
