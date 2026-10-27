import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultProject, validateProject, drawingCommands, drawingStrokes } from '../src/core/project.js';

test('drawing settings independently control work, travel, and clearance and survive saving', () => {
  const project = { ...defaultProject(), feedrate: 900, travelFeedrate: 1800, penLift: 5.5 };
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(project))), project);
  const commands = drawingCommands(project);
  assert.equal(commands[2], 'G1 Z5.500 F600');
  assert.match(commands[3], /Z5\.500 F1800$/);
  assert.match(commands[4], /Z0\.000 F900$/);
  assert.equal(commands.at(-2), 'G1 Z5.500 F600');
  assert.deepEqual(drawingStrokes(project), drawingStrokes(defaultProject()));
});

test('optional motion settings preserve legacy defaults and validate the entire lifted path', () => {
  const legacy = defaultProject();
  assert.deepEqual(validateProject(legacy), legacy);
  assert.match(drawingCommands(legacy)[2], /Z10\.000/);
  assert.match(drawingCommands(legacy)[3], /F1200$/);
  for (const [key, invalid] of [['travelFeedrate', [59, 3001, NaN, '600', null]], ['penLift', [0, 30.1, Infinity, '5', null]]]) {
    for (const value of invalid) assert.throws(() => validateProject({ ...legacy, [key]: value }));
  }
  const high = { ...legacy, origin: { x: 0, y: 280, z: 80 }, penLift: 20 };
  assert.doesNotThrow(() => validateProject(high));
  assert.throws(() => validateProject({ ...high, penLift: 20.01 }), /Z must/);
});
