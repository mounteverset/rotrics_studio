import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSequence, validateSequence, sequenceCommands, sequencePoints } from '../src/core/teach.js';
import { SIMULATOR_LIMITS } from '../src/core/project.js';

const move = () => ({ type: 'move', name: 'Point', x: 0, y: 280, z: 0, feedrate: 1200 });
const sequence = (steps = [move()], extra = {}) => ({ ...defaultSequence(), steps, ...extra });

test('defaults permit editing and saving without moves but cannot run', () => {
  assert.deepEqual(defaultSequence(), { version: 1, kind: 'teach', name: 'Teach sequence', tool: 'pen', repeat: 1, steps: [] });
  assert.deepEqual(validateSequence(defaultSequence()), defaultSequence());
  assert.deepEqual(sequencePoints(defaultSequence()), []);
  assert.throws(() => sequenceCommands(defaultSequence()), /move/);
  assert.throws(() => sequenceCommands(sequence([{ type: 'wait', milliseconds: 0 }])), /move/);
  const first = defaultSequence();
  first.steps.push(move());
  assert.deepEqual(defaultSequence().steps, []);
});

test('validation trims names and deep copies without mutating frozen input', () => {
  const input = sequence([{ ...move(), name: ' Point ' }, { type: 'wait', milliseconds: 3 }, { type: 'action', action: 'pick' }], { name: ' Demo ', tool: 'suction' });
  const before = structuredClone(input);
  input.steps.forEach(Object.freeze);
  Object.freeze(input.steps);
  Object.freeze(input);
  const copy = validateSequence(input);
  assert.equal(copy.name, 'Demo');
  assert.equal(copy.steps[0].name, 'Point');
  assert.notStrictEqual(copy.steps, input.steps);
  copy.steps.forEach((step, index) => assert.notStrictEqual(step, input.steps[index]));
  sequenceCommands(input);
  const points = sequencePoints(input);
  points[0].x = 10;
  copy.steps[0].x = 20;
  assert.deepEqual(input, before);
});

test('repeats preserve all step order with three decimal moves and no extra lifts', () => {
  const input = sequence([
    { ...move(), x: 1.23456, y: 280.34567, z: -1.23456, feedrate: 987.65432 },
    { type: 'wait', milliseconds: 0 }, { ...move(), z: 100 }, { type: 'wait', milliseconds: 2000 },
  ], { repeat: 2 });
  const cycle = ['G1 X1.235 Y280.346 Z-1.235 F987.654', 'G4 P0', 'G1 X0.000 Y280.000 Z100.000 F1200.000', 'G4 P2000'];
  assert.deepEqual(sequenceCommands(input), ['G21', 'G90', 'M888 P0', ...cycle, ...cycle, 'M400']);
  assert.deepEqual(sequencePoints(input), [{ x: 1.23456, y: 280.34567, z: -1.23456 }, { x: 0, y: 280, z: 100 }]);
});

test('pneumatic mappings initialize off and clean up once after repeats', () => {
  for (const [tool, mapped] of [['suction', ['M1000', 'M1002', 'M1002', 'M1003']], ['gripper', ['M1001', 'M1000', 'M1002', 'M1003']]]) {
    const input = sequence([move(), ...['pick', 'release', 'neutral', 'off'].map((action) => ({ type: 'action', action }))], { tool, repeat: 2 });
    const cycle = ['G1 X0.000 Y280.000 Z0.000 F1200.000', ...mapped];
    assert.deepEqual(sequenceCommands(input), ['G21', 'G90', 'M888 P2', 'M1003', ...cycle, ...cycle, 'M1002', 'M1003', 'M400']);
  }
});

test('malformed headers and steps reject unknown fields, nulls, types and nonfinite values', () => {
  const invalid = [null, undefined, [], {}, 'teach',
    ...[0, 2, '1', null].map((version) => sequence(undefined, { version })),
    ...['drawing', null, 1].map((kind) => sequence(undefined, { kind })),
    ...['laser', null, {}, 'toString'].map((tool) => sequence(undefined, { tool })),
    ...[0, 21, 1.5, '1', null, NaN, Infinity].map((repeat) => sequence(undefined, { repeat })),
    ...['', ' ', 'a'.repeat(81), null, 1].map((name) => sequence(undefined, { name })),
    ...[null, {}, 'steps', new Array(1)].map((steps) => sequence(steps)),
    sequence(undefined, { extra: true }),
  ];
  const badSteps = [null, [], {}, { type: 'other' }, { ...move(), extra: true },
    ...['', ' ', 'a'.repeat(41), null, 1].map((name) => ({ ...move(), name })),
    ...[59.99, 3000.01, null, undefined, '600', NaN, Infinity, -Infinity].map((feedrate) => ({ ...move(), feedrate })),
    ...[-1, 2001, 0.5, null, undefined, '1', NaN, Infinity].map((milliseconds) => ({ type: 'wait', milliseconds })),
    { type: 'wait', milliseconds: 1, x: 0 }, { type: 'action', action: 'pick', name: 'bad' },
    ...['unknown', 'toString', null, undefined, {}, ['pick']].map((action) => ({ type: 'action', action })),
  ];
  invalid.push(...badSteps.map((step) => sequence([move(), step], { tool: 'suction' })));
  invalid.push(sequence([{ type: 'action', action: 'pick' }]));
  for (const value of invalid) {
    assert.throws(() => validateSequence(value));
    assert.throws(() => sequenceCommands(value));
    assert.throws(() => sequencePoints(value));
  }
});

test('all waypoints must be finite and within inclusive project bounds before compilation', () => {
  for (const [axis, [min, max]] of Object.entries(SIMULATOR_LIMITS)) {
    for (const value of [min, max]) assert.doesNotThrow(() => sequenceCommands(sequence([{ ...move(), [axis]: value }])));
    for (const value of [min - 0.0001, max + 0.0001, null, undefined, '0', NaN, Infinity, -Infinity]) {
      const input = sequence([move(), { ...move(), [axis]: value }]);
      assert.throws(() => validateSequence(input), new RegExp(axis.toUpperCase()));
      assert.throws(() => sequenceCommands(input));
    }
  }
  for (const feedrate of [60, 3000]) assert.doesNotThrow(() => sequenceCommands(sequence([{ ...move(), feedrate }])));
  for (const length of [1, 80]) assert.equal(validateSequence(sequence(undefined, { name: ` ${'a'.repeat(length)} ` })).name.length, length);
  assert.equal(validateSequence(sequence([{ ...move(), name: 'a'.repeat(40) }])).steps[0].name.length, 40);
});

test('step, repeat, total wait and compiled command caps include all cycles and overhead', () => {
  const steps = Array.from({ length: 100 }, move);
  for (const tool of ['pen', 'suction', 'gripper']) {
    const commands = sequenceCommands(sequence(steps, { repeat: 20, tool }));
    assert.equal(commands.length, tool === 'pen' ? 2004 : 2007);
    assert.ok(commands.length <= 4000);
  }
  assert.throws(() => validateSequence(sequence([...steps, move()])));
  const waits = [move(), ...Array.from({ length: 3 }, () => ({ type: 'wait', milliseconds: 2000 }))];
  assert.doesNotThrow(() => sequenceCommands(sequence(waits, { repeat: 20 })));
  assert.throws(() => validateSequence(sequence([...waits, { type: 'wait', milliseconds: 1 }], { repeat: 20 })), /120000/);
  assert.throws(() => sequenceCommands(sequence([move(), ...Array.from({ length: 61 }, () => ({ type: 'wait', milliseconds: 2000 }))])), /120000/);
});
