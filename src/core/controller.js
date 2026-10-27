import { SerialSession } from '../protocol/session.js';
import { SimulatedTransport } from '../protocol/simulator.js';
import { drawingCommands, validatePosition } from './project.js';
import { parseGcode } from './gcode.js';
import { sequenceCommands } from './teach.js';

export class Controller extends EventTarget {
  constructor({ createTransport = () => new SimulatedTransport(), timeout = 3000 } = {}) {
    super();
    this.createTransport = createTransport;
    this.timeout = timeout;
    this.state = 'disconnected';
    this.position = null;
    this.homed = false;
    this.busy = false;
    this.completed = 0;
    this.total = 0;
    this.jobName = '';
    this.pump = 'off';
    this.log = [];
    this.message = 'Connect the simulator to begin. Physical robot control is not enabled.';
  }

  update() { this.dispatchEvent(new Event('change')); }

  record(direction, text) {
    this.log.push({ direction, text, time: new Date().toLocaleTimeString() });
    this.log = this.log.slice(-150);
    if (direction === 'receive') {
      const match = text.match(/^X:(-?\d+(?:\.\d+)?) Y:(-?\d+(?:\.\d+)?) Z:(-?\d+(?:\.\d+)?)/);
      if (match) this.position = { x: Number(match[1]), y: Number(match[2]), z: Number(match[3]) };
    }
    this.update();
  }

  async connect() {
    if (this.state !== 'disconnected' && this.state !== 'faulted') throw new Error('Already connected');
    this.state = 'connecting';
    this.homed = false;
    this.position = null;
    this.completed = this.total = 0;
    this.message = 'Connecting to simulator…';
    this.session = new SerialSession(this.createTransport(), {
      timeout: this.timeout,
      onLine: (direction, text) => this.record(direction, text),
      onFault: (error) => {
        this.state = 'faulted';
        this.homed = false;
        this.position = null;
        this.pump = 'unknown';
        this.message = error.message;
        this.releasePause?.();
        this.releasePause = null;
        this.update();
      },
    });
    this.update();
    await this.session.send('M114');
    this.state = 'uninitialized';
    this.message = 'Simulator connected. Home before jogging or running a drawing.';
    this.update();
  }

  disconnect(message = 'Disconnected. Reconnect and home before continuing.') {
    this.session?.close();
    this.state = 'disconnected';
    this.homed = false;
    this.position = null;
    this.pump = 'unknown';
    this.message = message;
    this.releasePause?.();
    this.releasePause = null;
    this.update();
  }

  async home() {
    if (!['uninitialized', 'ready'].includes(this.state) || this.busy) throw new Error('Cannot home while another operation is active');
    this.busy = true;
    this.message = 'Homing simulator…';
    this.update();
    try {
      await this.session.send('M1112');
      this.homed = true;
      this.state = 'ready';
      this.message = 'Simulator homed. Generate or send your checked G-code, or jog the simulated pen.';
    } finally {
      this.busy = false;
      this.update();
    }
  }

  async jog(axis, distance, feedrate = 600) {
    if (this.state !== 'ready' || this.busy || !this.position) throw new Error('Home and wait for the robot to be ready before jogging');
    if (!['x', 'y', 'z'].includes(axis) || !Number.isFinite(distance) || Math.abs(distance) > 10) throw new Error('Invalid jog step');
    return this.moveTo({ ...this.position, [axis]: this.position[axis] + distance }, feedrate);
  }

  async moveTo(position, feedrate = 600) {
    if (this.state !== 'ready' || this.busy) throw new Error('Home and wait for the robot to be ready before moving');
    const target = { ...validatePosition(position) };
    if (!Number.isFinite(feedrate) || feedrate < 60 || feedrate > 3000) throw new Error('Move speed must be 60–3000 mm/min');
    this.busy = true;
    this.update();
    try {
      await this.session.send('G21'); await this.session.send('G90');
      await this.session.send(`G1 X${target.x.toFixed(3)} Y${target.y.toFixed(3)} Z${target.z.toFixed(3)} F${feedrate}`);
      this.message = 'Move completed in simulator.';
    } finally { this.busy = false; this.update(); }
  }

  async run(project) {
    return this.execute(drawingCommands(project), project.name);
  }

  async runGcode(source) {
    return this.execute(parseGcode(source).commands, 'Imported G-code');
  }

  async runSequence(sequence) {
    return this.execute(sequenceCommands(sequence), sequence.name);
  }

  async execute(commands, name) {
    if (this.state !== 'ready' || this.busy) throw new Error('Home and wait for the robot to be ready before running');
    this.jobName = name;
    const session = this.session;
    this.state = 'running';
    this.completed = 0;
    this.total = commands.length;
    this.message = 'Running in simulator. No physical motion commands are sent.';
    this.update();
    try {
      for (const command of commands) {
        if (this.state === 'pausing') {
          this.state = 'paused';
          this.message = 'Simulator paused at a command boundary.';
          this.update();
        }
        if (this.state === 'paused') await new Promise((resolve) => { this.releasePause = resolve; });
        if (this.state !== 'running' || this.session !== session) return;
        await session.send(command);
        if (!['running', 'pausing'].includes(this.state) || this.session !== session) return;
        if (/^M100[0-3]$/.test(command)) this.pump = { M1000: 'pump in', M1001: 'pump out', M1002: 'neutral', M1003: 'off' }[command];
        this.completed++;
        this.update();
      }
      this.state = 'ready';
      this.message = 'Job complete. Simulator motion finished.';
    } finally {
      this.releasePause = null;
      this.update();
    }
  }

  pause() {
    if (this.state !== 'running') throw new Error('No running job to pause');
    this.state = 'pausing';
    this.message = 'Pausing after the current simulated command…';
    this.update();
  }

  resume() {
    if (this.state !== 'paused') throw new Error('No paused job to resume');
    this.state = 'running';
    this.message = 'Running in simulator.';
    this.releasePause?.();
    this.releasePause = null;
    this.update();
  }

  stop() {
    this.disconnect('Simulation stopped. Reconnect and home to start a new job.');
  }
}
