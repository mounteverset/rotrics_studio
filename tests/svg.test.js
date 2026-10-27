import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePath, parseTransform, normalizeStrokes } from '../src/core/svg.js';

test('path parser handles implicit lines, relative moves, closure, and separate strokes', () => {
  const strokes = parsePath('M10 20 30 40 h5 v-10 z m10 0 l5 0');
  assert.equal(strokes.length, 2);
  assert.deepEqual(strokes[0][0], [{ x: 10, y: 20 }, { x: 30, y: 40 }]);
  assert.deepEqual(strokes[0].at(-1).at(-1), { x: 10, y: 20 });
  assert.deepEqual(strokes[1][0], [{ x: 20, y: 20 }, { x: 25, y: 20 }]);
});

test('path numbers support decimals, adjacent signs, and scientific notation', () => {
  assert.deepEqual(parsePath('m.5-.5 1e1,2.')[0][0], [{ x: .5, y: -.5 }, { x: 10.5, y: 1.5 }]);
});

test('smooth cubic and quadratic commands reflect only compatible control points', () => {
  const cubic = parsePath('M0 0 C0 10 10 10 10 0 s10 -10 10 0')[0];
  assert.deepEqual(cubic[1], [{ x: 10, y: 0 }, { x: 10, y: -10 }, { x: 20, y: -10 }, { x: 20, y: 0 }]);
  const quad = parsePath('M0 0 q5 10 10 0 t10 0 l1 1 t5 5')[0];
  assert.deepEqual(quad[1][1], { x: 15, y: -10 });
  assert.deepEqual(quad[3][1], quad[3][0]);
});

test('malformed, missing, unsupported, and excessive path commands fail explicitly', () => {
  for (const source of ['L0 0', 'M0', 'M0 0 L1', 'M0 0 A1 1 0 0 0 5 5', 'M0 0 R1 1', 'M0 0 L1/2', 'M0 0 Z 2 2', 'M0 0 L1e999 0']) {
    assert.throws(() => parsePath(source), Error, source);
  }
  assert.throws(() => parsePath(`M0 0 ${'l1 0 '.repeat(2001)}`), /complex/);
});

test('transform composition preserves SVG order and rotation center', () => {
  assert.deepEqual(parseTransform('translate(10,20) scale(2)'), [2, 0, 0, 2, 10, 20]);
  const matrix = parseTransform('rotate(90 10 20)');
  assert.ok(Math.abs(matrix[0] * 10 + matrix[2] * 20 + matrix[4] - 10) < 1e-8);
  assert.ok(Math.abs(matrix[1] * 10 + matrix[3] * 20 + matrix[5] - 20) < 1e-8);
  for (const source of ['scale()', 'skewX(10)', 'translate(10px)', 'translate(1) garbage', 'matrix(1 0 0 1 0 Infinity)']) {
    assert.throws(() => parseTransform(source));
  }
});

test('normalization centers geometry, preserves aspect ratio, flips SVG Y, and retains pen breaks', () => {
  const strokes = normalizeStrokes(parsePath('M0 0 L100 0 M100 50 L0 50'));
  assert.deepEqual(strokes, [
    [{ x: -.5, y: .25 }, { x: .5, y: .25 }],
    [{ x: .5, y: -.25 }, { x: -.5, y: -.25 }],
  ]);
});

test('curve flattening preserves endpoints and actual curve extent', () => {
  const [curve] = normalizeStrokes(parsePath('M0 0 C0 100 100 100 100 0'));
  assert.ok(curve.length > 10);
  assert.equal(curve[0].x, -.5);
  assert.equal(curve.at(-1).x, .5);
  assert.ok(Math.abs(Math.max(...curve.map((p) => p.y)) - .375) < .001);
  assert.ok(Math.abs(Math.min(...curve.map((p) => p.y)) + .375) < .001);
});

test('collinear curves with backtracking retain excursions beyond the endpoints', () => {
  const [curve] = normalizeStrokes(parsePath('M0 0 C100 0 -100 0 0 0'));
  assert.ok(curve.length > 4);
  assert.equal(Math.min(...curve.map((p) => p.x)), -.5);
  assert.equal(Math.max(...curve.map((p) => p.x)), .5);
});

test('empty, zero-length, and excessive coordinates fail normalization', () => {
  for (const path of ['', 'M1 1', 'M1 1 L1 1', 'M0 0 L1e10 0']) {
    assert.throws(() => normalizeStrokes(parsePath(path)));
  }
});
