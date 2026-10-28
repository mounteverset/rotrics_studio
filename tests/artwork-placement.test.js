import assert from 'node:assert/strict';
import { defaultProject, validateProject, drawingStrokes, drawingCommands } from '../src/core/project.js';
import { defaultWriting } from '../src/core/writing.js';
const artwork = { name: 'Triangle', strokes: [[{ x: -.5, y: -.25 }, { x: .5, y: -.25 }, { x: 0, y: .25 }, { x: -.5, y: -.25 }]] };
const base = { ...defaultProject(), artwork };
assert.deepEqual(validateProject(base), base);
assert.deepEqual(drawingCommands(base), drawingCommands({ ...base, artwork: { ...artwork, x: 0, y: 0, rotation: 0 } }));
const writing = { id: 'label', x: -50, y: 30, writing: { ...defaultWriting(), text: 'HI' } };
for (const rotation of [-180, -90, 45, 90, 180]) {
  const transformed = validateProject({ ...base, version: 2, texts: [writing], artwork: { ...artwork, x: 30, y: -10, rotation } });
  const expected = artwork.strokes[0].map(({ x, y }) => {
    const a = rotation * Math.PI / 180;
    return { x: 30 + (x * Math.cos(a) - y * Math.sin(a)) * base.size,
      y: 270 + (x * Math.sin(a) + y * Math.cos(a)) * base.size, z: 0 };
  });
  assert.deepEqual(drawingStrokes(transformed)[0], expected);
  assert.deepEqual(drawingStrokes(transformed).slice(1), drawingStrokes({ ...base, version: 2, texts: [writing], artwork: undefined }));
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(transformed))), transformed);
  assert.ok(drawingCommands(transformed).some((command) => command.includes(`X${expected[0].x.toFixed(3)} Y${expected[0].y.toFixed(3)}`)));
}
for (const key of ['x', 'y', 'rotation']) {
  for (const value of [NaN, Infinity, '0', null, 999, -999]) assert.throws(() => validateProject({ ...base, artwork: { ...artwork, [key]: value } }), /Artwork/);
}
assert.throws(() => validateProject({ ...base, artwork: { ...artwork, x: 140 } }), /X must/);
assert.throws(() => validateProject({ ...base, artwork: { ...artwork, y: 90, rotation: 90 } }), /Y must/);
console.log('SVG placement preserves legacy output, transforms paths, round-trips with text and enforces bounds');
