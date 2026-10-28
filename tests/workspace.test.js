import test from 'node:test';
import assert from 'node:assert/strict';
import { penReachAtHeight } from '../src/core/workspace.js';

test('pen reach matches source endpoints and zero height with pen offset and margin', () => {
  assert.deepEqual(penReachAtHeight(-127), { outerRadius: 341.8, innerRadius: 241.8 });
  assert.deepEqual(penReachAtHeight(167), { outerRadius: 303.8, innerRadius: 222.2 });
  assert.deepEqual(penReachAtHeight(0), { outerRadius: 412, innerRadius: 186.9 });
});

test('pen reach interpolates between source samples before applying offset and margin', () => {
  const at99 = penReachAtHeight(99);
  const at101 = penReachAtHeight(101);
  assert.ok(Math.abs(at99.outerRadius - (277.7 + 114 - 2)) < 1e-10);
  assert.ok(Math.abs(at99.innerRadius - (101.1 + 114 + 2)) < 1e-10);
  assert.ok(Math.abs(at101.outerRadius - (276.6 + 114 - 2)) < 1e-10);
  assert.ok(Math.abs(at101.innerRadius - (101.8 + 114 + 2)) < 1e-10);
  const reach = penReachAtHeight(100);
  assert.ok(Math.abs(reach.outerRadius - 389.15) < 1e-10);
  assert.ok(Math.abs(reach.innerRadius - 217.45) < 1e-10);
  assert.ok(Math.abs(reach.outerRadius - (at99.outerRadius + at101.outerRadius) / 2) < 1e-10);
  assert.ok(Math.abs(reach.innerRadius - (at99.innerRadius + at101.innerRadius) / 2) < 1e-10);
});

test('pen reach returns null outside its height bounds and for nonfinite or nonnumber input', () => {
  for (const value of [-127.000001, 167.000001, -1000, 1000, NaN, Infinity, -Infinity,
    null, undefined, '0', '', false, true, [], {}, new Number(0), 0n]) {
    assert.equal(penReachAtHeight(value), null);
  }
});

test('pen reach has finite positive ordered radii across the inclusive height range', () => {
  for (let quarter = -127 * 4; quarter <= 167 * 4; quarter++) {
    const z = quarter / 4;
    const reach = penReachAtHeight(z);
    assert.ok(reach, `Missing reach at Z=${z}`);
    assert.ok(Number.isFinite(reach.innerRadius), `Nonfinite inner radius at Z=${z}`);
    assert.ok(Number.isFinite(reach.outerRadius), `Nonfinite outer radius at Z=${z}`);
    assert.ok(reach.innerRadius > 0 && reach.innerRadius < reach.outerRadius, `Unordered radii at Z=${z}`);
  }
});
