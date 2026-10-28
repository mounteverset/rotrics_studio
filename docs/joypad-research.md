# Joypad control research and implementation

Reviewed 28 October 2026. 3D printing remains out of scope.

## GitHub findings

- [Cilyan/bragauche](https://github.com/Cilyan/bragauche), inspected at [ce0223496bea1cc1dcaeadd457d809ca92113b86](https://github.com/Cilyan/bragauche/tree/ce0223496bea1cc1dcaeadd457d809ca92113b86): Python/Pygame controller application, documented as Xbox-oriented and tested on Linux. Its README describes XYZ, rotation and pneumatic buttons. The actual [controller code](https://github.com/Cilyan/bragauche/blob/ce0223496bea1cc1dcaeadd457d809ca92113b86/bragauche/controller.py) maps horizontal left stick to X, inverted vertical left stick to Y, inverted axis 4 to Z, axis 3 to rotation, and A/Y/B to pump actions. A 0.6 threshold produces discrete directions; the loop targets 20 Hz. Axis indices are platform-specific. The [serial wrapper](https://github.com/Cilyan/bragauche/blob/ce0223496bea1cc1dcaeadd457d809ca92113b86/bragauche/dexarmserial.py) sends G0 XYZ at F10000 followed by M400, and uses M888 P6 / M2100 / M2101 for rotary setup/movement. It initializes and moves the arm when opening the port. Those defaults and startup behavior are unsuitable for this app's current simulator/read-only USB architecture.
- Rotrics' official firmware contains [dexarm_gamepad.cpp](https://github.com/Rotrics-Dev/Marlin_For_DexArm/blob/DexArm_Dev/Marlin/src/module/dexarm/dexarm_gamepad.cpp) and [dexarm_gamepad.h](https://github.com/Rotrics-Dev/Marlin_For_DexArm/blob/DexArm_Dev/Marlin/src/module/dexarm/dexarm_gamepad.h): device-side status-driven Cartesian, rail and joint stepping. Cartesian logic limits planned moves and checks a forward offset against its height-dependent envelope. This is firmware functionality, not a desktop USB gamepad driver; its presence does not establish a compatible host protocol or behavior on the user's installed firmware.
- Browser/Electron [Gamepad API](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API/Using_the_Gamepad_API): exposes connected pads, current axes/buttons and a `standard` mapping. The user may need to press a controller button while the window is focused before it appears. Device/OS mappings vary, so arbitrary axis indices are not portable.

These projects were used as references. No upstream Python or firmware implementation was copied, and no Python, Pygame or controller dependency was added.

## Integrated mode

**Joypad** is a dedicated workspace alongside Draw, Control, G-code and Teach & Play. It uses the platform Gamepad API and the existing controller's acknowledged, validated `moveTo` path. It does not open another serial port or bypass the job scheduler.

| Input (standard mapping) | Behavior |
| --- | --- |
| Left horizontal / vertical | X / Y; pushing up increases Y |
| Right vertical | Z; pushing up increases Z |
| RB / R1 (button 5) | Hold to issue movement steps |
| LB / L1 (button 4) | Fine movement while held |
| B / Circle (button 1), Escape, Disable button | Disarm joypad |

At the default 600 mm/min maximum and 100% speed, normal steps have at most 1 mm total displacement; fine steps at most 0.2 mm, at F600. The configurable maximum is clamped to 600–3,000 mm/min in both UI and motion logic; 100% means that selected maximum, not the robot’s hardware maximum. The lower bound preserves the controller’s F60 minimum at 10%. Step displacement scales with the selected maximum, reaching at most 5 mm normal / 1 mm fine at 3,000 mm/min and 100%. The 10–100% Speed slider scales both step displacement and feed rate, down to 0.1/0.02 mm and F60 at 10%. Changes affect the next submitted step; the default preserves the existing 100% behavior. A 20% per-axis dead zone is rescaled proportionally; diagonal input is normalized. Inputs are sampled every 100 ms, but a fresh move waits for the previous move's acknowledgement. Actual cadence depends on the simulator; this is bounded jogging, not a continuous velocity controller. There is no catch-up queue. A released hold button prevents subsequent steps; an already submitted step can finish.

Enabling requires a selected standard-mapped controller, neutral sticks, released hold/disable buttons, and a connected/homed/idle simulator. The first detected pad is initially selected; no connected pad initiates motion. Loss of focus/visibility, leaving the workspace, controller loss/replacement, simulator loss, bounds failures or command errors disarm it. Reconnection never re-enables it automatically. Unsupported mappings are reported instead of guessed. Live normalized XYZ/hold/fine input helps check the mapping before enabling.

## Validation and remaining work

- Unit checks cover malformed/sparse input, axis directions, dead zone, diagonal normalization, neutral/hold gates, fine steps, 10–100% speed scaling and invalid speeds, limits, command failures, device identity, focus/tab loss and one outstanding move.
- `npm run test:joypad` runs the actual renderer in sandboxed Electron with synthetic Gamepad API input, testing neutral enabling, hold/release, fine steps, lack of queued movement, focus/navigation loss, unplugging and unsupported mappings. It overrides focus and gamepad data only inside the test window. No real controller or robot is contacted.
- Real gamepad compatibility remains to be checked on the intended controller and OS, including USB/Bluetooth disconnect behavior and standard mapping availability.
- Physical XYZ driving needs the existing hardware transport qualification: firmware identity, coordinates/tool offset, completion semantics, motion envelope, queued stop latency and disconnect recovery. USB remains restricted to existing read-only diagnostics.
- Rotary, pump buttons, rail/joint modes and arbitrary mapping customization are excluded from this batch. They require tool-specific semantics and separate tests. B/Circle is a software disarm, not a physical emergency stop.
