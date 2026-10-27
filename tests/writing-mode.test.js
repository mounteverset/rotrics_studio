import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultWriting, validateWriting, writingLayout } from '../src/core/writing.js';
import { defaultProject, validateProject, drawingStrokes, drawingCommands } from '../src/core/project.js';

const settings = (mode = 'centerline', extra = {}) => ({ ...defaultWriting(), font: 'dejavu-sans', text: 'T', mode, ...extra });
const closed = (stroke) => Math.hypot(stroke[0].x - stroke.at(-1).x, stroke[0].y - stroke.at(-1).y) < 1e-5;

test('same Sans T has a closed outline or two open centerline strokes', () => {
  const outline = writingLayout(settings('outline'));
  const center = writingLayout(settings());
  assert.equal(outline.strokes.length, 1);
  assert.ok(outline.strokes.every(closed));
  assert.equal(center.strokes.length, 2);
  assert.ok(center.strokes.every((stroke) => !closed(stroke)));
  assert.equal(outline.width, center.width);
  assert.ok(Math.abs(outline.height - center.height) < 1e-5);
  assert.notDeepEqual(outline.strokes, center.strokes);
});

test('outline and centerline switch actually changes the pen commands', () => {
  const project = { ...defaultProject(), writing: settings('outline') };
  const outline = drawingCommands(project);
  project.writing.mode = 'centerline';
  const center = drawingCommands(project);
  assert.notDeepEqual(center, outline);
  assert.equal(outline.filter((line) => line === 'G1 Z10.000 F600').length, 2);
  assert.equal(center.filter((line) => line === 'G1 Z10.000 F600').length, 3);
  assert.equal(center.at(-1), 'M400');
});

test('each mode survives project save/load with identical drawn geometry', () => {
  for (const mode of ['outline', 'centerline']) {
    const project = validateProject({ ...defaultProject(), writing: settings(mode, { text: 'TO\nBi', align: 'right', fontSize: 8 }) });
    const reopened = validateProject(JSON.parse(JSON.stringify(project)));
    assert.equal(reopened.writing.mode, mode);
    assert.deepEqual(drawingStrokes(reopened), drawingStrokes(project));
  }
});

test('old Hershey projects retain their original geometry and cannot invent font outlines', () => {
  const original = defaultWriting();
  assert.equal(Object.hasOwn(validateWriting(original), 'mode'), false);
  assert.deepEqual(writingLayout(original), writingLayout({ ...original, mode: 'centerline' }));
  assert.throws(() => validateWriting({ ...original, mode: 'outline' }), /Hershey fonts contain pen strokes only/);
});

test('unknown modes and unavailable serif glyphs never silently fall back to outlines', () => {
  for (const mode of [null, '', 'stroke', 'Outline', true, {}, 1]) assert.throws(() => validateWriting(settings(mode)), /Choose outline or centerline/);
  for (const text of ['#', ':', ';']) {
    assert.throws(() => writingLayout(settings('centerline', { font: 'dejavu-serif', text })), /No verified centerline paths/);
    assert.ok(writingLayout(settings('outline', { font: 'dejavu-serif', text })).strokes.length > 0);
  }
});

test('O and B retain closed shapes while i retains separate strokes in both modes', () => {
  for (const mode of ['outline', 'centerline']) {
    const o = writingLayout(settings(mode, { text: 'O' }));
    assert.ok(o.strokes.every(closed));
    assert.equal(o.strokes.length, mode === 'outline' ? 2 : 1);
    const b = writingLayout(settings(mode, { text: 'B' }));
    assert.equal(b.strokes.length, mode === 'outline' ? 3 : 2);
    assert.equal(writingLayout(settings(mode, { text: 'i' })).strokes.length, 2);
  }
});

test('paired fonts maintain valid finite geometry for all outlines and available centerlines', () => {
  for (const font of ['dejavu-sans', 'dejavu-serif']) {
    for (const mode of ['outline', 'centerline']) {
      for (let code = 33; code <= 126; code++) {
        const text = String.fromCharCode(code);
        if (font === 'dejavu-serif' && mode === 'centerline' && '#:;'.includes(text)) continue;
        const layout = writingLayout(settings(mode, { font, text }));
        assert.ok(layout.strokes.length > 0);
        assert.ok(layout.strokes.every((stroke) => stroke.length >= 2 && stroke.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))));
      }
    }
  }
});

test('workspace and pen-up limits apply to both outline and centerline jobs', () => {
  for (const mode of ['outline', 'centerline']) {
    assert.throws(() => validateProject({ ...defaultProject(), writing: settings(mode), origin: { x: 150, y: 280, z: 0 } }), /between/);
    assert.throws(() => validateProject({ ...defaultProject(), writing: settings(mode), origin: { x: 0, y: 280, z: 95 } }), /between/);
  }
});
