import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as opentype from '../node_modules/opentype.js/dist/opentype.mjs';
import { convertFont } from '../src/core/font-converter.js';
import { MAX_FONT_BYTES, validateCustomFonts } from '../src/core/custom-font.js';

function rectangle(x, y, width, height) {
  const path = new opentype.Path();
  path.moveTo(x, y); path.lineTo(x + width, y); path.lineTo(x + width, y + height); path.lineTo(x, y + height); path.close();
  return path;
}

function fixture({ h = true, complex = false } = {}) {
  const path = rectangle(0, 0, 150, 700);
  if (complex) {
    path.commands = [];
    path.moveTo(0, 0);
    for (let i = 0; i < 5001; i++) path.lineTo(i % 2 ? 100 : 0, i % 700);
    path.close();
  }
  const glyphs = [
    new opentype.Glyph({ name: '.notdef', advanceWidth: 500, path: new opentype.Path() }),
    new opentype.Glyph({ name: 'space', unicode: 32, advanceWidth: 250, path: new opentype.Path() }),
    new opentype.Glyph({ name: 'A', unicode: 65, advanceWidth: 600, path }),
  ];
  if (h) glyphs.push(new opentype.Glyph({ name: 'H', unicode: 72, advanceWidth: 600, path: rectangle(0, 0, 200, 700) }));
  const ring = rectangle(0, 0, 600, 700);
  ring.moveTo(100, 100); ring.lineTo(100, 600); ring.lineTo(500, 600); ring.lineTo(500, 100); ring.close();
  glyphs.push(new opentype.Glyph({ name: 'O', unicode: 79, advanceWidth: 650, path: ring }));
  const dotted = rectangle(0, 0, 100, 450);
  dotted.commands.push(...rectangle(0, 550, 100, 150).commands);
  glyphs.push(new opentype.Glyph({ name: 'i', unicode: 105, advanceWidth: 200, path: dotted }));
  return new opentype.Font({ familyName: 'Synthetic Test', styleName: 'Regular', unitsPerEm: 1000, ascender: 800, descender: -200, glyphs, license: 'Synthetic fixture license' }).toArrayBuffer();
}

test('rejects wrong buffers, headers, size and malformed font data', async () => {
  for (const buffer of [null, {}, new Uint8Array(12), new ArrayBuffer(0), new ArrayBuffer(12), new ArrayBuffer(MAX_FONT_BYTES + 1)]) {
    await assert.rejects(convertFont(buffer, 'test.otf'));
  }
  const malformed = new ArrayBuffer(12);
  new DataView(malformed).setUint32(0, 0x4f54544f);
  await assert.rejects(convertFont(malformed, 'bad.otf'));
  await assert.rejects(convertFont(fixture(), null));
  await assert.rejects(convertFont(fixture(), 'test.otf', null));
});

test('converts in-memory OTF with hash, metadata, em100 Y-up outlines and ordered progress', async () => {
  const buffer = fixture();
  const events = [];
  const font = await convertFont(buffer, 'fallback.otf', (event) => events.push(event), 'HHAéH!');
  assert.equal(font.id, `custom-${createHash('sha256').update(new Uint8Array(buffer)).digest('hex')}`);
  assert.equal(font.name, 'Synthetic Test');
  assert.equal(font.license, 'Synthetic fixture license');
  assert.equal(font.capHeight, 70);
  assert.equal(font.spaceAdvance, 25);
  assert.equal(font.glyphs.A.advance, 60);
  assert.equal(Object.keys(font.glyphs).length, 94);
  assert.deepEqual(validateCustomFonts([font])[0], font);
  const points = font.glyphs.H.outline.flat();
  assert.equal(Math.min(...points.map((p) => p.y)), 0);
  assert.equal(Math.max(...points.map((p) => p.y)), 70);
  for (const stroke of font.glyphs.H.outline) assert.deepEqual(stroke[0], stroke.at(-1));
  assert.equal(events.length, 95);
  assert.equal(events[0].stage, 'outlines');
  assert.equal(events[0].font.glyphs.H.centerline, null);
  assert.deepEqual(events.slice(1, 4).map((e) => e.char), ['H', 'A', '!']);
  assert.equal(new Set(events.slice(1).map((e) => e.char)).size, 94);
  events.slice(1).forEach((event, i) => {
    assert.equal(event.stage, 'centerline'); assert.equal(event.completed, i + 1); assert.equal(event.total, 94);
  });
  assert.equal(font.glyphs.B.outline, null);
  assert.equal(font.glyphs.B.centerline, null);
  assert.match(font.glyphs.B.centerlineError, /Missing source glyph/);
  events[0].font.glyphs.H.outline[0][0].x = 999;
  events[1].glyph.outline[0][0].x = 999;
  assert.notEqual(font.glyphs.H.outline[0][0].x, 999);
  if (typeof Map.prototype.getOrInsert === 'function') {
    assert.ok(font.glyphs.H.centerline, font.glyphs.H.centerlineError);
    assert.notDeepEqual(font.glyphs.H.centerline, font.glyphs.H.outline);
  } else {
    assert.equal(font.glyphs.H.centerline, null);
    assert.match(font.glyphs.H.centerlineError, /getOrInsert/);
  }
});

test('missing H uses ascender and oversized paths become unavailable before MAT', async () => {
  const font = await convertFont(fixture({ h: false, complex: true }), 'synthetic.otf');
  assert.equal(font.capHeight, 80);
  assert.equal(font.glyphs.A.outline, null);
  assert.equal(font.glyphs.A.centerline, null);
  assert.match(font.glyphs.A.centerlineError, /5000 path commands/);
});

test('native MAT produces genuine finite centerlines', { skip: typeof Map.prototype.getOrInsert !== 'function' }, async () => {
  const font = await convertFont(fixture(), 'synthetic.otf');
  for (const char of ['A', 'H']) {
    const glyph = font.glyphs[char];
    assert.ok(glyph.centerline, glyph.centerlineError);
    assert.equal(glyph.centerlineError, undefined);
    assert.ok(glyph.centerline.flat().every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y) && y >= 0 && y <= 70));
  }
  assert.ok(font.glyphs.O.centerline, font.glyphs.O.centerlineError);
  assert.ok(font.glyphs.O.centerline.some((stroke) => stroke[0].x === stroke.at(-1).x && stroke[0].y === stroke.at(-1).y));
  assert.equal(font.glyphs.i.centerline?.length, 2, font.glyphs.i.centerlineError);
});
