import test from 'node:test';
import assert from 'node:assert/strict';
import { hatchStrokes, optimizeStrokes, drawingMetrics, boundaryCommands } from '../src/core/drawing-plan.js';

const p = (x, y, z = 0) => ({ x, y, z });
const rect = (x, y, width, height, z = 0) => [p(x, y, z), p(x + width, y, z), p(x + width, y + height, z), p(x, y + height, z), p(x, y, z)];
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('even-odd hatch preserves holes regardless of winding and copies first Z', () => {
  const strokes = [rect(0, 0, 10, 10, 3), rect(3, 3, 4, 4, 7)];
  const before = structuredClone(strokes);
  const hatch = hatchStrokes(strokes, 1);
  assert.deepEqual(hatch.filter((s) => s[0].y === 4), [[p(0, 4, 3), p(3, 4, 3)], [p(7, 4, 3), p(10, 4, 3)]]);
  assert.deepEqual(hatchStrokes([strokes[0], [...strokes[1]].reverse()], 1), hatch);
  assert.deepEqual(strokes, before);
  assert.ok(hatch.every((s) => s.length === 2 && s.every((v) => v.z === 3)));
  assert.deepEqual(hatchStrokes([strokes[0], strokes[0]], 1), []);
});

test('angled hatch follows angle, stays within rotated contours and preserves holes', () => {
  const angle = 37, c = Math.cos(angle * Math.PI / 180), s = Math.sin(angle * Math.PI / 180);
  const rotate = ({ x, y, z }) => p(x * c - y * s, x * s + y * c, z);
  const inverse = ({ x, y }) => p(x * c + y * s, -x * s + y * c);
  const hatch = hatchStrokes([rect(0, 0, 10, 10), rect(3, 3, 4, 4)].map((r) => r.map(rotate)), 1, angle);
  assert.ok(hatch.length > 0);
  for (const stroke of hatch) {
    const [a, b] = stroke.map(inverse);
    close(a.y, b.y);
    assert.ok(a.x >= -1e-9 && b.x <= 10 + 1e-9 && a.y >= -1e-9 && a.y <= 10 + 1e-9);
    if (a.y > 3 + 1e-9 && a.y < 7 - 1e-9) assert.ok(b.x <= 3 + 1e-9 || a.x >= 7 - 1e-9);
  }
  for (const angle of [-180, -90, 0, 90, 180]) assert.ok(hatchStrokes([rect(0, 0, 10, 10)], 2, angle).length > 0);
});

test('hatch rejects open, degenerate, invalid and excessive input/output early', () => {
  for (const strokes of [[[p(0, 0), p(1, 1)]], [[p(0, 0), p(1, 0), p(2, 0), p(0, 0)]], [[p(0, 0), p(Infinity, 0)]]]) {
    assert.throws(() => hatchStrokes(strokes));
  }
  for (const spacing of [0, 0.49, 20.01, NaN]) assert.throws(() => hatchStrokes([], spacing));
  for (const angle of [-181, 181, Infinity]) assert.throws(() => hatchStrokes([], 2, angle));
  assert.throws(() => hatchStrokes([rect(0, 0, 10, 201)], 1), /200 strokes/);
  assert.throws(() => hatchStrokes([rect(0, 0, 1, 1e12)], 0.5), /complexity/);
  assert.throws(() => hatchStrokes(Array(201).fill(rect(0, 0, 1, 1))), /200 strokes/);
  assert.throws(() => hatchStrokes([Array(2001).fill(p(0, 0))]), /2000/);
  assert.equal(hatchStrokes([rect(0, 0, 1, 100)], 0.5).length, 200);
  assert.deepEqual(hatchStrokes([]), []);
});

test('optimization is deterministic, reversible, independent and never increases travel', () => {
  const strokes = [[p(9, 0), p(8, 0)], [p(5, 0), p(1, 0)], rect(10, 0, 2, 2)];
  const before = structuredClone(strokes);
  const result = optimizeStrokes(strokes, p(0, 0));
  assert.deepEqual(result[0], [p(1, 0), p(5, 0)]);
  assert.deepEqual(result, optimizeStrokes(strokes, p(0, 0)));
  assert.deepEqual(result[2][0], result[2].at(-1));
  assert.deepEqual(strokes, before);
  assert.ok(drawingMetrics(result, p(0, 0), 600, 600, 1).travelDistance <= drawingMetrics(strokes, p(0, 0), 600, 600, 1).travelDistance);
  result[0][0].x = 999;
  assert.deepEqual(strokes, before);
  // Greedy chooses -3 first, then has to cross back from +3.
  const fallback = [[p(-5, 0), p(-4, 0)], [p(-3, 0), p(3, 0)]];
  assert.deepEqual(optimizeStrokes(fallback, p(0, 0)), fallback);
  assert.deepEqual(optimizeStrokes([], p(0, 0)), []);
});

test('metrics use XYZ drawing, origin XY approach, two lifts per stroke and no home return', () => {
  const strokes = [[p(3, 4), p(3, 4, 12)], [p(6, 8, 12), p(9, 12, 12)]];
  const metrics = drawingMetrics(strokes, p(0, 0, 99), 60, 120, 2);
  close(metrics.seconds, 22.8);
  assert.deepEqual({ ...metrics, seconds: 22.8 }, {
    drawDistance: 17, travelDistance: 10, liftDistance: 8, seconds: 22.8, strokeCount: 2, pointCount: 4,
  });
  assert.deepEqual(drawingMetrics([], p(0, 0), 600, 600, 0), {
    drawDistance: 0, travelDistance: 0, liftDistance: 0, seconds: 0, strokeCount: 0, pointCount: 0,
  });
});

test('boundary commands lift first and trace a closed absolute rectangle entirely at clearance', () => {
  const strokes = [[p(-2, 280, -5), p(4, 290, 2)]];
  const before = structuredClone(strokes);
  assert.deepEqual(boundaryCommands(strokes, p(10, 300, 3), 1200, 5), [
    'G21', 'G90', 'G1 Z8.000 F600', 'G1 X-2.000 Y280.000 Z8.000 F1200',
    'G1 X4.000 Y280.000 Z8.000 F1200', 'G1 X4.000 Y290.000 Z8.000 F1200',
    'G1 X-2.000 Y290.000 Z8.000 F1200', 'G1 X-2.000 Y280.000 Z8.000 F1200', 'M400',
  ]);
  assert.deepEqual(strokes, before);
  assert.throws(() => boundaryCommands([], p(0, 0), 600, 1), /nonempty/);
});

test('public functions reject nonfinite points and invalid motion parameters', () => {
  const strokes = [[p(0, 0), p(1, 1)]];
  for (const bad of [null, p(NaN, 0), { x: 0, y: 0 }]) {
    assert.throws(() => optimizeStrokes(strokes, bad));
    assert.throws(() => drawingMetrics(strokes, bad, 600, 600, 1));
    assert.throws(() => boundaryCommands(strokes, bad, 600, 1));
  }
  for (const bad of [0, -1, NaN, Infinity, '600']) {
    assert.throws(() => drawingMetrics(strokes, p(0, 0), bad, 600, 1));
    assert.throws(() => drawingMetrics(strokes, p(0, 0), 600, bad, 1));
    assert.throws(() => boundaryCommands(strokes, p(0, 0), bad, 1));
  }
  for (const bad of [-1, NaN, Infinity]) {
    assert.throws(() => drawingMetrics(strokes, p(0, 0), 600, 600, bad));
    assert.throws(() => boundaryCommands(strokes, p(0, 0), 600, bad));
  }
});
