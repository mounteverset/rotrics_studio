import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_ARTWORK_POINTS, MAX_ARTWORK_STROKES, SIMULATOR_LIMITS,
  defaultProject, drawingCommands, drawingPoints, drawingStrokes,
  validatePosition, validateProject,
} from '../src/core/project.js';

test('default projects are valid and have independent origins', () => {
  const project = defaultProject();
  assert.deepEqual(validateProject(project), project);
  assert.equal(project.version, 1);
  assert.equal(project.name, 'First light');
  const other = defaultProject();
  project.origin.x = 20;
  assert.equal(other.origin.x, 0);
});

test('drawing points form a closed ten-vertex star at the requested origin and size', () => {
  const project = { ...defaultProject(), size: 40, origin: { x: 10, y: 270, z: 5 } };
  const points = drawingPoints(project);
  assert.equal(points.length, 11);
  assert.ok(Math.abs(points[0].x - 10) < 1e-10);
  assert.equal(points[0].y, 290);
  assert.deepEqual(points[10], points[0]);
  assert.notStrictEqual(points[10], points[0]);
  for (const [index, point] of points.slice(0, 10).entries()) {
    assert.ok(Math.abs(Math.hypot(point.x - 10, point.y - 270) - (index % 2 ? 9 : 20)) < 1e-10);
    assert.equal(point.z, 5);
  }
});

test('drawing commands use millimeters, absolute positions, precision, lifts, closure and completion', () => {
  const project = { ...defaultProject(), origin: { x: 0.12345, y: 280.23456, z: 1.23456 }, feedrate: 987 };
  const commands = drawingCommands(project);
  assert.equal(commands.length, 17);
  assert.deepEqual(commands.slice(0, 4), [
    'G21', 'G90', 'G1 Z11.235 F600', 'G1 X0.123 Y320.235 Z11.235 F987',
  ]);
  assert.equal(commands[4], 'G1 X0.123 Y320.235 Z1.235 F987');
  assert.equal(commands[5], 'G1 X-10.457 Y294.797 Z1.235 F987');
  for (const command of commands.slice(4, 15)) {
    assert.match(command, /^G1 X-?\d+\.\d{3} Y-?\d+\.\d{3} Z1\.235 F987$/);
  }
  assert.equal(commands[14], commands[4]);
  assert.deepEqual(commands.slice(-2), ['G1 Z11.235 F600', 'M400']);
});

test('malformed project headers, dimensions, feedrates and origins are rejected', () => {
  const malformed = [null, undefined, {}, [], 'project',
    ...[0, 2, '1', undefined].map((version) => ({ ...defaultProject(), version })),
    ...['', '  ', 'a'.repeat(81), 42, null].map((name) => ({ ...defaultProject(), name })),
    ...[9.999, 140.001, NaN, Infinity, -Infinity, '80', null, undefined].map((size) => ({ ...defaultProject(), size })),
    ...[59.999, 3000.001, NaN, Infinity, -Infinity, '1200', null, undefined].map((feedrate) => ({ ...defaultProject(), feedrate })),
    ...[null, undefined, 'origin', {}, []].map((origin) => ({ ...defaultProject(), origin })),
  ];
  for (const value of malformed) {
    assert.throws(() => validateProject(value), Error);
    assert.throws(() => drawingCommands(value), Error);
  }
  for (const size of [10, 140]) assert.equal(validateProject({ ...defaultProject(), size }).size, size);
  for (const feedrate of [60, 3000]) assert.equal(validateProject({ ...defaultProject(), feedrate }).feedrate, feedrate);
});

test('position bounds are inclusive and reject invalid values on every axis', () => {
  for (const [axis, [min, max]] of Object.entries(SIMULATOR_LIMITS)) {
    for (const value of [min, max]) {
      const position = { ...defaultProject().origin, [axis]: value };
      assert.strictEqual(validatePosition(position), position);
    }
    for (const value of [min - 0.001, max + 0.001, NaN, Infinity, -Infinity, '0', null, undefined]) {
      assert.throws(() => validatePosition({ ...defaultProject().origin, [axis]: value }), new RegExp(axis.toUpperCase()));
      assert.throws(() => validateProject({ ...defaultProject(), origin: { ...defaultProject().origin, [axis]: value } }));
    }
  }
});

test('projects must fit all drawing points and pen-up clearance inside simulator bounds', () => {
  for (const origin of [
    { x: -140, y: 280, z: 0 }, { x: 140, y: 280, z: 0 },
    { x: 0, y: 190, z: 0 }, { x: 0, y: 350, z: 0 },
    { x: 0, y: 280, z: 90.001 },
  ]) {
    validatePosition(origin);
    assert.throws(() => validateProject({ ...defaultProject(), origin }));
    assert.throws(() => drawingCommands({ ...defaultProject(), origin }));
  }
  for (const z of [-20, 90]) {
    const project = { ...defaultProject(), origin: { x: 0, y: 280, z } };
    assert.deepEqual(validateProject(project), project);
    assert.ok(drawingCommands(project).includes(`G1 Z${(z + 10).toFixed(3)} F600`));
  }
});

test('validation sanitizes into fresh objects and drawing functions do not mutate input', () => {
  const input = { ...defaultProject(), name: '  My drawing  ', extra: 'discard',
    origin: { ...defaultProject().origin, extra: 'discard' } };
  const before = structuredClone(input);
  Object.freeze(input.origin);
  Object.freeze(input);
  const sanitized = validateProject(input);
  assert.deepEqual(sanitized, { ...defaultProject(), name: 'My drawing' });
  assert.notStrictEqual(sanitized, input);
  assert.notStrictEqual(sanitized.origin, input.origin);
  drawingPoints(input);
  drawingCommands(input);
  assert.deepEqual(input, before);
  sanitized.origin.x = 20;
  assert.equal(input.origin.x, 0);
});

function importedProject(strokes = [[{ x: -0.5, y: 0.5 }, { x: 0.5, y: -0.5 }]]) {
  return { ...defaultProject(), artwork: { name: 'Imported artwork', strokes } };
}

test('imported strokes scale and translate normalized machine coordinates without flipping Y', () => {
  const project = { ...importedProject([
    [{ x: -0.5, y: 0.5 }, { x: 0, y: -0.25 }],
    [{ x: 0.25, y: 0 }, { x: 0.5, y: -0.5 }],
  ]), size: 40, origin: { x: 10, y: 270, z: 5 } };
  assert.deepEqual(drawingStrokes(validateProject(project)), [
    [{ x: -10, y: 290, z: 5 }, { x: 10, y: 260, z: 5 }],
    [{ x: 20, y: 270, z: 5 }, { x: 30, y: 250, z: 5 }],
  ]);
  assert.deepEqual(drawingPoints(project), drawingStrokes(project).flat());
});

test('artwork validation deep-copies and sanitizes every nested object without mutating input', () => {
  const input = importedProject();
  input.artwork.name = '  Sketch  ';
  input.artwork.extra = 'discard';
  input.artwork.strokes[0][0].z = 99;
  const before = structuredClone(input);
  for (const stroke of input.artwork.strokes) {
    stroke.forEach(Object.freeze);
    Object.freeze(stroke);
  }
  Object.freeze(input.artwork.strokes);
  Object.freeze(input.artwork);
  Object.freeze(input);
  const sanitized = validateProject(input);
  assert.deepEqual(sanitized.artwork, { name: 'Sketch', strokes: importedProject().artwork.strokes });
  assert.notStrictEqual(sanitized.artwork, input.artwork);
  assert.notStrictEqual(sanitized.artwork.strokes, input.artwork.strokes);
  assert.notStrictEqual(sanitized.artwork.strokes[0], input.artwork.strokes[0]);
  assert.notStrictEqual(sanitized.artwork.strokes[0][0], input.artwork.strokes[0][0]);
  drawingStrokes(input);
  drawingPoints(input);
  drawingCommands(input);
  sanitized.artwork.strokes[0][0].x = 0;
  assert.deepEqual(input, before);
});

test('malformed artwork, strokes, points and zero-length geometry are rejected', () => {
  const valid = importedProject().artwork;
  const malformed = [null, false, 42, 'artwork', [], {},
    ...['', '  ', 'a'.repeat(121), 42, null, undefined].map((name) => ({ ...valid, name })),
    ...[null, {}, 'strokes', [], [null], [[]], [[{ x: 0, y: 0 }]], new Array(1)].map((strokes) => ({ ...valid, strokes })),
    ...[null, [], {}, 'point', { x: 0 }, { y: 0 },
      ...['x', 'y'].flatMap((axis) => [NaN, Infinity, -Infinity, '0', null, undefined, -0.50001, 0.50001]
        .map((value) => ({ x: 0, y: 0, [axis]: value }))),
    ].map((point) => ({ ...valid, strokes: [[{ x: 0, y: 0 }, point]] })),
    { ...valid, strokes: [new Array(2)] },
    { ...valid, strokes: [[{ x: 0, y: 0 }, { x: 0, y: 0 }], [{ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }]] },
  ];
  for (const artwork of malformed) {
    const project = { ...defaultProject(), artwork };
    assert.throws(() => validateProject(project), Error);
    assert.throws(() => drawingCommands(project), Error);
  }
  for (const name of ['a', 'a'.repeat(120)]) {
    assert.equal(validateProject({ ...defaultProject(), artwork: { ...valid, name } }).artwork.name, name);
  }
  assert.doesNotThrow(() => validateProject(importedProject([
    [{ x: 0, y: 0 }, { x: 0, y: 0 }], ...valid.strokes,
  ])));
});

test('artwork complexity limits are inclusive and count points across every stroke', () => {
  assert.equal(MAX_ARTWORK_POINTS, 2000);
  assert.equal(MAX_ARTWORK_STROKES, 200);
  const points = (length) => Array.from({ length }, (_, i) => ({ x: i % 2 ? 0.5 : -0.5, y: 0 }));
  const strokes = Array.from({ length: MAX_ARTWORK_STROKES }, () => points(10));
  assert.doesNotThrow(() => validateProject(importedProject(strokes)));
  assert.doesNotThrow(() => validateProject(importedProject([points(MAX_ARTWORK_POINTS)])));
  for (const invalid of [
    [points(MAX_ARTWORK_POINTS + 1)],
    [...strokes.slice(0, -1), points(11)],
    Array.from({ length: MAX_ARTWORK_STROKES + 1 }, () => points(2)),
  ]) {
    assert.throws(() => validateProject(importedProject(invalid)));
    assert.throws(() => drawingCommands(importedProject(invalid)));
  }
});

test('all transformed artwork points and pen-up clearance must fit simulator bounds', () => {
  for (const origin of [
    { x: -110.001, y: 280, z: 0 }, { x: 110.001, y: 280, z: 0 },
    { x: 0, y: 219.999, z: 0 }, { x: 0, y: 340.001, z: 0 },
    { x: 0, y: 280, z: 90.001 },
  ]) {
    const project = { ...importedProject([
      [{ x: 0, y: 0 }, { x: 0.01, y: 0.01 }], ...importedProject().artwork.strokes,
    ]), origin };
    validatePosition(origin);
    assert.throws(() => validateProject(project));
    assert.throws(() => drawingCommands(project));
  }
  for (const x of [-110, 110]) for (const y of [220, 340]) for (const z of [-20, 90]) {
    const project = { ...importedProject(), origin: { x, y, z } };
    assert.deepEqual(validateProject(project), project);
  }
});

test('multi-stroke commands lift before every travel and lower only at the next stroke start', () => {
  const project = importedProject([
    [{ x: -0.5, y: 0.5 }, { x: 0, y: 0 }],
    [{ x: 0.25, y: 0 }, { x: 0.5, y: -0.5 }],
  ]);
  assert.deepEqual(drawingCommands(project), [
    'G21', 'G90', 'G1 Z10.000 F600',
    'G1 X-40.000 Y320.000 Z10.000 F1200',
    'G1 X-40.000 Y320.000 Z0.000 F1200',
    'G1 X0.000 Y280.000 Z0.000 F1200',
    'G1 Z10.000 F600',
    'G1 X20.000 Y280.000 Z10.000 F1200',
    'G1 X20.000 Y280.000 Z0.000 F1200',
    'G1 X40.000 Y240.000 Z0.000 F1200',
    'G1 Z10.000 F600', 'M400',
  ]);
});

test('version 1 projects without artwork retain the exact default star output', () => {
  const project = JSON.parse(JSON.stringify(defaultProject()));
  assert.deepEqual(validateProject(project), project);
  assert.equal(Object.hasOwn(validateProject(project), 'artwork'), false);
  assert.deepEqual(drawingStrokes(project), [drawingPoints(project)]);
  assert.deepEqual(drawingCommands(project), [
    'G21', 'G90', 'G1 Z10.000 F600',
    'G1 X0.000 Y320.000 Z10.000 F1200',
    'G1 X0.000 Y320.000 Z0.000 F1200',
    'G1 X-10.580 Y294.562 Z0.000 F1200',
    'G1 X-38.042 Y292.361 Z0.000 F1200',
    'G1 X-17.119 Y274.438 Z0.000 F1200',
    'G1 X-23.511 Y247.639 Z0.000 F1200',
    'G1 X-0.000 Y262.000 Z0.000 F1200',
    'G1 X23.511 Y247.639 Z0.000 F1200',
    'G1 X17.119 Y274.438 Z0.000 F1200',
    'G1 X38.042 Y292.361 Z0.000 F1200',
    'G1 X10.580 Y294.562 Z0.000 F1200',
    'G1 X0.000 Y320.000 Z0.000 F1200',
    'G1 Z10.000 F600', 'M400',
  ]);
});
