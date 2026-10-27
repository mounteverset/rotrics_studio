import test from 'node:test';
import assert from 'node:assert/strict';
import { curvePath, planStrokes } from '../scripts/centerline-geometry.js';

// Compare undirected geometry while allowing either traversal direction and stroke order.
function geometry(curves) {
  return curves.map((curve) => [JSON.stringify(curve), JSON.stringify([...curve].reverse())].sort()[0]).sort();
}

function assertConsumed(result, expected) {
  assert.equal(result.edges, expected.length);
  assert.deepEqual(geometry(result.strokes.flat()), geometry(expected));
  for (const stroke of result.strokes) {
    assert.ok(stroke.length > 0);
    for (let i = 1; i < stroke.length; i++) {
      assert.deepEqual(stroke[i - 1].at(-1), stroke[i][0]);
    }
  }
}

test('curvePath serializes lines, quadratics, and cubics in a connected path', () => {
  assert.equal(curvePath([
    [[0, 1], [2, 3]],
    [[2, 3], [4, 5], [6, 7]],
    [[6, 7], [8, 9], [10, 11], [12, 13]],
  ]), 'M0 1L2 3Q4 5 6 7C8 9 10 11 12 13');
  assert.equal(curvePath([[[1.123456, -2.5], [3, 4.000001]]]), 'M1.12346 -2.5L3 4');
  assert.equal(curvePath([]), '');
});

test('planStrokes joins a straight two-edge chain into one continuous stroke', () => {
  const curves = [[[1, 0], [2, 0]], [[1, 0], [0, 0]]];
  const result = planStrokes(curves);
  assert.equal(result.strokes.length, 1);
  assert.equal(result.components, 1);
  assert.equal(result.cycles, 0);
  assertConsumed(result, curves);
  assert.deepEqual([result.strokes[0][0][0], result.strokes[0].at(-1).at(-1)].sort(), [[0, 0], [2, 0]]);
});

const tee = [[[-1, 0], [0, 0]], [[0, 0], [1, 0]], [[0, 0], [0, 1]]];

test('a T graph produces two strokes and consumes every edge exactly once', () => {
  const result = planStrokes(tee);
  assert.equal(result.strokes.length, 2);
  assert.equal(result.components, 1);
  assert.equal(result.cycles, 0);
  assertConsumed(result, tee);
  const bar = result.strokes.find((stroke) => stroke.length === 2);
  assert.ok(bar);
  assert.deepEqual(geometry(bar), geometry(tee.slice(0, 2)));
});

test('reversed duplicate lines and Bezier curves are eliminated', () => {
  const curves = [
    [[0, 0], [1, 0]],
    [[1, 0], [2, 1], [3, 0]],
    [[3, 0], [4, 1], [5, -1], [6, 0]],
  ];
  const result = planStrokes([...curves, ...curves.map((curve) => [...curve].reverse())]);
  assert.equal(result.strokes.length, 1);
  assertConsumed(result, curves);
});

test('a closed square produces one closed stroke and one cycle', () => {
  const square = [
    [[0, 0], [1, 0]], [[1, 0], [1, 1]],
    [[1, 1], [0, 1]], [[0, 1], [0, 0]],
  ];
  const result = planStrokes(square);
  assert.equal(result.strokes.length, 1);
  assert.equal(result.components, 1);
  assert.equal(result.cycles, 1);
  assertConsumed(result, square);
  assert.deepEqual(result.strokes[0][0][0], result.strokes[0].at(-1).at(-1));
});

test('a disconnected stem and short dot segment form two components', () => {
  const curves = [[[0, 0], [0, 3]], [[0, 4], [0, 4.1]]];
  const result = planStrokes(curves);
  assert.equal(result.components, 2);
  assert.equal(result.strokes.length, 2);
  assert.equal(result.cycles, 0);
  assertConsumed(result, curves);
});

test('planStrokes rejects nonfinite coordinates and malformed geometry', () => {
  for (const curve of [
    [[0, 0], [NaN, 1]], [[0, Infinity], [1, 1]],
    [[0, 0], [1, -Infinity]], [[0, 0]],
    [[0, 0], [1]], [[0, 0], [1, 2, 3]],
    [[0, 0], ['1', 2]], [[0, 0], null],
    [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4]],
  ]) {
    assert.throws(() => planStrokes([curve]), /invalid geometry/);
  }
});

test('every T-junction edge ordering preserves all edges', () => {
  for (const order of [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]) {
    const result = planStrokes(order.map((index) => tee[index]));
    assert.equal(result.strokes.length, 2);
    assert.equal(result.components, 1);
    assert.equal(result.cycles, 0);
    assertConsumed(result, tee);
  }
});

test('planning and serialization preserve original curve inputs', () => {
  const curves = [
    [[0, 0], [1, 0]],
    [[3, 0], [2, 1], [1, 0]],
    [[3, 0], [4, 1], [5, -1], [6, 0]],
  ];
  const original = structuredClone(curves);
  const result = planStrokes(curves);
  assertConsumed(result, original);
  assert.equal(result.strokes.length, 1);
  assert.deepEqual(curves, original);
  curvePath(curves);
  for (const stroke of result.strokes) curvePath(stroke);
  assert.deepEqual(curves, original);
});
