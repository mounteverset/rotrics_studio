import test from 'node:test';
import assert from 'node:assert/strict';
import { readJoypad, JoypadDrive, clampJoypadMaxSpeed } from '../src/core/joypad.js';
import { SIMULATOR_LIMITS } from '../src/core/project.js';

function pad(axes = [0, 0, 0, 0], pressed = []) {
  return { connected: true, mapping: 'standard', index: 0, id: 'Test joypad', axes,
    buttons: Array.from({ length: 6 }, (_, index) => ({ pressed: pressed.includes(index) })) };
}

function setup() {
  const controller = {
    state: 'ready', homed: true, busy: false, position: { x: 0, y: 300, z: 0 }, moves: [],
    async moveTo(position, feedrate) {
      this.moves.push({ position: { ...position }, feedrate });
      this.position = { ...position };
    },
  };
  return { controller, drive: new JoypadDrive(controller) };
}

function close(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} should equal ${expected}`);
}

function positionClose(actual, expected) {
  for (const axis of ['x', 'y', 'z']) close(actual[axis], expected[axis]);
}

function malformedPads() {
  const values = [null, undefined, {}, [], 'pad'];
  for (const connected of [false, undefined, 1, 'true']) values.push({ ...pad(), connected });
  for (const mapping of ['', 'other', undefined]) values.push({ ...pad(), mapping });
  for (const axes of [null, {}, '0000', [0, 0, 0], new Array(4)]) values.push({ ...pad(), axes });
  for (let index = 0; index < 4; index++) {
    for (const value of [NaN, Infinity, -Infinity, -1.001, 1.001, '0', null, undefined]) {
      const input = pad();
      input.axes[index] = value;
      values.push(input);
    }
  }
  for (const buttons of [null, {}, '000000', pad().buttons.slice(0, 5), new Array(6)]) values.push({ ...pad(), buttons });
  for (let index = 0; index < 6; index++) {
    for (const value of [null, undefined, false, {}, { pressed: 0 }, { pressed: 'false' }]) {
      const input = pad();
      input.buttons[index] = value;
      values.push(input);
    }
  }
  return values;
}

test('readJoypad rejects malformed pads, including every required axis and button', () => {
  for (const [index, input] of malformedPads().entries()) {
    assert.throws(() => readJoypad(input), Error, `Malformed pad case ${index}`);
  }
});

test('readJoypad rejects holes in required axes and buttons', () => {
  for (const key of ['axes', 'buttons']) {
    const input = pad();
    delete input[key][0];
    assert.throws(() => readJoypad(input), Error, `Sparse ${key}`);
  }
});

test('readJoypad validates only the first four axes and six buttons', () => {
  const input = pad([0, 0, 0, 0, NaN]);
  input.buttons.push(null);
  const result = readJoypad(input);
  positionClose(result, { x: 0, y: 0, z: 0 });
  assert.deepEqual(Object.keys(result).sort(), ['fine', 'hold', 'stop', 'x', 'y', 'z']);
  assert.equal(result.hold, false);
  assert.equal(result.fine, false);
  assert.equal(result.stop, false);
});

test('readJoypad maps buttons independently', () => {
  for (let index = 0; index < 6; index++) {
    const result = readJoypad(pad(undefined, [index]));
    assert.equal(result.hold, index === 5);
    assert.equal(result.fine, index === 4);
    assert.equal(result.stop, index === 1);
  }
});

test('readJoypad remaps the inclusive deadzone and reverses Y and Z', () => {
  for (const [inputIndex, axis, sign] of [[0, 'x', 1], [1, 'y', -1], [3, 'z', -1]]) {
    for (const value of [-1, -0.6, -0.200001, -0.2, -0.1, 0, 0.2, 0.200001, 0.6, 1]) {
      const axes = [0, 0, 0, 0];
      axes[inputIndex] = value;
      const expected = { x: 0, y: 0, z: 0 };
      expected[axis] = Math.abs(value) <= 0.2 ? 0 : sign * Math.sign(value) * (Math.abs(value) - 0.2) / 0.8;
      positionClose(readJoypad(pad(axes)), expected);
    }
  }
  positionClose(readJoypad(pad([0, 0, 1, 0])), { x: 0, y: 0, z: 0 });
});

test('readJoypad normalizes only vectors longer than one', () => {
  positionClose(readJoypad(pad([0.6, -0.6, 0, 0])), { x: 0.5, y: 0.5, z: 0 });
  positionClose(readJoypad(pad([1, -1, 0, -1])), { x: 1 / Math.sqrt(3), y: 1 / Math.sqrt(3), z: 1 / Math.sqrt(3) });
});

test('drive starts disabled; neutral enable and explicit disable never move', async () => {
  const { controller, drive } = setup();
  assert.equal(drive.enabled, false);
  assert.equal(drive.pending, false);
  assert.equal(typeof drive.message, 'string');
  await drive.tick(pad([1, 0, 0, 0], [5]));
  assert.equal(drive.enabled, false);
  drive.enable(pad([0.2, -0.2, 0.2, -0.2], [4]));
  assert.equal(drive.enabled, true);
  assert.equal(drive.pending, false);
  assert.deepEqual(controller.moves, []);
  drive.disable('Manual stop');
  assert.equal(drive.enabled, false);
  assert.equal(drive.message, 'Manual stop');
  drive.enable(pad());
  drive.disable();
  assert.equal(drive.enabled, false);
  assert.equal(typeof drive.message, 'string');
  await drive.tick(pad([1, 0, 0, 0], [5]));
  assert.deepEqual(controller.moves, []);
});

test('enable requires a valid neutral pad, released hold and stop, and a ready controller', () => {
  const cases = malformedPads().map((input) => ({ input }));
  for (let index = 0; index < 4; index++) {
    for (const value of [-0.200001, 0.200001]) {
      const axes = [0, 0, 0, 0];
      axes[index] = value;
      cases.push({ input: pad(axes) });
    }
  }
  cases.push({ input: pad(undefined, [5]) }, { input: pad(undefined, [1]) });
  for (const change of [{ state: 'disconnected' }, { state: 'faulted' }, { state: 'connecting' }, { homed: false }, { busy: true }, { position: null }]) cases.push({ change });
  for (const [caseIndex, entry] of cases.entries()) {
    const { change } = entry;
    const input = Object.hasOwn(entry, 'input') ? entry.input : pad();
    const { controller, drive } = setup();
    Object.assign(controller, change);
    try { drive.enable(input); } catch (error) { assert.ok(error instanceof Error); }
    assert.equal(drive.enabled, false, `Unsafe case ${caseIndex}`);
    assert.deepEqual(controller.moves, []);
  }
});

test('hold gates motion; neutral axes and unused right X do not move', async () => {
  const { controller, drive } = setup();
  drive.enable(pad());
  for (const input of [pad([1, 0, 0, 0]), pad(undefined, [5]), pad([0.2, -0.2, 0, 0.2], [5]), pad([0, 0, 1, 0], [5])]) await drive.tick(input);
  assert.equal(drive.enabled, true);
  assert.deepEqual(controller.moves, []);
});

test('each held tick moves once from the current position at feedrate 600', async () => {
  const { controller, drive } = setup();
  drive.enable(pad());
  await drive.tick(pad([0.6, 0, 0, 0], [5]));
  positionClose(controller.position, { x: 0.5, y: 300, z: 0 });
  controller.position = { x: 10, y: 310, z: 5 };
  await drive.tick(pad([0, 1, 0, 0], [5]));
  positionClose(controller.position, { x: 10, y: 309, z: 5 });
  await drive.tick(pad([0, 0, 0, -1], [4, 5]));
  positionClose(controller.position, { x: 10, y: 309, z: 5.2 });
  await drive.tick(pad([-1, 1, 0, 1], [5]));
  const step = 1 / Math.sqrt(3);
  positionClose(controller.position, { x: 10 - step, y: 309 - step, z: 5.2 - step });
  assert.equal(controller.moves.length, 4);
  assert.ok(controller.moves.every((move) => move.feedrate === 600));
  assert.equal(drive.pending, false);
});

test('unsafe ticks disable and cannot automatically reenable when conditions recover', async () => {
  const cases = malformedPads().map((input) => ({ input }));
  cases.push(
    { options: { focused: false } }, { options: { active: false } },
    { input: { ...pad(), index: 1 } }, { input: { ...pad(), id: 'Replacement' } },
    { input: pad([1, 0, 0, 0], [1, 5]) },
    ...[{ state: 'disconnected' }, { state: 'faulted' }, { homed: false }, { busy: true }].map((change) => ({ change })),
  );
  for (const [caseIndex, entry] of cases.entries()) {
    const { options, change } = entry;
    const input = Object.hasOwn(entry, 'input') ? entry.input : pad([1, 0, 0, 0], [5]);
    const { controller, drive } = setup();
    drive.enable(pad());
    Object.assign(controller, change);
    await drive.tick(input, options);
    assert.equal(drive.enabled, false, `Unsafe case ${caseIndex}`);
    assert.deepEqual(controller.moves, []);
    Object.assign(controller, { state: 'ready', homed: true, busy: false });
    await drive.tick(pad([1, 0, 0, 0], [5]));
    assert.equal(drive.enabled, false, `Unsafe case ${caseIndex}`);
    assert.deepEqual(controller.moves, []);
  }
});

test('enable saves pad identity even if the original pad object changes', async () => {
  for (const key of ['index', 'id']) {
    const { controller, drive } = setup();
    const input = pad();
    drive.enable(input);
    input[key] = key === 'index' ? 9 : 'Another pad';
    input.axes[0] = 1;
    input.buttons[5].pressed = true;
    await drive.tick(input);
    assert.equal(drive.enabled, false);
    assert.deepEqual(controller.moves, []);
  }
});

test('one outstanding move skips overlapping ticks without queuing or treating its busy state as external', async () => {
  const { controller, drive } = setup();
  let finish;
  const waiting = new Promise((resolve) => { finish = resolve; });
  const moveTo = controller.moveTo.bind(controller);
  controller.moveTo = async (...args) => {
    controller.busy = true;
    await moveTo(...args);
    await waiting;
    controller.busy = false;
  };
  drive.enable(pad());
  const first = drive.tick(pad([1, 0, 0, 0], [5]));
  try {
    assert.equal(drive.pending, true);
    await drive.tick(pad([0, -1, 0, 0], [5]));
    await drive.tick(pad([0, 0, 0, -1], [5]));
    assert.equal(drive.enabled, true);
    assert.equal(controller.moves.length, 1);
  } finally {
    finish();
    await first;
  }
  assert.equal(drive.pending, false);
  assert.equal(controller.moves.length, 1);
  await drive.tick(pad([1, 0, 0, 0], [5]));
  assert.equal(controller.moves.length, 2);
  positionClose(controller.position, { x: 2, y: 300, z: 0 });
});

test('full target bounds reject without moving, including unchanged invalid coordinates', async () => {
  for (const [axis, [min, max]] of Object.entries(SIMULATOR_LIMITS)) {
    for (const [edge, direction] of [[min, -1], [max, 1]]) {
      const { controller, drive } = setup();
      drive.enable(pad());
      controller.position[axis] = edge;
      const axes = [0, 0, 0, 0];
      axes[{ x: 0, y: 1, z: 3 }[axis]] = axis === 'x' ? direction : -direction;
      await drive.tick(pad(axes, [5]));
      assert.equal(drive.enabled, false);
      assert.equal(drive.pending, false);
      assert.deepEqual(controller.moves, []);
    }
    const { controller, drive } = setup();
    drive.enable(pad());
    controller.position[axis] = max + 1;
    await drive.tick(pad(axis === 'x' ? [0, -1, 0, 0] : [1, 0, 0, 0], [5]));
    assert.equal(drive.enabled, false);
    assert.deepEqual(controller.moves, []);
  }
});

test('inclusive target bounds permit a move ending exactly at the boundary', async () => {
  const { controller, drive } = setup();
  drive.enable(pad());
  controller.position.x = SIMULATOR_LIMITS.x[1] - 1;
  await drive.tick(pad([1, 0, 0, 0], [5]));
  assert.equal(controller.position.x, SIMULATOR_LIMITS.x[1]);
  assert.equal(controller.moves.length, 1);
  assert.equal(drive.enabled, true);
});

test('move rejection disables, resets pending, and never retries', async () => {
  const { controller, drive } = setup();
  let calls = 0;
  controller.moveTo = async () => { calls++; throw new Error('Transport failed'); };
  drive.enable(pad());
  await drive.tick(pad([1, 0, 0, 0], [5]));
  assert.equal(drive.enabled, false);
  assert.equal(drive.pending, false);
  await drive.tick(pad([1, 0, 0, 0], [5]));
  assert.equal(calls, 1);
  positionClose(controller.position, { x: 0, y: 300, z: 0 });
});

test('focus loss during a pending move disarms without clearing its lock or allowing re-enable', async () => {
  const { controller, drive } = setup();
  let finish;
  controller.moveTo = () => new Promise((resolve) => { finish = resolve; });
  drive.enable(pad());
  const movement = drive.tick(pad([1, 0, 0, 0], [5]));
  await drive.tick(pad(), { focused: false });
  assert.equal(drive.enabled, false);
  assert.equal(drive.pending, true);
  assert.throws(() => drive.enable(pad()), /wait/i);
  finish(); await movement;
  assert.equal(drive.pending, false);
  assert.equal(drive.enabled, false);
});

test('speed percentage scales normal and fine steps and feed rate; changes affect subsequent steps', async () => {
  for (const percent of [10, 55, 100]) {
    for (const fine of [false, true]) {
      const { controller, drive } = setup();
      drive.enable(pad());
      await drive.tick(pad([1, 0, 0, 0], fine ? [4, 5] : [5]), { speedPercent: percent });
      close(controller.position.x, (fine ? 0.2 : 1) * percent / 100);
      close(controller.moves[0].feedrate, 600 * percent / 100);
      await drive.tick(pad([1, 0, 0, 0], [5]), { speedPercent: 10 });
      close(controller.moves[1].position.x - controller.moves[0].position.x, 0.1);
      assert.equal(controller.moves[1].feedrate, 60);
    }
  }
});

test('invalid speed disarms without sending a move', async () => {
  for (const speedPercent of [0, 9.9, 100.1, Infinity, NaN, null, '50']) {
    const { controller, drive } = setup();
    drive.enable(pad());
    await drive.tick(pad([1, 0, 0, 0], [5]), { speedPercent });
    assert.equal(drive.enabled, false);
    assert.deepEqual(controller.moves, []);
  }
});


test('configured maximum clamps to simulator limits and scales percentage, steps and fine mode', async () => {
  for (const [maxSpeed, expectedMaximum] of [[0, 600], [600, 600], [2000, 2000], [3000, 3000], [120000, 3000]]) {
    assert.equal(clampJoypadMaxSpeed(maxSpeed), expectedMaximum);
    for (const speedPercent of [10, 50, 100]) {
      for (const fine of [false, true]) {
        const { controller, drive } = setup();
        drive.enable(pad());
        await drive.tick(pad([1, 0, 0, 0], fine ? [4, 5] : [5]), { maxSpeed, speedPercent });
        close(controller.moves[0].feedrate, expectedMaximum * speedPercent / 100);
        close(controller.position.x, (fine ? 0.2 : 1) * expectedMaximum / 600 * speedPercent / 100);
        assert.ok(controller.moves[0].feedrate >= 60 && controller.moves[0].feedrate <= 3000);
      }
    }
  }
});

test('invalid maximum disarms without issuing a move; high-speed targets still enforce bounds', async () => {
  for (const maxSpeed of [NaN, Infinity, -Infinity, null, '2000']) {
    assert.throws(() => clampJoypadMaxSpeed(maxSpeed), /finite/);
    const { controller, drive } = setup(); drive.enable(pad());
    await drive.tick(pad([1, 0, 0, 0], [5]), { maxSpeed });
    assert.equal(drive.enabled, false);
    assert.deepEqual(controller.moves, []);
  }
  const { controller, drive } = setup(); drive.enable(pad());
  controller.position.x = 148;
  await drive.tick(pad([1, 0, 0, 0], [5]), { maxSpeed: 3000 });
  assert.equal(drive.enabled, false);
  assert.deepEqual(controller.moves, []);
});
