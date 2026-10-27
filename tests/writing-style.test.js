import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultWriting, validateWriting, writingLayout, WRITING_FONTS } from '../src/core/writing.js';
import { PAIRED_FONT_DATA } from '../src/core/paired-font-data.js';
import { FONT_DATA } from '../src/core/font-data.js';

const styles = ['regular', 'bold', 'italic', 'bold-italic'];
const settings = (font, style, mode = 'outline', text = 'H') => ({ ...defaultWriting(), font, style, mode, text });

test('style omission preserves legacy settings and regular geometry for all five fonts', () => {
  assert.deepEqual(WRITING_FONTS.map(({ name }) => name), ['DejaVu Sans', 'DejaVu Serif', 'Sans', 'Serif', 'Script']);
  for (const { id: font } of WRITING_FONTS) {
    const legacy = { ...defaultWriting(), font };
    assert.deepEqual(validateWriting(legacy), legacy);
    assert.equal(Object.hasOwn(validateWriting({ ...legacy, style: undefined }), 'style'), false);
    assert.deepEqual(writingLayout(legacy), writingLayout({ ...legacy, style: 'regular' }));
    assert.equal(validateWriting({ ...legacy, style: 'regular' }).style, 'regular');
  }
});

test('actual DejaVu styles have distinct geometry and use their own advance and cap metrics', () => {
  for (const font of Object.keys(PAIRED_FONT_DATA)) {
    for (const mode of ['outline', 'centerline']) {
      const layouts = styles.map((style) => writingLayout(settings(font, style, mode)));
      for (let i = 0; i < styles.length; i++) {
        const data = i === 0 ? PAIRED_FONT_DATA[font] : PAIRED_FONT_DATA[font].styles[styles[i]];
        assert.ok(Math.abs(layouts[i].width - data.glyphs.H.advance * 10 / data.capHeight) < 1e-9);
        for (let j = 0; j < i; j++) assert.notDeepEqual(layouts[i].strokes, layouts[j].strokes);
      }
    }
  }
});

test('unknown styles and styled Hershey fonts are rejected at both entry points', () => {
  for (const style of [null, '', 'Bold', 'oblique', true, 1, {}, [], '__proto__']) {
    for (const call of [validateWriting, writingLayout]) {
      assert.throws(() => call(settings('dejavu-sans', style)), /writing style/);
    }
  }
  for (const font of Object.keys(FONT_DATA)) {
    for (const style of styles.slice(1)) {
      for (const call of [validateWriting, writingLayout]) {
        assert.throws(() => call(settings(font, style, 'centerline')), /Hershey fonts support regular/);
      }
    }
  }
});

test('every style explicitly rejects unavailable paths and draws every available ASCII glyph', () => {
  for (const [font, family] of Object.entries(PAIRED_FONT_DATA)) {
    for (const style of styles) {
      const data = style === 'regular' ? family : family.styles[style];
      for (const mode of ['outline', 'centerline']) {
        for (let code = 33; code <= 126; code++) {
          const text = String.fromCharCode(code);
          const input = settings(font, style, mode, text);
          if (!data.glyphs[text][mode]) {
            assert.throws(() => validateWriting(input), /No verified centerline paths/);
            assert.throws(() => writingLayout(input), /No verified centerline paths/);
          } else {
            const result = writingLayout(input);
            assert.ok(result.strokes.length > 0);
            assert.ok(result.strokes.every((stroke) => stroke.length >= 2 && stroke.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))));
          }
        }
      }
    }
  }
});

test('missing glyph records are explicit validation errors in both modes and Hershey', () => {
  for (const [font, data, modes] of [
    ['dejavu-sans', PAIRED_FONT_DATA['dejavu-sans'].styles.bold, ['outline', 'centerline']],
    ['futural', FONT_DATA.futural, ['centerline']],
  ]) {
    const glyph = data.glyphs.H;
    try {
      delete data.glyphs.H;
      for (const mode of modes) {
        assert.throws(() => writingLayout(settings(font, font === 'futural' ? 'regular' : 'bold', mode)), /No verified .* paths/);
      }
    } finally {
      data.glyphs.H = glyph;
    }
  }
});
