import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultProject, validateProject, layoutProject, textBounds, drawingStrokes, drawingCommands } from '../src/core/project.js';
import { defaultWriting } from '../src/core/writing.js';

const text = (id, x = 0, y = 0) => ({ id, x, y, writing: { ...defaultWriting(), text: 'HI' } });
const layout = () => ({ ...defaultProject(), version: 2, texts: [text('a', -30, 20), text('b', 40, -25)] });

test('multiple text boxes preserve individual settings and positions on save/load', () => {
  const value = layout();
  value.texts[1].writing = { ...value.texts[1].writing, fontSize: 5, align: 'right', text: 'I\nHI' };
  const before = structuredClone(value);
  const actual = validateProject(JSON.parse(JSON.stringify(value)));
  assert.deepEqual(actual, before);
  assert.notStrictEqual(actual.texts[0].writing, value.texts[0].writing);
  assert.deepEqual(value, before);
  assert.deepEqual(drawingCommands(actual), drawingCommands(value));
});

test('moving one text translates only that text, with shared contact Z and lifts', () => {
  const value = layout();
  const before = drawingStrokes(value);
  value.texts[1].x += 10; value.texts[1].y -= 5;
  const after = drawingStrokes(validateProject(value));
  assert.deepEqual(after.slice(0, 3), before.slice(0, 3));
  const count = drawingStrokes({ ...value, texts: [value.texts[0]] }).length;
  assert.deepEqual(after.slice(count), before.slice(count).map((stroke) => stroke.map((p) => ({ ...p, x: p.x + 10, y: p.y - 5 }))));
  assert.equal(drawingCommands(value).filter((c) => c === 'G1 Z10.000 F600').length, after.length + 1);
});

test('legacy writing upgrades without any path changes; legacy star still compiles identically', () => {
  const old = { ...defaultProject(), writing: defaultWriting() };
  assert.deepEqual(drawingCommands(layoutProject(old)), drawingCommands(old));
  assert.deepEqual(validateProject(old), old);
  assert.equal(layoutProject(defaultProject()).texts.length, 0);
  assert.equal(drawingStrokes(defaultProject())[0].length, 11);
});

test('imported SVG and text combine in stable artwork-first order', () => {
  const value = layout();
  const artwork = { name: 'Line', strokes: [[{ x: -.5, y: 0 }, { x: .5, y: 0 }]] };
  const actual = validateProject({ ...value, artwork });
  assert.deepEqual(drawingStrokes(actual), [...drawingStrokes({ ...defaultProject(), artwork }), ...drawingStrokes(value)]);
});

test('rejects malformed boxes, mixed versions, duplicate IDs, unsafe positions and total complexity', () => {
  for (const texts of [null, {}, [null], [{ ...text('a'), x: NaN }], [{ ...text('a'), y: '1' }],
    [text('a'), text('a')], [text('<script>')], [text('a', 149)], [text('a', 0, 100)],
    Array.from({ length: 21 }, (_, i) => text(`t${i}`))]) {
    assert.throws(() => validateProject({ ...layout(), texts }));
  }
  assert.throws(() => validateProject({ ...defaultProject(), texts: [] }), /version 2/);
  assert.throws(() => validateProject({ ...layout(), writing: defaultWriting() }), /text boxes/);
  assert.throws(() => validateProject({ ...layout(), origin: { x: 0, y: 280, z: 95 } }), /between/);
  assert.throws(() => validateProject({ ...layout(), texts: Array.from({ length: 20 }, (_, i) => ({ ...text(`t${i}`), writing: { ...defaultWriting(), text: 'H'.repeat(10) } })) }), /exceeds/);
});

test('empty layouts remain editable but cannot generate a job', () => {
  const value = { ...layout(), texts: [] };
  assert.deepEqual(validateProject(value), value);
  assert.deepEqual(drawingStrokes(value), []);
  assert.throws(() => drawingCommands(value), /Add text or import artwork/);
});

test('selection bounds include actual glyph overhangs and logical multiline space', () => {
  const value = layout();
  value.texts[0].writing = { ...defaultWriting(), text: 'HI\nI\n', align: 'right' };
  const bounds = textBounds(value.texts[0], value.origin);
  const points = drawingStrokes({ ...value, texts: [value.texts[0]] }).flat();
  assert.ok(points.every((p) => p.x >= bounds.left && p.x <= bounds.right && p.y >= bounds.bottom && p.y <= bounds.top));
  assert.ok(bounds.top - bounds.bottom >= 40);
});
