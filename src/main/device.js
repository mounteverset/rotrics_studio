import { SerialSession } from '../protocol/session.js';

export class DeviceMonitor {
  constructor(SerialPort, { onChange = () => {}, timeout = 5000 } = {}) {
    this.SerialPort = SerialPort;
    this.onChange = onChange;
    this.timeout = timeout;
    this.generation = 0;
    this.state = { status: 'disconnected', path: '', firmware: '', position: null, busy: false, log: [], message: 'Select a USB serial port. Physical motion is disabled.' };
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
        write: (command) => port.write(command, (error) => { if (error) session.close(error); }),
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
      this.state.message = 'USB connected for diagnostics only. Request firmware or reported coordinates; physical motion remains disabled.';
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

  async disconnect() {
    ++this.generation;
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
