import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { DeviceMonitor } from '../src/main/device.js';

function fixture({ reply = true, openDelay = 0, openError = null, timeout = 100 } = {}) {
  const ports = [];
  class Port extends EventEmitter {
    static async list() { return [{ path: '/dev/test', manufacturer: 'Test only', vendorId: '0483', extra: 'discard' }]; }
    constructor(options) { super(); this.options = options; this.isOpen = false; this.writes = []; ports.push(this); }
    open(callback) { setTimeout(() => { this.isOpen = !openError; callback(openError); }, openDelay); }
    close(callback) { this.isOpen = false; queueMicrotask(() => { this.emit('close'); callback?.(); }); }
    write(command, callback) {
      this.writes.push(command);
      callback();
      if (reply) queueMicrotask(() => {
        this.emit('data', Buffer.from(command === 'M115\n' ? 'FIRMWARE_NAME:Marlin TEST\n' : 'X:1.25 Y:300.50 Z:-2.00 E:0\n'));
        this.emit('data', Buffer.from('ok\n'));
      });
    }
  }
  const monitor = new DeviceMonitor(Port, { timeout });
  return { monitor, ports };
}

test('lists public metadata, opens at 115200 8N1, and sends no commands on connect', async () => {
  const { monitor, ports } = fixture();
  assert.deepEqual(await monitor.list(), [{ path: '/dev/test', manufacturer: 'Test only', vendorId: '0483', productId: undefined }]);
  await monitor.connect('/dev/test');
  assert.equal(monitor.snapshot().status, 'connected');
  assert.deepEqual(ports[0].writes, []);
  assert.equal(ports[0].options.baudRate, 115200);
  assert.equal(ports[0].options.autoOpen, false);
  assert.equal(ports[0].options.parity, 'none');
  await monitor.disconnect();
  assert.equal(ports[0].isOpen, false);
});

test('unlisted and malformed paths never open an arbitrary device', async () => {
  const { monitor, ports } = fixture();
  for (const path of ['/tmp/secret', '', null, '/dev/test\nG1 X10']) await assert.rejects(monitor.connect(path));
  assert.equal(ports.length, 0);
});

test('only the exact diagnostic whitelist reaches the serial port', async () => {
  const { monitor, ports } = fixture();
  await monitor.connect('/dev/test');
  for (const command of ['G1 X10', 'M1112', 'M3 S255', 'M115\nG1 X10', 'M114 ', {}, null]) await assert.rejects(monitor.query(command), /Only firmware/);
  await monitor.query('M115');
  await monitor.query('M114');
  assert.deepEqual(ports[0].writes, ['M115\n', 'M114\n']);
  assert.equal(monitor.snapshot().firmware, 'FIRMWARE_NAME:Marlin TEST');
  assert.deepEqual(monitor.snapshot().position, { x: 1.25, y: 300.5, z: -2 });
  const copy = monitor.snapshot();
  copy.position.x = 123;
  assert.equal(monitor.snapshot().position.x, 1.25);
  await monitor.disconnect();
});

test('query timeout closes the port, faults, and never retries', async () => {
  const { monitor, ports } = fixture({ reply: false, timeout: 15 });
  await monitor.connect('/dev/test');
  await assert.rejects(monitor.query('M114'), /timed out/);
  assert.equal(monitor.snapshot().status, 'faulted');
  assert.equal(monitor.snapshot().busy, false);
  assert.equal(ports[0].isOpen, false);
  assert.deepEqual(ports[0].writes, ['M114\n']);
  await assert.rejects(monitor.query('M115'), /Connect/);
  await monitor.disconnect();
});

test('unplug during a query rejects it and clears reported coordinates', async () => {
  const { monitor, ports } = fixture({ reply: false });
  await monitor.connect('/dev/test');
  const pending = assert.rejects(monitor.query('M114'), /Connection lost/);
  ports[0].isOpen = false;
  ports[0].emit('close');
  await pending;
  assert.equal(monitor.snapshot().status, 'faulted');
  assert.equal(monitor.snapshot().position, null);
  await monitor.disconnect();
});

test('cancel while opening closes a late-opened port and cannot resurrect its state', async () => {
  const { monitor, ports } = fixture({ openDelay: 20 });
  const connecting = assert.rejects(monitor.connect('/dev/test'), /cancelled/);
  await new Promise((resolve) => setTimeout(resolve, 5));
  await monitor.disconnect();
  await connecting;
  assert.equal(monitor.snapshot().status, 'disconnected');
  assert.equal(ports[0].isOpen, false);
  assert.deepEqual(ports[0].writes, []);
});

test('open errors leave an actionable fault and permit explicit reconnection', async () => {
  const { monitor } = fixture({ openError: new Error('Access denied') });
  await assert.rejects(monitor.connect('/dev/test'), /Access denied/);
  assert.equal(monitor.snapshot().status, 'faulted');
  assert.match(monitor.snapshot().message, /permissions/);
  await monitor.disconnect();
});
