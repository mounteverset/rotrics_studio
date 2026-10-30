import { SerialSession } from '../protocol/session.js';
import { parseGcode } from '../core/gcode.js';
import { drawingCommands, validatePosition } from '../core/project.js';
import { penReachAtHeight } from '../core/workspace.js';

// Conservative commissioning envelope; this is not a collision model.
function checkPath(source, position) {
  validatePosition(position);
  parseGcode(source); // Validate declarations independently of the synthetic approach.
  const prefix = `G21\nG90\nG1 X${position.x} Y${position.y} Z${position.z} F600\n`;
  const job = parseGcode(prefix + source);
  for (const { from, to } of job.segments) {
    const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const p = Object.fromEntries(['x', 'y', 'z'].map((a) => [a, from[a] + (to[a] - from[a]) * t]));
      const reach = penReachAtHeight(p.z);
      const radius = Math.hypot(p.x, p.y);
      if (!reach || radius < reach.innerRadius + 2 || radius > reach.outerRadius - 2) throw new Error('Path exceeds the conservative theoretical pen reach');
    }
  }
  return ['G21', 'G90', ...job.commands.slice(3)]; // Strip the synthetic current-position move; never send it.
}


export class DeviceMonitor {
  constructor(SerialPort, { onChange = () => {}, timeout = 5000, motionTimeout = 120000 } = {}) {
    this.SerialPort = SerialPort;
    this.onChange = onChange;
    this.timeout = timeout;
    this.motionTimeout = motionTimeout;
    this.generation = 0;
    this.state = { status: 'disconnected', path: '', firmware: '', position: null, busy: false, log: [], message: 'Select a USB serial port. Connect, identify firmware, then explicitly home to enable pen motion.' };
  }

  snapshot() { return structuredClone(this.state); }
  update() { this.onChange(this.snapshot()); }

  async list() {
    if (!this.SerialPort) throw new Error('USB serial support could not load. Reinstall dependencies for this platform; simulation is still available.');
    return (await this.SerialPort.list()).map(({ path, manufacturer, vendorId, productId }) => ({ path, manufacturer, vendorId, productId }));
  }

  async connect(path) {
    if (typeof path !== 'string' || !path || path.length > 256 || /[\r\n\0]/.test(path)) throw new Error('Select a valid serial port');
    if (!['disconnected', 'faulted'].includes(this.state.status)) throw new Error('Disconnect before changing serial ports');
    await this.disconnect();
    const generation = ++this.generation;
    this.state = { status: 'connecting', path, firmware: '', position: null, busy: false, log: [], message: 'Opening USB serial port at 115200 baud…' };
    this.update();
    try {
      const ports = await this.list();
      if (generation !== this.generation) throw new Error('Connection cancelled');
      if (!ports.some((port) => port.path === path)) throw new Error('This port is no longer available. Refresh the port list.');
      const port = new this.SerialPort({ path, baudRate: 115200, dataBits: 8, stopBits: 1, parity: 'none', rtscts: false, xon: false, xoff: false, autoOpen: false });
      this.port = port;
      const transport = {
        write: (command) => {
          if (generation !== this.generation || this.state.status === 'stopping') throw new Error('USB operation cancelled');
          port.write(command, (error) => { if (error) session.close(error); });
        },
        close: () => {
          if (!port.isOpen) return;
          this.closing = new Promise((resolve) => {
            const timer = setTimeout(resolve, this.timeout);
            port.close(() => { clearTimeout(timer); resolve(); });
          });
        },
      };
      const session = new SerialSession(transport, {
        timeout: this.timeout,
        onLine: (direction, text) => {
          if (generation !== this.generation) return;
          this.state.log.push({ direction, text, time: new Date().toLocaleTimeString() });
          this.state.log = this.state.log.slice(-150);
          if (direction === 'receive') {
            if (/^start$/i.test(text) && (this.state.homed || this.state.busy)) {
              session.close(new Error('Firmware restarted; physical position is unknown'));
              return;
            }
            if (text.includes('FIRMWARE_NAME:')) this.state.firmware = text;
            const match = text.match(/\bX:\s*(-?\d+(?:\.\d+)?)\s+Y:\s*(-?\d+(?:\.\d+)?)\s+Z:\s*(-?\d+(?:\.\d+)?)/);
            if (match) {
              const coordinates = match.slice(1).map(Number);
              if (coordinates.every(Number.isFinite)) this.state.position = { x: coordinates[0], y: coordinates[1], z: coordinates[2] };
            }
          }
          this.update();
        },
        onFault: (error) => {
          if (generation !== this.generation) return;
          this.state.status = 'faulted';
          this.state.homed = false;
          this.state.job = 'idle';
          this.releasePause?.();
          this.state.busy = false;
          this.state.position = null;
          this.state.message = `${error.message}. Reconnect explicitly; no commands will be retried.`;
          this.update();
        },
      });
      this.session = session;
      port.on('data', (data) => transport.onData(data.toString('utf8')));
      port.on('close', () => transport.onClose());
      port.on('error', (error) => session.close(error));
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Serial port did not open in time')), this.timeout);
        port.open((error) => {
          clearTimeout(timer);
          if (generation !== this.generation || session.closed) {
            if (port.isOpen) port.close(() => {});
            reject(new Error('Connection cancelled'));
          } else if (error) reject(error);
          else resolve();
        });
      });
      if (generation !== this.generation || session.closed) throw new Error('Connection cancelled');
      this.state.status = 'connected';
      this.state.message = 'USB connected. Read firmware, then explicitly home. No motion is sent on connection.';
      this.update();
      return this.snapshot();
    } catch (error) {
      if (generation === this.generation) {
        this.session?.close(error);
        this.state.status = 'faulted';
        this.state.busy = false;
        this.state.message = `Could not connect: ${error.message}. Check the cable, port permissions, and whether another app owns the port.`;
        this.update();
      }
      throw error;
    }
  }

  async query(command) {
    if (!['M115', 'M114'].includes(command)) throw new Error('Only firmware (M115) and position (M114) queries are enabled');
    if (this.state.status !== 'connected' || this.state.busy) throw new Error('Connect and wait for the current query to finish');
    const generation = this.generation;
    if (command === 'M115') this.state.firmware = '';
    else this.state.position = null;
    this.state.busy = true;
    this.state.message = `Requesting ${command === 'M115' ? 'firmware identity' : 'reported position'}…`;
    this.update();
    try {
      await this.session.send(command);
      if (generation !== this.generation || this.state.status !== 'connected') throw new Error('Connection changed during query');
      this.state.message = 'Query acknowledged. Device reports are diagnostic data, not verified physical position or proof of DexArm identity.';
    } finally {
      if (generation === this.generation) {
        this.state.busy = false;
        this.update();
      }
    }
    return this.snapshot();
  }


  async operation(action) {
    if (this.state.status !== 'connected' || this.state.busy) throw new Error('Connect and wait for the active USB operation');
    const generation = this.generation;
    this.state.busy = true;
    this.session.timeout = this.motionTimeout;
    this.update();
    try { await action(); }
    catch (error) {
      if (generation === this.generation && this.state.status === 'connected') this.state.message = error.message;
      throw error;
    }
    finally {
      if (generation === this.generation) {
        this.state.busy = false;
        if (this.session) this.session.timeout = this.timeout;
        this.update();
      }
    }
    return this.snapshot();
  }

  async home() {
    if (!this.state.firmware) throw new Error('Read and check firmware identity before homing');
    return this.operation(async () => {
      const session = this.session;
      this.state.homed = false;
      this.state.position = null;
      this.state.message = 'Homing physical DexArm…';
      await session.send('M1112');
      await session.send('M400');
      await session.send('M114');
      if (this.session !== session || this.state.status !== 'connected') throw new Error('Connection changed during home');
      if (!this.state.position) throw new Error('No position report after homing; motion remains locked');
      validatePosition(this.state.position);
      this.state.homed = true;
      this.state.message = 'Home and completion acknowledged. Reported position is not measured tracking.';
    });
  }

  async move({ axis, distance, position, feedrate } = {}) {
    if (!this.state.homed || !this.state.position) throw new Error('Home before moving');
    if (position !== undefined) {
      validatePosition(position);
      if (axis !== undefined || distance !== undefined) throw new Error('Provide a target or a jog, not both');
    }
    if (position === undefined && (!['x', 'y', 'z'].includes(axis) || !Number.isFinite(distance) || Math.abs(distance) > 10 || distance === 0)) throw new Error('Invalid jog: step must be nonzero and up to 10 mm');
    if (!Number.isFinite(feedrate) || feedrate < 60 || feedrate > 3000) throw new Error('Move speed must be 60–3000 mm/min');
    const p = position ?? { ...this.state.position, [axis]: this.state.position[axis] + distance };
    return this.run({ source: `G21\nG90\nG1 X${p.x} Y${p.y} Z${p.z} F${feedrate}` });
  }

  async run({ project, source } = {}) {
    if (!this.state.homed || !this.state.position) throw new Error('Home before running a physical job');
    if ((project === undefined) === (source === undefined)) throw new Error('Provide exactly one project or G-code source');
    const commands = checkPath(project === undefined ? source : drawingCommands(project).join('\n'), this.state.position);
    return this.operation(async () => {
      const session = this.session;
      this.state.job = 'running';
      this.state.completed = 0;
      this.state.total = commands.length;
      this.state.message = 'Streaming pen motion over USB. Counts are acknowledgements; completion waits for M400.';
      try {
        for (const command of commands) {
          if (this.state.job === 'pausing') {
            await session.send('M400');
            this.state.job = 'paused';
            this.state.message = 'Pause barrier acknowledged; no further motion is being streamed.';
            this.update();
            await new Promise((resolve) => { this.releasePause = resolve; });
          }
          if (this.session !== session || this.state.job !== 'running') return;
          await session.send(command);
          if (this.session !== session || this.state.job === 'stopping') return;
          this.state.completed++;
          this.update();
        }
        this.state.position = null;
        await session.send('M114');
        if (this.session !== session || this.state.status !== 'connected') return;
        if (!this.state.position) {
          this.state.homed = false;
          throw new Error('Position report missing after job; home before further motion');
        }
        this.state.job = 'idle';
        this.state.message = 'Job completion barrier acknowledged. Check the physical result.';
      } finally {
        if (this.session === session) {
          this.releasePause = null;
          if (this.state.job !== 'paused') this.state.job = 'idle';
        }
      }
    });
  }

  pause() {
    if (this.state.job !== 'running') throw new Error('No USB job to pause');
    this.state.job = 'pausing';
    this.state.message = 'Pause requested: waiting for the current acknowledgement and queued motion (M400).';
    this.update();
    return this.snapshot();
  }

  resume() {
    if (this.state.job !== 'paused') throw new Error('Wait for the USB pause barrier');
    this.state.job = 'running';
    this.state.message = 'Resuming USB job.';
    this.releasePause?.();
    this.releasePause = null;
    this.update();
    return this.snapshot();
  }

  async stop() {
    const generation = this.generation;
    this.state.job = 'stopping';
    const wasConnected = this.state.status === 'connected';
    this.state.status = 'stopping';
    this.releasePause?.();
    this.update();
    // Bypass the pending acknowledgement: quick-stop must not wait behind motion.
    if (wasConnected && this.port?.isOpen) {
      this.state.log.push({ direction: 'send', text: 'M410', time: new Date().toLocaleTimeString() });
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, this.timeout);
        try { this.port.write('M410\n', (error) => {
          if (!error && this.port?.drain) this.port.drain(() => { clearTimeout(timer); resolve(); });
          else { clearTimeout(timer); resolve(); }
        }); }
        catch { clearTimeout(timer); resolve(); }
      });
    }
    if (generation !== this.generation) return this.snapshot();
    await this.disconnect();
    this.state.message = 'M410 stop requested; physical stop is unverified. Remaining job discarded. Reconnect and home. USB disconnect is not an emergency stop.';
    this.update();
    return this.snapshot();
  }

  async disconnect() {
    ++this.generation;
    this.state.homed = false;
    this.state.job = 'idle';
    this.releasePause?.();
    this.releasePause = null;
    this.session?.close();
    this.session = null;
    this.port = null;
    this.state.status = 'disconnected';
    this.state.busy = false;
    this.state.position = null;
    this.state.message = 'USB disconnected. Disconnecting does not stop a robot or turn off its tools.';
    this.update();
    await this.closing;
    this.closing = null;
    return this.snapshot();
  }
}
