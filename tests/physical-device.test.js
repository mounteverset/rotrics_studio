import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { DeviceMonitor } from '../src/main/device.js';

function fixture() {
  let port;
  class Port extends EventEmitter {
    static async list() { return [{ path: '/dev/fake' }]; }
    constructor() { super(); port = this; this.writes = []; this.position = { x: 0, y: 300, z: 0 }; }
    open(cb) { this.isOpen = true; cb(); }
    close(cb) { this.isOpen = false; queueMicrotask(() => { this.emit('close'); cb?.(); }); }
    reply(text) { this.emit('data', Buffer.from(text)); }
    write(line, cb) {
      this.writes.push(line.trim()); cb?.();
      if (this.hold?.(line.trim())) return;
      queueMicrotask(() => {
        if (!this.isOpen) return;
        if (line === 'M115\n') this.reply('FIRMWARE_NAME:Marlin DexArm\n');
        if (line === 'M114\n') this.reply(`X:${this.position.x} Y:${this.position.y} Z:${this.position.z}\n`);
        if (line.startsWith('G1')) for (const [, axis, value] of line.matchAll(/([XYZ])(-?[\d.]+)/g)) this.position[axis.toLowerCase()] = Number(value);
        this.reply('o'); this.reply('k\r\n');
      });
    }
  }
  const device = new DeviceMonitor(Port, { timeout: 30, motionTimeout: 50 });
  return { device, get port() { return port; } };
}
async function ready(f) { await f.device.connect('/dev/fake'); await f.device.query('M115'); await f.device.home(); }
const source = 'G21\nG90\nG1 Z10 F600\nG1 X10 Y300 Z10 F600\nG1 X20 Y300 Z10 F600';
const tick = () => new Promise((r) => setImmediate(r));

test('USB motion requires firmware and home, then completion barrier and refreshed position', async () => {
  const f = fixture(); await f.device.connect('/dev/fake');
  assert.deepEqual(f.port.writes, []);
  await assert.rejects(f.device.home(), /firmware/);
  await assert.rejects(f.device.run({ source }), /Home/);
  await f.device.query('M115'); await f.device.home();
  assert.deepEqual(f.port.writes.slice(-3), ['M1112', 'M400', 'M114']);
  await f.device.move({ axis: 'x', distance: 1, feedrate: 600 });
  assert.equal(f.device.snapshot().position.x, 1);
  await f.device.run({ source });
  assert.deepEqual(f.port.writes.slice(-2), ['M400', 'M114']);
  assert.equal(f.device.snapshot().position.x, 20);
  assert.equal(f.device.snapshot().completed, f.device.snapshot().total);
  await f.device.disconnect();
});

test('validates complete job including approach before writing anything', async () => {
  const f = fixture(); await ready(f);
  const before = f.port.writes.length;
  for (const bad of ['G21\nG90\nG1 X151 Y300 Z0 F600', 'G21\nG90\nG1 X150 Y380 Z100 F600', 'G1 X10 Y300 Z0 F600', 'M3 S255', 'M1112', source + '\nM1000']) await assert.rejects(f.device.run({ source: bad }));
  await assert.rejects(f.device.move({ axis: 'x', distance: 11, feedrate: 600 }));
  await assert.rejects(f.device.run({ source, project: {} }));
  assert.equal(f.port.writes.length, before);
  await f.device.disconnect();
});

test('pause drains firmware before paused; no competing operations or implicit resume', async () => {
  const f = fixture(); await ready(f);
  let held = false;
  f.port.hold = (line) => !held && line.startsWith('G1') && (held = true);
  const running = f.device.run({ source }); await tick();
  f.device.pause();
  await assert.rejects(f.device.home(), /active USB/);
  await assert.rejects(f.device.query('M114'), /Connect/);
  assert.equal(f.device.snapshot().job, 'pausing');
  f.port.reply('ok\n'); await tick();
  assert.equal(f.device.snapshot().job, 'paused');
  assert.equal(f.port.writes.at(-1), 'M400');
  const count = f.port.writes.length; await tick(); assert.equal(f.port.writes.length, count);
  f.device.resume(); await running;
  assert.equal(f.device.snapshot().job, 'idle');
  await f.device.disconnect();
});

test('stop bypasses missing acknowledgement, cancels job, reconnect never resumes', async () => {
  const f = fixture(); await ready(f);
  f.port.hold = (line) => line.startsWith('G1');
  const running = f.device.run({ source }).catch(() => {}); await tick();
  await f.device.stop(); await running;
  assert.equal(f.port.writes.at(-1), 'M410');
  assert.equal(f.device.snapshot().homed, false);
  assert.equal(f.device.snapshot().status, 'disconnected');
  await f.device.connect('/dev/fake');
  assert.deepEqual(f.port.writes, []);
  await assert.rejects(f.device.run({ source }), /Home/);
  await f.device.disconnect();
});

test('firmware errors, disconnect and timeout invalidate home without retry', async () => {
  for (const failure of ['error', 'unplug', 'timeout', 'reboot']) {
    const f = fixture(); await ready(f);
    f.port.hold = (line) => line.startsWith('G1');
    const running = assert.rejects(f.device.run({ source })); await tick();
    if (failure === 'error') f.port.reply('Error: motion rejected\n');
    if (failure === 'reboot') f.port.reply('start\n');
    if (failure === 'unplug') f.port.emit('close');
    await running;
    assert.equal(f.device.snapshot().status, 'faulted');
    assert.equal(f.device.snapshot().homed, false);
    assert.equal(f.device.snapshot().position, null);
    assert.equal(f.port.writes.filter((l) => l.startsWith('G1')).length, 1);
    await f.device.disconnect();
  }
});


test('disconnect while paused releases job and missing final position locks motion', async () => {
  const f = fixture(); await ready(f);
  let held = false;
  f.port.hold = (line) => !held && line.startsWith('G1') && (held = true);
  const running = f.device.run({ source }); await tick();
  f.device.pause(); f.port.reply('ok\n'); await tick();
  assert.equal(f.device.snapshot().job, 'paused');
  await f.device.disconnect(); await running;
  await ready(f);
  f.port.hold = (line) => {
    if (line !== 'M114') return false;
    queueMicrotask(() => f.port.reply('ok\n'));
    return true;
  };
  await assert.rejects(f.device.run({ source }), /Position report missing/);
  assert.equal(f.device.snapshot().homed, false);
  assert.equal(f.device.snapshot().position, null);
  await f.device.disconnect();
});

test('absolute targets are validated and a stop during home never unlocks motion', async () => {
  const f = fixture(); await ready(f);
  await f.device.move({ position: { x: 2, y: 301, z: 10 }, feedrate: 600 });
  assert.deepEqual(f.device.snapshot().position, { x: 2, y: 301, z: 10 });
  await assert.rejects(f.device.move({ position: { x: 999, y: 300, z: 0 }, feedrate: 600 }));
  f.port.hold = (line) => line === 'M1112';
  const homing = assert.rejects(f.device.home()); await tick();
  await f.device.stop(); await homing;
  assert.equal(f.device.snapshot().homed, false);
  assert.equal(f.device.snapshot().status, 'disconnected');
  assert.equal(f.port.writes.at(-1), 'M410');
});
