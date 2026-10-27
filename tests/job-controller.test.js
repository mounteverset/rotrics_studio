import test from 'node:test';
import assert from 'node:assert/strict';
import { Controller } from '../src/core/controller.js';
import { SimulatedTransport } from '../src/protocol/simulator.js';
import { parseGcode } from '../src/core/gcode.js';
import { defaultSequence, sequenceCommands } from '../src/core/teach.js';

const source = 'G21\nG90\nG1 X0 Y300 Z10 F600\nG91\nG1 X5.25 Y-1\nG4 P10\nM400';
const create = () => new Controller({ createTransport: () => new SimulatedTransport({ delay: 1 }) });
const sends = (controller) => controller.log.filter((e) => e.direction === 'send').map((e) => e.text);
const point = { type: 'move', name: 'Pick', x: -10, y: 300, z: 10, feedrate: 900 };

test('absolute manual moves and jogs honor requested speed and validate before transmission', async () => {
  const controller = create();
  await assert.rejects(controller.moveTo({ x: 0, y: 300, z: 0 }), /Home/);
  await controller.connect(); await controller.home();
  await controller.moveTo({ x: 10.25, y: 275.5, z: -1.25 }, 900);
  assert.equal(sends(controller).at(-1), 'G1 X10.250 Y275.500 Z-1.250 F900');
  await controller.jog('x', .5, 1200);
  assert.equal(sends(controller).at(-1), 'G1 X10.750 Y275.500 Z-1.250 F1200');
  const count = sends(controller).length;
  await assert.rejects(controller.moveTo({ x: 151, y: 300, z: 0 }), /between/);
  await assert.rejects(controller.moveTo({ x: 0, y: 300, z: 0 }, NaN), /speed/);
  assert.equal(sends(controller).length, count);
  controller.disconnect();
});

test('reviewed imports execute only canonical commands and never transmit unsupported source', async () => {
  const controller = create();
  await controller.connect(); await controller.home(); controller.log = [];
  await controller.runGcode(source);
  assert.deepEqual(sends(controller), parseGcode(source).commands);
  assert.deepEqual(controller.position, { x: 5.25, y: 299, z: 10 });
  const count = sends(controller).length;
  await assert.rejects(controller.runGcode(source + '\nM3 S255'), /Line/);
  assert.equal(sends(controller).length, count);
  assert.equal(controller.state, 'ready');
  controller.disconnect();
});

test('teach repeats, waits, pneumatic mappings and cleanup all share the acknowledged runner', async () => {
  const controller = create();
  const sequence = { ...defaultSequence(), tool: 'suction', repeat: 2, steps: [point, { type: 'action', action: 'pick' }, { type: 'wait', milliseconds: 10 }, { ...point, name: 'Place', x: 20 }, { type: 'action', action: 'release' }] };
  await controller.connect(); await controller.home(); controller.log = [];
  await controller.runSequence(sequence);
  assert.deepEqual(sends(controller), sequenceCommands(sequence));
  assert.equal(controller.completed, controller.total);
  assert.equal(controller.pump, 'off');
  assert.equal(controller.state, 'ready');
  const count = sends(controller).length;
  await assert.rejects(controller.runSequence({ ...sequence, steps: [{ ...point, x: 900 }] }));
  assert.equal(sends(controller).length, count);
  controller.disconnect();
});

test('stopping during a dwell prevents later moves and clears job ownership', async () => {
  const controller = create();
  await controller.connect(); await controller.home();
  let stop;
  const reachedWait = new Promise((resolve) => { stop = resolve; });
  controller.addEventListener('change', () => { if (sends(controller).at(-1) === 'G4 P100') stop(); });
  const sequence = { ...defaultSequence(), steps: [point, { type: 'wait', milliseconds: 100 }, { ...point, name: 'Unsent', x: 50 }] };
  const run = controller.runSequence(sequence);
  const rejected = assert.rejects(run, /Disconnected/);
  await reachedWait; controller.stop(); await rejected;
  assert.equal(controller.state, 'disconnected');
  assert.equal(controller.homed, false);
  assert.ok(!sends(controller).some((line) => line.includes('X50.000')));
});


test('G-code startup lifts accept signed and leading-dot decimals in the simulator', async () => {
  const controller = create();
  await controller.connect(); await controller.home();
  await controller.runGcode('G21\nG90\nG1 Z+.5 F600\nG1 X0 Y300\nM400');
  assert.deepEqual(controller.position, { x: 0, y: 300, z: .5 });
  assert.ok(controller.log.filter((entry) => entry.direction === 'receive' && entry.text.endsWith('Z:0.50')).length >= 2);
  controller.disconnect();
});
