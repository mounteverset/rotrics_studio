import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutAction, layoutObjects, objectBounds, selectionIds, combinedBounds } from '../src/core/layout-actions.js';
import { DRAWING_PRESETS, presetArtwork } from '../src/core/drawing-presets.js';
import { defaultProject, validateProject, artworkStrokes, textBounds } from '../src/core/project.js';
import { defaultWriting } from '../src/core/writing.js';

const artwork = (id, x, y, group) => ({ id, ...presetArtwork('Rectangle'), x, y, width: 10, height: 6,
  rotation: 0, mirrorX: false, mirrorY: false, ...(group ? { group } : {}) });
const fixture = () => validateProject({ ...defaultProject(), version: 3,
  artworks: [artwork('a', -30, -10, 'pair'), artwork('b', -10, 5, 'pair'), artwork('c', 30, 20)],
  texts: [{ id: 't', x: 5, y: -20, writing: { ...defaultWriting(), text: 'HI' } }],
});
const byId = (project, id) => layoutObjects(project).find((object) => object.id === id);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
function frozen(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(frozen);
    Object.freeze(value);
  }
  return value;
}

test('selection expands groups once, ignores missing IDs and retains object order', () => {
  const project = fixture();
  assert.deepEqual(selectionIds(project, ['b', 'b', 'missing', 't']), ['a', 'b', 't']);
  assert.deepEqual(selectionIds(project, ['missing']), []);
  assert.deepEqual(layoutObjects(project).map((object) => object.id), ['a', 'b', 'c', 't']);
});

test('moving a member moves the whole group, preserves offsets and leaves others unchanged', () => {
  const source = frozen(fixture()), before = structuredClone(source);
  const { project, selection } = layoutAction(source, ['b'], { type: 'move', dx: 7, dy: -4 });
  assert.deepEqual(selection, ['a', 'b']);
  for (const id of selection) {
    assert.deepEqual(byId(project, id), { ...byId(source, id), x: byId(source, id).x + 7, y: byId(source, id).y - 4 });
  }
  for (const id of ['c', 't']) assert.deepEqual(byId(project, id), byId(source, id));
  assert.deepEqual(source, before);
});

test('all actions accept frozen sources without mutating nested data', () => {
  for (const action of [{ type: 'group' }, { type: 'ungroup' }, { type: 'duplicate' }, { type: 'delete' },
    { type: 'align', axis: 'x', edge: 'center' }]) {
    const source = frozen(fixture()), before = structuredClone(source);
    const result = layoutAction(source, ['a', 'c', 't'], action);
    assert.deepEqual(source, before);
    assert.notStrictEqual(result.project, source);
    assert.deepEqual(validateProject(result.project), result.project);
  }
});

test('group and ungroup apply across text and artwork and preserve geometry', () => {
  const source = fixture();
  const grouped = layoutAction(source, ['a', 't'], { type: 'group' });
  assert.deepEqual(grouped.selection, ['a', 'b', 't']);
  const group = byId(grouped.project, 'a').group;
  assert.ok(group);
  for (const id of grouped.selection) {
    assert.equal(byId(grouped.project, id).group, group);
    assert.deepEqual(objectBounds(grouped.project, byId(grouped.project, id)), objectBounds(source, byId(source, id)));
  }
  assert.equal(byId(grouped.project, 'c').group, undefined);
  const ungrouped = layoutAction(grouped.project, ['t'], { type: 'ungroup' });
  assert.deepEqual(ungrouped.selection, grouped.selection);
  for (const id of ungrouped.selection) assert.ok(!Object.hasOwn(byId(ungrouped.project, id), 'group'));
});

test('alignment uses whole-group bounds on both axes and preserves relative positions', () => {
  for (const axis of ['x', 'y']) for (const edge of ['min', 'center', 'max']) {
    const source = fixture();
    source.artworks[0].rotation = 30;
    source.texts[0].rotation = -20;
    const ids = ['a', 'b', 'c', 't'];
    const bounds = (project, members) => combinedBounds(members.map((id) => objectBounds(project, byId(project, id))));
    const coord = (b) => {
      const [min, max] = axis === 'x' ? [b.left, b.right] : [b.bottom, b.top];
      return edge === 'min' ? min : edge === 'max' ? max : (min + max) / 2;
    };
    const target = coord(bounds(source, ids));
    const { project } = layoutAction(source, ['a', 'c', 't'], { type: 'align', axis, edge });
    for (const members of [['a', 'b'], ['c'], ['t']]) close(coord(bounds(project, members)), target);
    close(byId(project, 'b').x - byId(project, 'a').x, byId(source, 'b').x - byId(source, 'a').x);
    close(byId(project, 'b').y - byId(project, 'a').y, byId(source, 'b').y - byId(source, 'a').y);
    for (const id of ids) {
      const other = axis === 'x' ? 'y' : 'x';
      assert.equal(byId(project, id)[other], byId(source, id)[other]);
      assert.equal(byId(project, id).group, byId(source, id).group);
    }
  }
});

test('alignment distinguishes a group name from an unrelated object ID', () => {
  const source = fixture();
  source.artworks[0].group = 'c';
  source.artworks[1].group = 'c';
  const { project } = layoutAction(source, ['a', 'c'], { type: 'align', axis: 'x', edge: 'min' });
  const grouped = combinedBounds(['a', 'b'].map((id) => objectBounds(project, byId(project, id))));
  close(objectBounds(project, byId(project, 'c')).left, grouped.left);
});

test('duplicate creates separate IDs and independent groups and deeply copies geometry/settings', () => {
  const source = fixture();
  source.texts[0].group = 'second';
  source.artworks[2].group = 'second';
  const before = structuredClone(source);
  const { project, selection } = layoutAction(source, ['a', 't'], { type: 'duplicate' });
  const copies = selection.map((id) => byId(project, id));
  assert.equal(copies.length, 4);
  assert.equal(new Set(layoutObjects(project).map((o) => o.id)).size, 8);
  assert.equal(copies[0].group, copies[1].group);
  assert.equal(copies[2].group, copies[3].group);
  assert.notEqual(copies[0].group, copies[2].group);
  assert.ok(copies.every((copy) => !['pair', 'second'].includes(copy.group)));
  for (let i = 0; i < copies.length; i++) {
    const original = layoutObjects(source)[i];
    assert.deepEqual({ ...copies[i], id: original.id, group: original.group }, original);
  }
  const moved = layoutAction(project, [copies[0].id], { type: 'move', dx: 2, dy: 3 });
  assert.deepEqual(moved.selection, [copies[0].id, copies[1].id]);
  assert.deepEqual(byId(moved.project, 'a'), source.artworks[0]);
  copies[0].strokes[0][0].x = 0;
  copies[3].writing.text = 'changed';
  assert.deepEqual(byId(project, 'a'), source.artworks[0]);
  assert.deepEqual(byId(project, 't'), source.texts[0]);
  assert.deepEqual(source, before);
});

test('delete removes every selected group member and returns an empty selection', () => {
  const source = fixture();
  const result = layoutAction(source, ['b'], { type: 'delete' });
  assert.deepEqual(result.selection, []);
  assert.deepEqual(layoutObjects(result.project).map((o) => o.id), ['c', 't']);
  assert.equal(source.artworks.length, 3);
});

test('object bounds match transformed artwork and text, with empty combined bounds rejected', () => {
  const project = fixture();
  const object = project.artworks[0];
  object.rotation = 90;
  object.mirrorX = true;
  const bounds = objectBounds(project, object);
  close(bounds.left, -33); close(bounds.right, -27);
  close(bounds.bottom, 265); close(bounds.top, 275);
  for (const p of artworkStrokes(object, project.origin).flat()) {
    assert.ok(p.x >= bounds.left && p.x <= bounds.right && p.y >= bounds.bottom && p.y <= bounds.top);
  }
  assert.deepEqual(objectBounds(project, project.texts[0]), textBounds(project.texts[0], project.origin));
  assert.throws(() => combinedBounds([]), /Select/);
});

test('invalid actions and out-of-bounds movement fail without changing the source', () => {
  const source = frozen(fixture()), before = structuredClone(source);
  for (const [ids, action] of [[[], { type: 'delete' }], [['missing'], { type: 'delete' }],
    [['c'], { type: 'group' }], [['a'], { type: 'unknown' }],
    [['a'], { type: 'move', dx: NaN, dy: 0 }], [['a'], { type: 'move', dx: 0, dy: Infinity }],
    [['a'], { type: 'move', dx: 1000, dy: 0 }], [['a'], { type: 'align', axis: 'z', edge: 'min' }],
    [['a'], { type: 'align', axis: 'x', edge: 'invalid' }]]) {
    assert.throws(() => layoutAction(source, ids, action));
    assert.deepEqual(source, before);
  }
});

test('every preset is finite, normalized, nondegenerate, closed and independently allocated', () => {
  assert.equal(new Set(DRAWING_PRESETS).size, DRAWING_PRESETS.length);
  for (const name of DRAWING_PRESETS) {
    const artwork = presetArtwork(name), before = structuredClone(artwork);
    assert.equal(artwork.name, name);
    assert.ok(artwork.strokes.length > 0);
    for (const stroke of artwork.strokes) {
      assert.ok(stroke.length >= 4);
      assert.deepEqual(stroke[0], stroke.at(-1));
      assert.notStrictEqual(stroke[0], stroke.at(-1));
      assert.ok(new Set(stroke.map((p) => `${p.x},${p.y}`)).size >= 3);
      for (const p of stroke) for (const axis of ['x', 'y']) assert.ok(Number.isFinite(p[axis]) && p[axis] >= -0.5 && p[axis] <= 0.5, `${name} ${axis}: ${p[axis]}`);
    }
    validateProject({ ...defaultProject(), artwork });
    artwork.strokes[0][0].x = 123;
    assert.deepEqual(presetArtwork(name), before);
  }
  assert.throws(() => presetArtwork('unknown'), /preset/);
});
