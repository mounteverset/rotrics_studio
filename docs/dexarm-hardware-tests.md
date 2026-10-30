# DexArm hardware test ledger

Last updated: 30 October 2026. **No DexArm is currently connected. All hardware checks below are pending.**

This is the running list for commissioning physical control and checking future changes. Add tests here whenever a feature affects robot motion, coordinates, tools or recovery. Keep IDs stable and append run records; do not treat a simulator or unit-test pass as a hardware pass. 3D printing is out of scope.

Physical USB pen control is implemented and tested against fake serial devices. Motion-dependent tests below are still pending commissioning on a real DexArm. Start with the pen attachment, clear space and raised low-speed motion; an operator must be able to remove power independently of the app. This document is a test plan, not authorization for unattended motion or hazardous-tool output.

## Record before the first run

- Robot model/revision and serial identifier (keep identifiers out of public reports if needed):
- Firmware version and full M115 response:
- Computer OS/version, Studio commit and connection method:
- USB port/driver/cable:
- Attachment, pen mounting/protrusion, paper/surface and measured contact height:
- Leveling/calibration settings and any coordinate offsets:
- Controller model, USB/Bluetooth connection and OS mapping, for Joypad runs:
- Agreed dimensional tolerance, maximum test speed, acceptable stop distance/latency and measurement method:
- Operator and date:

## Transport and initialization

| Done | ID | Test | Evidence / pass condition |
| --- | --- | --- | --- |
| [ ] | HW-01 | Discover and identify the robot without moving it | Correct USB device/port, firmware response and diagnostics; connection alone produces no motion or output. |
| [ ] | HW-02 | Serial framing and acknowledgements | Capture fragmented/coalesced replies and telemetry mixed with acknowledgements; no command is accidentally skipped or acknowledged twice. |
| [ ] | HW-03 | Acknowledged versus completed motion | Measure whether `ok` precedes motion completion and whether M400 waits for completion; document position-report semantics. |
| [ ] | HW-04 | Home from representative valid starting positions | Correct homing command for this firmware, observed trajectory, final coordinates and repeatability; no automatic home on connect. |
| [ ] | HW-05 | Coordinate directions and units | Small isolated X/Y/Z moves match intended directions and measured millimetres. Verify decimals, feed-rate units and machine/work-coordinate distinction. |
| [ ] | HW-06 | Work origin versus firmware zero | Setting a project origin must not silently change persistent calibration or firmware coordinate offsets. Record behavior after restart. |

## Pen setup and motion envelope

| Done | ID | Test | Evidence / pass condition |
| --- | --- | --- | --- |
| [ ] | HW-07 | Pen contact and mounting | Establish actual contact height and attachment offsets; repeat after remounting. Pen is correctly seated and does not press excessively. |
| [ ] | HW-08 | Pen lift and travel clearance | Configured lift clears paper/fixtures at all tested locations; no ink during travel. Verify contact and raised Z, including near height limits. |
| [ ] | HW-09 | Height-dependent reachable area | Compare conservative measured points at several working heights with the original-Studio theoretical inner/outer curves. Record discrepancies; do not probe hard stops. |
| [ ] | HW-10 | Bounds and tool-offset rejection | Out-of-range drawing, rotated/scaled artwork and raised travel targets are rejected before any part of the job executes. Include inner-radius exclusions. |
| [ ] | HW-11 | Surface flatness and leveling | Plot/check contact at center and corners; document whether leveling is needed and how firmware compensation affects coordinates. |
| [ ] | HW-12 | Speed/acceleration qualification | Start low and increase within a measured, agreed envelope. Check missed steps, vibration, accuracy and payload effects. App limits are not evidence of hardware capability. |

## Drawing workflow and output quality

| Done | ID | Test | Evidence / pass condition |
| --- | --- | --- | --- |
| [ ] | HW-13 | Raised boundary preview | Entire bounding rectangle stays at pen-up Z, matches layout dimensions/position and fits the physical setup; no contact-height command or unintended ink. |
| [ ] | HW-14 | Reference dimensional drawing | Measure a known rectangle, diagonal and circle; compare position, dimensions, closure and repeatability against the agreed tolerance. |
| [ ] | HW-15 | SVG transforms and multiple objects | Verify independent width/height, locked scaling, rotation, both mirrors, several objects and group placement on paper. Compare with exported G-code. |
| [ ] | HW-16 | Lettering and custom fonts | Plot bundled and imported-font outlines/centerlines, several text boxes, styles, rotations and alignment. Inspect missing strokes, loops, pen lifts and legibility. |
| [ ] | HW-17 | Hatching and holes | Plot closed shapes with holes at several spacings/angles; holes remain empty and travel is raised. Inspect line density and duplicate/boundary strokes. |
| [ ] | HW-18 | Path optimization equivalence | Compare optimized/unoptimized drawings: same ink geometry, shorter or equal intended XY travel, no connections between independent strokes. |
| [ ] | HW-19 | Paper guides and registration | Physical paper, margin and origin placement match guides. Out-of-margin warnings are useful; guides never imply expanded robot reach. |
| [ ] | HW-20 | Save/reopen/recovery repeatability | Saved v3 and upgraded v1/v2 layouts reproduce the same physical geometry, including embedded fonts, transforms and planning settings. Restoring a layout never starts motion. |
| [ ] | HW-21 | Dense/long drawing and progress | Exercise representative near-limit files. Measure throughput, actual duration, command buffering, temperature and drift. Progress/completion must not imply finished motion prematurely. |

## Joypad and manual control

| Done | ID | Test | Evidence / pass condition |
| --- | --- | --- | --- |
| [ ] | HW-22 | Gamepad mapping on target OS | Check XY/Z directions, neutral drift, dead zone, device identity and standard mapping on the intended USB/Bluetooth controller. Unsupported mappings must not drive the arm. |
| [ ] | HW-23 | Neutral enable and hold-to-move | Connecting/enabling alone causes no movement. Deflected sticks or held enable/disable controls prevent arming. Releasing RB/R1 prevents further steps; measure remaining motion. |
| [ ] | HW-24 | Percentage, configurable maximum and fine mode | Measure normal/fine motion at 10%, intermediate and 100%. Verify maximum clamping and mm/min↔mm/s display; changes apply only to subsequent steps. |
| [ ] | HW-25 | Joypad disarm paths | B/Circle, Escape, Disable, mode change, window blur/hide, pad unplug and pad replacement disarm. Reconnect/focus return never automatically resumes. Measure latency/distance for each path. |
| [ ] | HW-26 | Exclusive motion ownership | Drawing, manual jogging, homing, Joypad and Teach cannot queue conflicting moves. No stale input is replayed after a busy period or error. |

## Stop, faults and recovery

| Done | ID | Test | Evidence / pass condition |
| --- | --- | --- | --- |
| [ ] | HW-27 | Pause/resume with firmware buffering | Measure response with queued motion; after pause, the app accurately distinguishes requested pause from actual stopped motion. Resume must preserve the intended path. |
| [ ] | HW-28 | Stop and independent power removal | Measure actual stop behavior/latency and any buffered remainder. Verify output state and required re-home/recovery. A software stop must not be described as a physical emergency stop. |
| [ ] | HW-29 | USB loss, application failure and power cycle | Controlled tests of cable loss, app termination and robot reboot: no automatic resume/replay, unknown physical state reported honestly, deliberate re-initialization required. |
| [ ] | HW-30 | Timeout, firmware error and partial job | Use controlled fault injection; no blind resend of a potentially executed move. Preserve the project and transcript, show what is uncertain, and require deliberate recovery. |

## Other supported workflows, when their hardware is available

| Done | ID | Test | Evidence / pass condition |
| --- | --- | --- | --- |
| [ ] | HW-31 | Reviewed G-code playback | Supported modal XYZ files match the checked canonical path; unsupported source fails before motion. Verify initial approach and clearance separately. |
| [ ] | HW-32 | Teach & Play physical waypoints | Recorded coordinates, direct moves, explicit clearance, waits and repetitions match intended behavior. Physical hand-guiding remains unavailable until separately implemented/verified. |
| [ ] | HW-33 | Pneumatic attachment semantics | Only with the appropriate attachment: verify pick/release/neutral/off, startup/finish behavior and response to faults; pump state must not be presented as a physical grip sensor. |

## USB-control commissioning additions (30 October 2026)

These tests specifically accept the newly implemented desktop USB controls. All remain **not run**. Use the setup record above and append measured results below; fake-port tests do not satisfy these entries.

| Done | ID | Test | Evidence / pass condition |
| --- | --- | --- | --- |
| [ ] | HW-34 | Desktop connection and identity gates | Refresh/select the intended port; connect sends no commands, home/jog/run remain locked until firmware is read and home completed. Check that simulator controls cannot move the physical robot. Verify header connection/Home/Send/Pause/Stop persist across workspaces, settings open/close/Escape send no motion, and the physical Stop stays accessible while settings are open. |
| [ ] | HW-35 | Home command/completion/report sequence | Capture M1112 → M400 → M114 on actual firmware. Verify completion and reported XYZ before controls unlock. A missing report, fault or disconnect must keep motion locked. Never reset encoder calibration as part of this test. |
| [ ] | HW-36 | Discrete physical jog and absolute XYZ | Test each axis ±1 mm first, then 5/10 mm within clear space, at measured low feed. Verify units, polarity, modal G21/G90 reset, completion barrier and refreshed coordinates. Check step/speed/bounds rejection sends nothing. |
| [ ] | HW-37 | Drawing send from generated snapshot | Generate a small raised/pen test, send via the header USB control without changing modes and compare transcript, geometry and dimensions. Editing invalidates the old generation. Confirm no pump, laser or printer commands are emitted. |
| [ ] | HW-38 | Reviewed G-code send and initial approach | Use supported XYZ/G4 input. Compare canonical commands and physical approach/clearance. Invalid source, excessive speed or any out-of-bounds/reach segment must reject the entire job before motion. |
| [ ] | HW-39 | Full-path reach validation at height | Check paths near inner/outer theoretical pen boundaries at multiple Z values, including Z-only lift, straight segment interiors and the approach from actual reported position. Keep all probes within a previously measured safe area; record model discrepancies. |
| [ ] | HW-40 | Acknowledgement count versus physical completion | Capture command acknowledgements and motion timing; final M400 must finish before completion is shown, followed by M114 refresh. Confirm whether reports represent measured/commanded position. Missing reports must lock further motion. |
| [ ] | HW-41 | Pause barrier/resume ownership | Pause during motion: observe requested → M400 draining → paused, and measure drift/latency. No next job motion after barrier until explicit Resume. Query, home, jog and competing jobs must be rejected while busy. Repeat pause then disconnect/stop; no blocked job or automatic resume. |
| [ ] | HW-42 | Quick-stop under outstanding acknowledgement | In a clear low-speed test, press USB Stop during a held/slow acknowledgement and while paused/homing. Verify M410 reaches firmware promptly without waiting for the active acknowledgement, measure physical stopping time/distance and buffered remainder. UI must discard job, clear home and require reconnect/home; no automatic continuation. |
| [ ] | HW-43 | USB timeout/error/unplug and application closure | Controlled failures during home, jog, running and paused job: no automatic retries/replay, unknown position/home cleared and deliberate reconnection required. Check firmware behavior after window/app closure; disconnect alone is not a stop or output-off claim. |
| [ ] | HW-44 | Reports, deadlines and OS qualification | Export transcript with firmware/OS/port and measured response times. Qualify the 5 s diagnostics/120 s motion deadlines on intended jobs, serial drivers and target OS. A deadline failure must fault without replay. Check startup chatter/reset behavior on opening the real port. |

Laser, rotary, rail and conveyor hardware acceptance must receive additional test IDs before those features are implemented/enabled. No laser-output or printing tests are included in this batch.

## Run records

Copy this block for each test or related group. Keep failed runs and reruns rather than replacing their history.

```text
Run ID / date:
Test IDs:
Studio commit / OS / firmware / attachment:
Setup, commanded positions, speeds, pen lift and offsets:
Expected result / agreed tolerance:
Measured result (distance, dimensions, time, stop latency, etc.):
Status: NOT RUN | PASS | FAIL | BLOCKED
Transcript / project / photo or video evidence path:
Issue or follow-up:
Operator:
```

Only check Done after a recorded pass on the identified hardware/firmware. If firmware, attachment, coordinate setup or motion scheduling changes, list affected test IDs for rerun. Current software-only checks (`npm test`, `test:svg`, `test:drawing`, `test:joypad`) are regression evidence, not completed entries in this ledger.
