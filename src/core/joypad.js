import { validatePosition } from './project.js';

export function readJoypad(pad) {
  if (pad?.connected !== true || pad.mapping !== 'standard' || !Array.isArray(pad.axes) || pad.axes.length < 4 ||
      !Array.from(pad.axes.slice(0, 4)).every((value) => Number.isFinite(value) && Math.abs(value) <= 1) ||
      !Array.isArray(pad.buttons) || pad.buttons.length < 6 ||
      !Array.from(pad.buttons.slice(0, 6)).every((button) => button && typeof button.pressed === 'boolean')) {
    throw new Error('Use a connected controller with a standard gamepad mapping, four axes and six buttons.');
  }
  const axis = (value) => Math.abs(value) <= 0.2 ? 0 : Math.sign(value) * (Math.abs(value) - 0.2) / 0.8;
  const vector = [axis(pad.axes[0]), -axis(pad.axes[1]), -axis(pad.axes[3])];
  const length = Math.max(1, Math.hypot(...vector));
  return { x: vector[0] / length, y: vector[1] / length, z: vector[2] / length,
    hold: pad.buttons[5].pressed, fine: pad.buttons[4].pressed, stop: pad.buttons[1].pressed };
}

export function clampJoypadMaxSpeed(value) {
  if (!Number.isFinite(value)) throw new Error('Enter a finite maximum joypad speed in mm/min.');
  // 10% must remain above the controller's 60 mm/min minimum.
  return Math.min(3000, Math.max(600, value));
}

export class JoypadDrive {
  constructor(controller) {
    this.controller = controller;
    this.enabled = false;
    this.pending = false;
    this.message = 'Joypad disabled. Connect and home the simulator, then enable with sticks centered.';
  }

  enable(pad) {
    const input = readJoypad(pad);
    const controller = this.controller;
    if (this.pending || controller.state !== 'ready' || !controller.homed || controller.busy || !controller.position) {
      throw new Error('Connect and home the simulator; wait for other operations to finish.');
    }
    if (!Number.isInteger(pad.index) || pad.index < 0 || typeof pad.id !== 'string' || !pad.id) throw new Error('Invalid controller identity.');
    if (pad.axes.slice(0, 4).some((value) => Math.abs(value) > 0.2) || input.hold || input.stop) {
      throw new Error('Center both sticks and release RB/R1 and B/Circle before enabling.');
    }
    this.padIndex = pad.index;
    this.padId = pad.id;
    this.enabled = true;
    this.message = 'Enabled. Hold RB/R1 to jog; release it to stop issuing steps.';
  }

  disable(message = 'Joypad disabled. Enable explicitly to continue.') {
    this.enabled = false;
    this.message = message;
  }

  async tick(pad, { active = true, focused = true, speedPercent = 100, maxSpeed = 600 } = {}) {
    if (!this.enabled) return;
    const controller = this.controller;
    if (!active || !focused) { this.disable('Joypad disabled after leaving the workspace or losing focus.'); return; }
    try {
      if (!Number.isFinite(speedPercent) || speedPercent < 10 || speedPercent > 100) throw new Error('Joypad speed must be between 10 and 100 percent.');
      const maximum = clampJoypadMaxSpeed(maxSpeed);
      const input = readJoypad(pad);
      if (pad.index !== this.padIndex || pad.id !== this.padId) throw new Error('Selected controller changed or disconnected.');
      if (controller.state !== 'ready' || !controller.homed || !controller.position) throw new Error('Simulator is no longer ready.');
      if (input.stop) { this.disable('Joypad disabled by B/Circle.'); return; }
      if (this.pending) return;
      if (controller.busy) throw new Error('Another simulator operation is active.');
      if (!input.hold || !Math.hypot(input.x, input.y, input.z)) {
        this.message = 'Enabled. Hold RB/R1 and move a stick to jog.';
        return;
      }
      const step = (input.fine ? 0.2 : 1) * (maximum / 600) * speedPercent / 100;
      const target = Object.fromEntries(['x', 'y', 'z'].map((axis) => [axis, controller.position[axis] + input[axis] * step]));
      validatePosition(target);
      this.pending = true;
      this.message = `Jogging ${input.fine ? 'fine' : 'normal'} steps. Release RB/R1 to stop issuing steps.`;
      try { await controller.moveTo(target, maximum * speedPercent / 100); } finally { this.pending = false; }
    } catch (error) {
      this.disable(`${error.message} Joypad disabled.`);
    }
  }
}
