import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_CUSTOM_FONTS, MAX_PROJECT_BYTES, MAX_FONT_BYTES, validateCustomFonts } from '../src/core/custom-font.js';

const loop = () => [{ x: 0, y: 0 }, { x: 1, y: 2 }, { x: 0, y: 0 }];
const glyph = () => ({ advance: 50, outline: [loop()], centerline: [[{ x: 0, y: 0 }, { x: 1, y: 1 }]] });
const font = (digit = 'a') => ({ id: `custom-${digit.repeat(64)}`, name: 'Test', capHeight: 70, spaceAdvance: 30, glyphs: { A: glyph() }, license: 'Personal use' });

function rejects(value) { assert.throws(() => validateCustomFonts(value)); }

test('constants and independent sanitized deep copies retain optional metadata', () => {
  assert.equal(MAX_CUSTOM_FONTS, 4);
  assert.equal(MAX_PROJECT_BYTES, 4194304);
  assert.equal(MAX_FONT_BYTES, 2097152);
  assert.deepEqual(validateCustomFonts([]), []);
  const input = font();
  input.name = ' Test ';
  const before = structuredClone(input);
  const copy = validateCustomFonts([input])[0];
  assert.equal(copy.name, 'Test');
  assert.equal(copy.license, 'Personal use');
  copy.glyphs.A.outline[0][0].x = 20;
  copy.glyphs.A.centerline[0][0].y = 20;
  assert.deepEqual(input, before);
  assert.deepEqual(validateCustomFonts([font('a'), font('b'), font('c'), font('d')]).length, 4);
});

test('invalid font headers, duplicate IDs, unknown fields and glyph keys reject', () => {
  for (const value of [null, {}, '', [null], new Array(1), [font(), font()], Array.from({ length: 5 }, () => font())]) rejects(value);
  for (const [key, values] of Object.entries({
    id: ['custom-a', `custom-${'A'.repeat(64)}`, null, 1],
    name: ['', ' ', null, 'a'.repeat(121)],
    capHeight: [0, -1, 1000.01, NaN, Infinity, null, '70'],
    spaceAdvance: [0, -1, 1000.01, NaN, Infinity, null],
    license: [null, 1, 'a'.repeat(2001)],
    glyphs: [{}, null, [], { ' ': glyph() }, { 'é': glyph() }, { AA: glyph() }, { A: null }],
    extra: [true],
  })) for (const value of values) rejects([{ ...font(), [key]: value }]);
  for (const key of ['id', 'name', 'capHeight', 'spaceAdvance', 'glyphs']) {
    const input = font(); delete input[key]; rejects([input]);
  }
});

test('glyph modes enforce finite bounded geometry, closure and nonzero strokes', () => {
  const invalidModes = [undefined, {}, [], [null], [[]], [[{ x: 0, y: 0 }]], [[{ x: 0, y: 0 }, { x: 0, y: 0 }]], new Array(1),
    ...[NaN, Infinity, -Infinity, 2000.01, -2000.01, null, '0'].map((x) => [[{ x, y: 0 }, { x: 1, y: 1 }]]),
    [[{ x: 0, y: 0, extra: true }, { x: 1, y: 1 }]],
  ];
  for (const mode of ['outline', 'centerline']) for (const value of invalidModes) {
    rejects([{ ...font(), glyphs: { A: { ...glyph(), [mode]: value } } }]);
  }
  for (const entry of [
    { ...glyph(), outline: [[{ x: 0, y: 0 }, { x: 1, y: 1 }]] },
    { ...glyph(), outline: null }, { ...glyph(), extra: 1 },
    ...[-1, 1000.01, NaN, Infinity, null].map((advance) => ({ ...glyph(), advance })),
    ...[null, 1, 'a'.repeat(201)].map((centerlineError) => ({ ...glyph(), centerlineError })),
  ]) rejects([{ ...font(), glyphs: { A: entry } }]);
  const entry = { advance: 0, outline: null, centerline: null, centerlineError: 'Missing' };
  assert.deepEqual(validateCustomFonts([{ ...font(), glyphs: { '~': entry } }])[0].glyphs['~'], entry);
  assert.doesNotThrow(() => validateCustomFonts([{ ...font(), capHeight: 1000, spaceAdvance: 1000,
    glyphs: { '!': { advance: 1000, outline: [[{ x: -2000, y: -2000 }, { x: 2000, y: 2000 }, { x: -2000, y: -2000 }]], centerline: null } } }]));
});

const longLoop = (length) => Array.from({ length }, (_, i) => ({ x: i === length - 1 ? 0 : i % 2, y: 0 }));
const largeGlyph = () => ({ advance: 1, outline: [longLoop(2000)], centerline: null });
const largeFont = (digit, count) => ({ ...font(digit), glyphs: Object.fromEntries(Array.from({ length: count }, (_, i) => [String.fromCharCode(33 + i), largeGlyph()])) });

test('per-mode stroke and point caps, per-font and aggregate caps are inclusive', () => {
  const many = Array.from({ length: 200 }, loop);
  assert.doesNotThrow(() => validateCustomFonts([{ ...font(), glyphs: { A: { advance: 1, outline: many, centerline: many } } }]));
  rejects([{ ...font(), glyphs: { A: { ...glyph(), outline: [...many, loop()] } } }]);
  rejects([{ ...font(), glyphs: { A: { ...glyph(), outline: [longLoop(2001)] } } }]);
  assert.doesNotThrow(() => validateCustomFonts([largeFont('a', 15)]));
  rejects([largeFont('a', 16)]);
  assert.doesNotThrow(() => validateCustomFonts([largeFont('a', 15), largeFont('b', 15), largeFont('c', 10)]));
  rejects([largeFont('a', 15), largeFont('b', 15), largeFont('c', 11)]);
});
