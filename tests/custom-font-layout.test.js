import assert from 'node:assert/strict';
import { defaultProject, validateProject, drawingCommands, drawingStrokes, textBounds } from '../src/core/project.js';
import { defaultWriting, validateWriting } from '../src/core/writing.js';

const font = { id: `custom-${'a'.repeat(64)}`, name: 'Imported test', capHeight: 70, spaceAdvance: 25,
  glyphs: { T: { advance: 60, outline: [[{ x: 0, y: 0 }, { x: 30, y: 70 }, { x: 60, y: 0 }, { x: 0, y: 0 }]],
    centerline: [[{ x: 30, y: 0 }, { x: 30, y: 70 }], [{ x: 0, y: 70 }, { x: 60, y: 70 }]] } } };
const writing = { ...defaultWriting(), text: 'T', font: font.id, mode: 'centerline', style: 'regular' };
const project = validateProject({ ...defaultProject(), version: 2, fonts: [font], texts: [
  { id: 'one', x: -20, y: 0, writing }, { id: 'two', x: 20, y: 0, writing: { ...writing, mode: 'outline', align: 'right' } },
] });
assert.equal(drawingStrokes(project).length, 3);
assert.ok(drawingCommands(project).length > 5);
assert.ok(textBounds(project.texts[0], project.origin, project.fonts).right > textBounds(project.texts[0], project.origin, project.fonts).left);
assert.deepEqual(validateProject(JSON.parse(JSON.stringify(project))), project);
assert.throws(() => validateWriting({ ...writing, style: 'bold' }, [font]), /original face/);
assert.throws(() => validateWriting({ ...writing, text: 'X' }, [font]), /No verified/);
assert.throws(() => validateProject({ ...project, fonts: [] }), /supported writing font/);
assert.throws(() => validateProject({ ...project, fonts: [{ ...font, capHeight: Infinity }] }), /metric/);
console.log('Custom fonts survive editable multi-text project round trips and compile in both modes');
