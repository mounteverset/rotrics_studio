import test from 'node:test';
import assert from 'node:assert/strict';
import { Controller } from '../src/core/controller.js';
import { SimulatedTransport } from '../src/protocol/simulator.js';
import { defaultProject, drawingCommands } from '../src/core/project.js';

function createController() {
  return new Controller({ createTransport: () => new SimulatedTransport({ delay: 2 }) });
}

function waitFor(controller, state) {
  if (controller.state === state) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { controller.removeEventListener('change', changed); reject(new Error(`Did not reach ${state}`)); }, 1000);
    function changed() {
      if (controller.state !== state) return;
      clearTimeout(timer);
      controller.removeEventListener('change', changed);
      resolve();
    }
    controller.addEventListener('change', changed);
  });
}

test('connecting never homes or moves; home unlocks decimal jogging', async () => {
  const controller = createController();
  await controller.connect();
  assert.equal(controller.state, 'uninitialized');
  assert.deepEqual(controller.log.filter((entry) => entry.direction === 'send').map((entry) => entry.text), ['M114']);
  await assert.rejects(controller.jog('x', 1), /Home/);
  await controller.home();
  await controller.jog('x', 0.25);
  assert.equal(controller.position.x, 0.25);
  assert.equal(controller.homed, true);
  controller.disconnect();
});

test('jog validation rejects nonfinite values and out-of-bounds moves before transmission', async () => {
  const controller = createController();
  await controller.connect();
  await controller.home();
  await assert.rejects(controller.jog('x', NaN), /Invalid jog/);
  controller.position = { x: 150, y: 300, z: 0 };
  const sent = controller.log.filter((entry) => entry.direction === 'send').length;
  await assert.rejects(controller.jog('x', 1), /between/);
  assert.equal(controller.log.filter((entry) => entry.direction === 'send').length, sent);
  controller.disconnect();
});

test('drawing pauses at a command boundary, locks jogging, and completes after resume', async () => {
  const controller = createController();
  await controller.connect();
  await controller.home();
  const run = controller.run(defaultProject());
  controller.pause();
  await waitFor(controller, 'paused');
  const completed = controller.completed;
  await assert.rejects(controller.jog('x', 1), /ready/);
  assert.equal(controller.completed, completed);
  controller.resume();
  await run;
  assert.equal(controller.state, 'ready');
  assert.equal(controller.completed, controller.total);
  assert.equal(controller.log.filter((entry) => entry.direction === 'send').at(-1).text, 'M400');
  controller.disconnect();
});

test('stop releases a paused job; reconnect never resumes it or retains homing', async () => {
  const controller = createController();
  await controller.connect();
  await controller.home();
  const run = controller.run(defaultProject());
  controller.pause();
  await waitFor(controller, 'paused');
  controller.stop();
  await run;
  assert.equal(controller.state, 'disconnected');
  assert.equal(controller.homed, false);
  assert.equal(controller.position, null);
  await controller.connect();
  assert.equal(controller.state, 'uninitialized');
  assert.equal(controller.total, 0);
  await assert.rejects(controller.run(defaultProject()), /Home/);
  controller.disconnect();
});

test('stop during an in-flight drawing rejects it and clears the connection', async () => {
  const controller = createController();
  await controller.connect();
  await controller.home();
  const run = assert.rejects(controller.run(defaultProject()), /Disconnected/);
  controller.stop();
  await run;
  assert.equal(controller.state, 'disconnected');
  assert.equal(controller.homed, false);
});

test('a lost connection releases a paused job and requires initialization again', async () => {
  const transport = new SimulatedTransport({ delay: 2 });
  const controller = new Controller({ createTransport: () => transport });
  await controller.connect();
  await controller.home();
  const run = controller.run(defaultProject());
  controller.pause();
  await waitFor(controller, 'paused');
  transport.close();
  await run;
  assert.equal(controller.state, 'faulted');
  assert.equal(controller.homed, false);
  assert.equal(controller.position, null);
  assert.equal(controller.releasePause, null);
});


test('multi-text layout sends the same generated commands in sequence and finishes both boxes', async () => {
  const controller = createController();
  const writing = { text: 'T', font: 'futural', fontSize: 10, letterSpacing: 0, lineSpacing: 1.5, align: 'left' };
  const project = { ...defaultProject(), version: 2, texts: [
    { id: 'a', x: -20, y: 20, writing }, { id: 'b', x: 30, y: -10, writing: { ...writing, fontSize: 5 } },
  ] };
  const generated = drawingCommands(project);
  await controller.connect(); await controller.home();
  controller.log = [];
  await controller.run(project);
  assert.deepEqual(controller.log.filter((entry) => entry.direction === 'send').map((entry) => entry.text), generated);
  assert.equal(controller.completed, generated.length);
  assert.equal(controller.state, 'ready');
  assert.equal(controller.position.z, project.origin.z + 10);
  controller.disconnect();
});
