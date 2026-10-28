import assert from 'node:assert/strict';
import { defaultProject, validateProject, drawingStrokes, drawingCommands, textBounds } from '../src/core/project.js';
import { defaultWriting } from '../src/core/writing.js';

const original = { id: 'label', x: 10, y: 0, writing: { ...defaultWriting(), text: 'TEST' } };
const base = { ...defaultProject(), version: 2, texts: [original] };
const plain = validateProject(base);
assert.deepEqual(validateProject({ ...base, texts: [{ ...original, rotation: 0 }] }).texts[0].rotation, 0);
assert.deepEqual(drawingCommands(plain), drawingCommands({ ...base, texts: [{ ...original, rotation: 0 }] }));
for (const angle of [-180, -90, 45, 90, 180]) {
  const rotated = validateProject({ ...base, texts: [{ ...original, rotation: angle }] });
  const a = drawingStrokes(plain).flat();
  const b = drawingStrokes(rotated).flat();
  const radians = angle * Math.PI / 180;
  a.forEach((point, i) => {
    const x = point.x - base.origin.x - original.x;
    const y = point.y - base.origin.y - original.y;
    assert.ok(Math.abs(b[i].x - (base.origin.x + original.x + x * Math.cos(radians) - y * Math.sin(radians))) < 1e-9);
    assert.ok(Math.abs(b[i].y - (base.origin.y + original.y + x * Math.sin(radians) + y * Math.cos(radians))) < 1e-9);
  });
  const bounds = textBounds(rotated.texts[0], rotated.origin);
  b.forEach((point) => assert.ok(point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.bottom && point.y <= bounds.top));
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(rotated))), rotated);
  assert.notDeepEqual(drawingCommands(rotated), drawingCommands(plain));
}
for (const rotation of [NaN, Infinity, -181, 181, '45', null]) {
  assert.throws(() => validateProject({ ...base, texts: [{ ...original, rotation }] }), /rotation/);
}
const edge = { ...original, y: 95 };
assert.doesNotThrow(() => validateProject({ ...base, texts: [edge] }));
assert.throws(() => validateProject({ ...base, texts: [{ ...edge, rotation: 90 }] }), /Y must/);
assert.equal(Object.hasOwn(plain.texts[0], 'rotation'), false);
console.log('Text rotations preserve legacy output, transform paths and bounds, serialize and reject out-of-range motion');
