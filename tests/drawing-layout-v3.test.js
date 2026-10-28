import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultProject, validateProject, upgradeLayout, layoutProject, drawingStrokes, drawingCommands,
  artworkStrokes, artworkBounds, textBounds } from '../src/core/project.js';
import { defaultWriting } from '../src/core/writing.js';

const square = [[{ x: -.5, y: -.5 }, { x: .5, y: -.5 }, { x: .5, y: .5 }, { x: -.5, y: .5 }, { x: -.5, y: -.5 }]];
const art = (id = 'art') => ({ id, name: 'Square', strokes: structuredClone(square), x: 0, y: 0,
  rotation: 0, width: 20, height: 20, mirrorX: false, mirrorY: false });
const text = (id = 'text') => ({ id, x: 0, y: 30, rotation: 15, group: 'pair', writing: { ...defaultWriting(), text: 'HI' } });
const layout = () => ({ ...defaultProject(), version: 3, texts: [], artworks: [art()] });
const closePaths = (a, b) => {
  assert.equal(a.length, b.length);
  a.forEach((stroke, i) => {
    assert.equal(stroke.length, b[i].length);
    stroke.forEach((p, j) => {
      for (const axis of ['x', 'y', 'z']) assert.ok(Math.abs(p[axis] - b[i][j][axis]) < 1e-10, `${axis}: ${p[axis]} != ${b[i][j][axis]}`);
    });
  });
};

test('v3 round trips arrays, groups, paper, settings and independent source copies', () => {
  const value = { ...layout(), texts: [text()], paper: { width: 210, height: 297, margin: 10, x: -100, y: 0 },
    options: { optimize: false, hatch: false, hatchSpacing: 3, hatchAngle: -45 } };
  value.artworks[0].group = 'pair';
  const before = structuredClone(value);
  const actual = validateProject(JSON.parse(JSON.stringify(value)));
  assert.deepEqual(actual, before);
  assert.deepEqual(value, before);
  assert.notStrictEqual(actual.artworks[0].strokes, value.artworks[0].strokes);
  assert.equal(Object.hasOwn(actual, 'artwork'), false);
  assert.equal(Object.hasOwn(actual, 'writing'), false);
  assert.deepEqual(layoutProject(value), actual);
  assert.deepEqual(upgradeLayout(value), actual);
});

test('legacy serialization, defaults and disabled processing remain exact', () => {
  for (const value of [defaultProject(), { ...defaultProject(), writing: defaultWriting() },
    { ...defaultProject(), artwork: { name: 'Square', strokes: square } },
    { ...defaultProject(), version: 2, texts: [text()] }]) {
    assert.deepEqual(validateProject(value), value);
    assert.deepEqual(drawingCommands({ ...value, options: { optimize: false, hatch: false } }), drawingCommands(value));
  }
  assert.equal(defaultProject().version, 1);
  assert.equal(layoutProject(defaultProject()).version, 2);
});

test('upgrades star, writing, off-centre rotated artwork and v2 without changing geometry', () => {
  const source = { name: 'Off centre', x: 13, y: -7, rotation: 37,
    strokes: [[{ x: .1, y: -.2 }, { x: .4, y: .1 }, { x: .2, y: .25 }]] };
  for (const value of [defaultProject(), { ...defaultProject(), writing: defaultWriting() },
    { ...defaultProject(), artwork: source },
    { ...defaultProject(), version: 2, texts: [text()], artwork: source },
    { ...defaultProject(), version: 2, texts: [] }]) {
    const before = structuredClone(value);
    const upgraded = upgradeLayout(value);
    closePaths(drawingStrokes(upgraded), drawingStrokes(value));
    if (drawingStrokes(value).length) assert.deepEqual(drawingCommands(upgraded), drawingCommands(value));
    else assert.throws(() => drawingCommands(upgraded), /Add text/);
    assert.deepEqual(value, before);
    assert.equal(upgraded.version, 3);
  }
  const upgraded = upgradeLayout({ ...defaultProject(), artwork: source });
  assert.deepEqual(upgraded.artworks[0].strokes, source.strokes);
  assert.ok(Math.abs(upgraded.artworks[0].width - 24) < 1e-10);
  assert.equal(upgraded.artworks[0].height, 36);
});

test('actual source extents scale, mirror, rotate and translate around source midpoint', () => {
  const artwork = { ...art(), strokes: [[{ x: .1, y: -.2 }, { x: .3, y: .2 }]],
    width: 40, height: 20, mirrorX: true, rotation: 90, x: 12, y: -5 };
  const value = validateProject({ ...layout(), artworks: [artwork] });
  closePaths(artworkStrokes(value.artworks[0], value.origin), [[{ x: 22, y: 295, z: 0 }, { x: 2, y: 255, z: 0 }]]);
  const bounds = artworkBounds(value.artworks[0], value.origin);
  assert.ok(Math.abs(bounds.left - 2) < 1e-10);
  assert.ok(Math.abs(bounds.right - 22) < 1e-10);
  assert.equal(bounds.top - bounds.bottom, 40);
});

test('degenerate source axes require zero dimensions and preserve upgraded geometry', () => {
  for (const strokes of [[[{ x: .2, y: -.3 }, { x: .2, y: .3 }]], [[{ x: -.2, y: .1 }, { x: .4, y: .1 }]]]) {
    const old = { ...defaultProject(), artwork: { name: 'Line', strokes, rotation: 45 } };
    const upgraded = upgradeLayout(old);
    closePaths(drawingStrokes(upgraded), drawingStrokes(old));
    const axis = strokes[0][0].x === strokes[0][1].x ? 'width' : 'height';
    assert.equal(upgraded.artworks[0][axis], 0);
    assert.throws(() => validateProject({ ...upgraded, artworks: [{ ...upgraded.artworks[0], [axis]: 1 }] }), /degenerate/);
  }
  assert.throws(() => validateProject({ ...layout(), artworks: [{ ...art(), width: 0 }] }), /degenerate/);
});

test('v3 rejects invalid object schemas, IDs, transforms, sources and groups', () => {
  for (const patch of [{ artwork: {} }, { writing: defaultWriting() }, { texts: null }, { artworks: null },
    { artworks: [null] }, { artworks: [art(), art()] }, { texts: [text('art')] },
    { artworks: Array.from({ length: 21 }, (_, i) => art(`a${i}`)) },
    { texts: Array.from({ length: 21 }, (_, i) => text(`t${i}`)) }]) {
    assert.throws(() => validateProject({ ...layout(), ...patch }));
  }
  for (const patch of [{ id: '' }, { id: '<script>' }, { name: '' }, { strokes: [] },
    { strokes: [[{ x: 0, y: 0 }, { x: 0, y: 0 }]] }, { strokes: [[{ x: .6, y: 0 }, { x: 0, y: 0 }]] },
    { width: NaN }, { width: 301 }, { height: -1 }, { x: Infinity }, { y: '0' }, { rotation: 181 },
    { mirrorX: 1 }, { mirrorY: undefined }, { group: null }]) {
    assert.throws(() => validateProject({ ...layout(), artworks: [{ ...art(), ...patch }] }));
  }
  assert.throws(() => validateProject({ ...layout(), texts: [{ ...text(), group: {} }] }), /group/);
});

test('paper and options reject untrusted values on all supported versions', () => {
  const paper = { width: 210, height: 297, margin: 0, x: 0, y: 0 };
  for (const patch of [{ width: 9 }, { width: 1001 }, { height: Infinity }, { margin: -1 }, { margin: 105 },
    { x: 1001 }, { y: NaN }, { x: '0' }]) {
    assert.throws(() => validateProject({ ...layout(), paper: { ...paper, ...patch } }), /paper/);
  }
  for (const options of [null, [], { optimize: 'true' }, { hatch: 1 }, { hatchSpacing: .49 },
    { hatchSpacing: 21 }, { hatchAngle: 181 }, { hatchAngle: NaN }]) {
    for (const value of [defaultProject(), { ...defaultProject(), version: 2, texts: [] }, layout()]) {
      assert.throws(() => validateProject({ ...value, options }));
    }
  }
});

test('all transformed points and pen lifts enforce workspace and global complexity limits', () => {
  for (const patch of [{ x: 145 }, { y: 100 }, { width: 300, rotation: 90 }]) {
    assert.throws(() => validateProject({ ...layout(), artworks: [{ ...art(), ...patch }] }), /must be between/);
  }
  assert.throws(() => validateProject({ ...layout(), origin: { x: 0, y: 280, z: 95 } }), /Z must/);
  const many = { ...art(), strokes: Array.from({ length: 101 }, () => square[0]) };
  assert.throws(() => validateProject({ ...layout(), artworks: [many, { ...many, id: 'other' }] }), /exceeds/);
  const points = { ...art(), strokes: [Array.from({ length: 1001 }, (_, i) => ({ x: i % 2 ? .5 : -.5, y: 0 }))], height: 0 };
  assert.throws(() => validateProject({ ...layout(), artworks: [points, { ...points, id: 'other' }] }), /exceeds/);
  const empty = { ...layout(), artworks: [] };
  assert.deepEqual(drawingStrokes(validateProject(empty)), []);
  assert.throws(() => drawingCommands(empty), /Add text/);
});

test('hatching appends actual machine-space paths per object, skips open paths and never fills text', () => {
  const value = { ...layout(), artworks: [{ ...art('a'), x: -30 }, { ...art('b'), x: 30 }], texts: [text()],
    options: { hatch: true, hatchSpacing: 4, hatchAngle: 0 } };
  const outlines = drawingStrokes({ ...value, options: undefined });
  const paths = drawingStrokes(validateProject(value));
  assert.ok(paths.length > outlines.length);
  assert.deepEqual(paths.slice(0, outlines.length), outlines);
  for (const stroke of paths.slice(outlines.length)) {
    assert.ok(stroke.every((p) => p.z === value.origin.z));
    assert.ok(stroke.every((p) => p.x <= -20) || stroke.every((p) => p.x >= 20));
  }
  const open = { ...layout(), artworks: [{ ...art(), strokes: [square[0].slice(0, -1)] }], options: value.options };
  assert.deepEqual(drawingStrokes(validateProject(open)), drawingStrokes({ ...open, options: undefined }));
  const mixed = { ...layout(), artworks: [{ ...art(), strokes: [...square, [{ x: -.4, y: 0 }, { x: .4, y: 0 }]] }], options: value.options };
  assert.ok(drawingStrokes(validateProject(mixed)).length > 2);
  const onlyText = { ...value, artworks: [] };
  assert.deepEqual(drawingStrokes(validateProject(onlyText)), drawingStrokes({ ...onlyText, options: undefined }));
  const legacy = { ...defaultProject(), artwork: { name: 'Square', strokes: square }, options: value.options };
  assert.ok(drawingStrokes(validateProject(legacy)).length > 1);
});

test('hatch expansion is subject to the final stroke budget', () => {
  assert.throws(() => validateProject({ ...layout(), artworks: [{ ...art(), width: 140, height: 140 }],
    options: { hatch: true, hatchSpacing: .5, hatchAngle: 0 } }), /exceeds|limit|maximum/i);
});

test('optimization produces actual final command paths without changing geometry or bounds', () => {
  const value = { ...layout(), artworks: [{ ...art('a'), x: 60 }, { ...art('b'), x: 10 }], options: { optimize: true } };
  const paths = drawingStrokes(validateProject(value));
  assert.ok(paths[0][0].x < 30);
  assert.equal(paths.length, 2);
  const commands = drawingCommands(value);
  for (const stroke of paths) for (const point of stroke) {
    assert.ok(commands.includes(`G1 X${point.x.toFixed(3)} Y${point.y.toFixed(3)} Z${point.z.toFixed(3)} F${value.feedrate}`));
  }
  const label = text();
  const bounds = textBounds(label, value.origin);
  const textPaths = drawingStrokes({ ...value, artworks: [], texts: [label] });
  assert.ok(textPaths.flat().every((p) => p.x >= bounds.left && p.x <= bounds.right && p.y >= bounds.bottom && p.y <= bounds.top));
});


test('capacity accepts 20 artworks plus 20 texts, and option boundary values round trip', () => {
  const value = { ...layout(), artworks: Array.from({ length: 20 }, (_, i) => art(`a${i}`)),
    texts: Array.from({ length: 20 }, (_, i) => text(`t${i}`)) };
  assert.deepEqual(validateProject(value), value);
  for (const options of [{ hatchSpacing: .5, hatchAngle: -180 }, { hatchSpacing: 20, hatchAngle: 180 }]) {
    assert.deepEqual(validateProject({ ...layout(), options }).options, options);
  }
  const mirrored = { ...art(), mirrorY: true };
  const original = artworkStrokes(art(), value.origin);
  closePaths(artworkStrokes(mirrored, value.origin), original.map((stroke) => stroke.map((p) => ({ ...p, y: 2 * value.origin.y - p.y }))));
});

test('groups use the ID character set and length limits for both object types', () => {
  for (const group of ['', ' ', 'a b', '<script>', 'a.b', 'a/b', 'é', 'a'.repeat(81), null, 1, true, {}, []]) {
    assert.throws(() => validateProject({ ...layout(), artworks: [{ ...art(), group }] }), /group/);
    for (const version of [2, 3]) {
      const value = { ...defaultProject(), version, texts: [{ ...text(), group }] };
      if (version === 3) value.artworks = [];
      assert.throws(() => validateProject(value), /group/);
    }
  }
  for (const group of ['a', 'a'.repeat(80), 'A_Z-09', '9afad815-5cb6-4d42-9b69-c79828be8358']) {
    const value = { ...layout(), artworks: [{ ...art(), group }], texts: [{ ...text(), group }] };
    assert.deepEqual(validateProject(value), value);
  }
});

test('sparse object arrays reject missing entries rather than silently dropping objects', () => {
  for (const entries of [new Array(1), [, art('other')], [art(), ,]]) {
    assert.throws(() => validateProject({ ...layout(), artworks: entries }), /unique ID/);
  }
  for (const version of [2, 3]) {
    for (const entries of [new Array(1), [, text('other')], [text(), ,]]) {
      const value = { ...defaultProject(), version, texts: entries };
      if (version === 3) value.artworks = [];
      assert.throws(() => validateProject(value), /unique ID/);
    }
  }
});

test('sparse normalized stroke and point arrays are rejected at the source boundary', () => {
  for (const strokes of [new Array(1), [, square[0]], [new Array(2)], [[square[0][0], , square[0][1]]]]) {
    assert.throws(() => validateProject({ ...layout(), artworks: [{ ...art(), strokes }] }));
  }
});
