import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultProject, validateProject, drawingStrokes, drawingCommands } from '../src/core/project.js';
import { defaultWriting } from '../src/core/writing.js';

const writingProject = () => ({ ...defaultProject(), writing: defaultWriting() });

test('writing projects round-trip editable text and settings without serialized geometry', () => {
  const original = writingProject();
  original.writing.text = 'DexArm\nStudio';
  const before = structuredClone(original);
  const project = validateProject(JSON.parse(JSON.stringify(original)));
  assert.deepEqual(project, before);
  assert.notStrictEqual(project.writing, original.writing);
  assert.equal(project.artwork, undefined);
  assert.ok(drawingStrokes(project).length > 5);
});

test('writing geometry uses real letter heights, world origin and its pen contact Z', () => {
  const project = writingProject();
  project.writing = { ...defaultWriting(), text: 'H', fontSize: 10 };
  project.origin = { x: 20, y: 270, z: -2 };
  const points = drawingStrokes(validateProject(project)).flat();
  assert.equal(Math.max(...points.map((p) => p.y)) - Math.min(...points.map((p) => p.y)), 10);
  assert.ok(points.every((p) => p.z === -2 && p.x > 10 && p.x < 30));
  assert.ok(drawingCommands(project).includes('G1 Z8.000 F600'));
});

test('font height is independent of the SVG design size control', () => {
  const project = writingProject();
  const first = drawingStrokes(project);
  project.size = 140;
  assert.deepEqual(drawingStrokes(project), first);
});

test('every text stroke is separated by a lift and no connecting pen-down travel', () => {
  const project = writingProject();
  project.writing.text = 'HI';
  const strokes = drawingStrokes(project);
  const commands = drawingCommands(project);
  const lift = 'G1 Z10.000 F600';
  assert.equal(commands.filter((command) => command === lift).length, strokes.length + 1);
  assert.equal(commands.at(-1), 'M400');
  let index = 3;
  for (const stroke of strokes) {
    assert.match(commands[index], / Z10\.000 /);
    index += stroke.length + 1;
    assert.equal(commands[index++], lift);
  }
  assert.equal(index, commands.length - 1);
});

test('writing validates world limits, clearance, complexity, unsupported text, and mutually exclusive sources', () => {
  const project = writingProject();
  assert.throws(() => validateProject({ ...project, artwork: { name: 'Conflict', strokes: [] } }), /either writing/);
  assert.throws(() => validateProject({ ...project, writing: { ...project.writing, text: '♥' } }), /Unsupported/);
  assert.throws(() => validateProject({ ...project, origin: { x: 149, y: 280, z: 0 } }), /between/);
  assert.throws(() => validateProject({ ...project, origin: { x: 0, y: 280, z: 95 } }), /between/);
  assert.throws(() => validateProject({ ...project, writing: { ...project.writing, text: 'M'.repeat(160) } }), /strokes|points|between/);
  const sanitized = validateProject({ ...project, writing: { ...project.writing, extra: '<script>' } });
  assert.equal(sanitized.writing.extra, undefined);
});
