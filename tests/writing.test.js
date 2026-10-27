import test from 'node:test';
import assert from 'node:assert/strict';
import { WRITING_FONTS, defaultWriting, validateWriting, writingLayout } from '../src/core/writing.js';

const layout = (options = {}) => writingLayout({ ...defaultWriting(), ...options });

test('character limits apply after CRLF normalization', () => {
  const text = 'A'.repeat(79) + '\r\n' + 'B'.repeat(80);
  const normalized = validateWriting({ ...defaultWriting(), text });
  assert.equal(normalized.text.length, 160);
  assert.equal(normalized.text.includes('\r'), false);
});

function close(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `expected ${actual} to equal ${expected}`);
}

function bounds(strokes) {
  const points = strokes.flat();
  return {
    left: Math.min(...points.map((point) => point.x)),
    right: Math.max(...points.map((point) => point.x)),
    bottom: Math.min(...points.map((point) => point.y)),
    top: Math.max(...points.map((point) => point.y)),
  };
}

function translated(actual, original, dx, dy) {
  assert.deepEqual(actual.map((stroke) => stroke.length), original.map((stroke) => stroke.length));
  const points = original.flat();
  actual.flat().forEach((point, index) => {
    close(point.x, points[index].x + dx);
    close(point.y, points[index].y + dy);
  });
}

function realPaths(result) {
  assert.ok(Number.isFinite(result.width) && result.width > 0);
  assert.ok(Number.isFinite(result.height) && result.height > 0);
  assert.ok(result.strokes.length > 0);
  for (const stroke of result.strokes) {
    assert.ok(stroke.length >= 2);
    for (const point of stroke) {
      assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
    }
    assert.ok(stroke.some((point) => point.x !== stroke[0].x || point.y !== stroke[0].y));
  }
}

test('defaults are independent, valid, and produce real finite paths in all bundled fonts', () => {
  const settings = defaultWriting();
  assert.deepEqual(validateWriting(settings), settings);
  assert.equal(WRITING_FONTS.length, 5);
  assert.equal(new Set(WRITING_FONTS.map(({ id }) => id)).size, 5);
  assert.ok(WRITING_FONTS.some(({ id }) => id === settings.font));
  for (const { id, name } of WRITING_FONTS) {
    assert.ok(typeof name === 'string' && name.trim());
    realPaths(layout({ font: id }));
  }
  settings.text = 'Changed';
  assert.equal(defaultWriting().text, 'Hello DexArm!');
});

test('every printable non-space ASCII character draws real paths in the original stroke fonts', () => {
  for (const { id } of WRITING_FONTS.filter((font) => !font.outline)) {
    for (let code = 33; code <= 126; code++) {
      const text = String.fromCharCode(code);
      assert.doesNotThrow(() => realPaths(layout({ font: id, text })), `${id}: ${text}`);
    }
  }
});

test('fonts have distinct drawn geometry, even after ignoring placement', () => {
  const shapes = WRITING_FONTS.map(({ id }) => {
    const { strokes } = layout({ font: id, text: 'Hamburgefonts 0123!?' });
    const { left, bottom } = bounds(strokes);
    return strokes.map((stroke) => stroke.map(({ x, y }) => ({ x: x - left, y: y - bottom })));
  });
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) assert.notDeepEqual(shapes[i], shapes[j]);
  }
});

test('actual capital H stroke height equals fontSize and scales with it', () => {
  for (const { id } of WRITING_FONTS.filter((font) => !font.outline)) {
    for (const fontSize of [2, 10, 21, 40]) {
      const result = layout({ font: id, text: 'H', fontSize });
      const box = bounds(result.strokes);
      close(box.top - box.bottom, fontSize);
      close(result.height, fontSize);
      close(box.top + box.bottom, 0);
    }
  }
});

test('repeated lines preserve glyphs and descend by fontSize times lineSpacing', () => {
  for (const { id } of WRITING_FONTS) {
    for (const lineSpacing of [1, 1.5, 3]) {
      const options = { font: id, fontSize: 12, lineSpacing };
      const single = layout({ ...options, text: 'H' });
      const result = layout({ ...options, text: 'H\nH\nH' });
      const count = single.strokes.length;
      const step = 12 * lineSpacing;
      assert.equal(result.strokes.length, count * 3);
      close(result.width, single.width);
      close(result.height, single.height + 2 * step);
      for (let row = 0; row < 3; row++) {
        translated(result.strokes.slice(row * count, (row + 1) * count), single.strokes, 0, (1 - row) * step);
      }
    }
  }
});

test('left, center, and right alignment position a short line relative to the longest line', () => {
  for (const { id } of WRITING_FONTS) {
    const options = { font: id, fontSize: 12 };
    const long = layout({ ...options, text: 'HHH' });
    const short = layout({ ...options, text: 'H' });
    const gap = long.width - short.width;
    assert.ok(gap > 0);
    for (const align of ['left', 'center', 'right']) {
      const result = layout({ ...options, text: 'HHH\nH', align });
      const top = bounds(result.strokes.slice(0, long.strokes.length));
      const bottom = bounds(result.strokes.slice(long.strokes.length));
      close(result.width, long.width);
      if (align === 'left') close(bottom.left, top.left);
      if (align === 'center') close((bottom.left + bottom.right) / 2, (top.left + top.right) / 2);
      if (align === 'right') close(bottom.right, top.right);
      close(bottom.left - top.left, align === 'left' ? 0 : align === 'center' ? gap / 2 : gap);
    }
  }
});

test('letterSpacing adds exactly one gap between characters, with no terminal gap', () => {
  for (const { id } of WRITING_FONTS) {
    const options = { font: id, text: 'HHHH' };
    const tight = layout({ ...options, letterSpacing: 0 });
    const loose = layout({ ...options, letterSpacing: 2 });
    close(loose.width - tight.width, 6);
    close(loose.height, tight.height);
    const count = layout({ font: id, text: 'H' }).strokes.length;
    for (let column = 0; column < 4; column++) {
      translated(loose.strokes.slice(column * count, (column + 1) * count),
        tight.strokes.slice(column * count, (column + 1) * count), -3 + column * 2, 0);
    }
    assert.deepEqual(layout({ font: id, text: 'H', letterSpacing: 0 }), layout({ font: id, text: 'H', letterSpacing: 10 }));
  }
});

test('leading and trailing spaces retain width and shift ink without adding strokes', () => {
  for (const { id } of WRITING_FONTS) {
    const plain = layout({ font: id, text: 'H' });
    const leading = layout({ font: id, text: ' H' });
    const trailing = layout({ font: id, text: 'H ' });
    const both = layout({ font: id, text: ' H ' });
    const space = leading.width - plain.width;
    assert.ok(space > 0);
    close(trailing.width, leading.width);
    close(both.width - plain.width, 2 * space);
    translated(leading.strokes, plain.strokes, space / 2, 0);
    translated(trailing.strokes, plain.strokes, -space / 2, 0);
    translated(both.strokes, plain.strokes, 0, 0);
    close(layout({ font: id, text: 'H H', letterSpacing: 2 }).width
      - layout({ font: id, text: 'H H', letterSpacing: 0 }).width, 4);
  }
});

test('leading, trailing, and interior blank lines reserve baseline space', () => {
  for (const { id } of WRITING_FONTS) {
    const options = { font: id, fontSize: 12, lineSpacing: 2 };
    const single = layout({ ...options, text: 'H' });
    for (const [text, dy] of [['\nH', -12], ['H\n', 12]]) {
      const result = layout({ ...options, text });
      close(result.height, single.height + 24);
      close(result.width, single.width);
      translated(result.strokes, single.strokes, 0, dy);
    }
    for (const text of ['H\n\nH', 'H\n   \nH']) {
      const result = layout({ ...options, text });
      const count = single.strokes.length;
      assert.equal(result.strokes.length, 2 * count);
      close(result.height, single.height + 48);
      const first = result.strokes.slice(0, count);
      translated(result.strokes.slice(count), first, 0, -48);
    }
  }
});

test('invalid text, fonts, numeric settings, and alignment are rejected by both entry points', () => {
  const malformed = [null, undefined, [], {}, 'text',
    ...[undefined, null, 42, '', ' ', '\n\n', ' \t\r\n ', 'H'.repeat(161), Array(9).fill('H').join('\n')]
      .map((text) => ({ ...defaultWriting(), text })),
    ...['é', '中', '😀', '\u00a0', '\u200b', ...Array.from({ length: 32 }, (_, code) => String.fromCharCode(code))
      .filter((char) => char !== '\n' && char !== '\r'), '\u007f']
      .map((char) => ({ ...defaultWriting(), text: `H${char}H` })),
    ...['missing', '', 'FUTURAL', '__proto__', 'constructor', null, undefined, 42, {}]
      .map((font) => ({ ...defaultWriting(), font })),
    ...['middle', 'LEFT', '', null, undefined, 0].map((align) => ({ ...defaultWriting(), align })),
  ];
  for (const [key, min, max] of [['fontSize', 2, 40], ['letterSpacing', 0, 10], ['lineSpacing', 1, 3]]) {
    for (const value of [min - 0.001, max + 0.001, NaN, Infinity, -Infinity, String(min), null, undefined, true, {}]) {
      malformed.push({ ...defaultWriting(), [key]: value });
    }
    for (const value of [min, max]) realPaths(layout({ [key]: value }));
  }
  for (const input of malformed) {
    assert.throws(() => validateWriting(input), Error);
    assert.throws(() => writingLayout(input), Error);
  }
  realPaths(layout({ text: 'H'.repeat(160) }));
  realPaths(layout({ text: Array(8).fill('H').join('\n') }));
});

test('CRLF and bare CR normalize to LF for validation and identical layout', () => {
  const text = ' H\r\n\r\nH \rH';
  const normalized = ' H\n\nH \nH';
  assert.equal(validateWriting({ ...defaultWriting(), text }).text, normalized);
  for (const { id } of WRITING_FONTS) {
    assert.deepEqual(layout({ font: id, text }), layout({ font: id, text: normalized }));
  }
});

test('sanitization and layout preserve frozen inputs and return independent data', () => {
  const input = Object.freeze({ ...defaultWriting(), text: ' H\r\nH ', extra: Object.freeze({ ignored: true }) });
  const before = structuredClone(input);
  const clean = validateWriting(input);
  assert.deepEqual(clean, { ...defaultWriting(), text: ' H\nH ' });
  assert.notStrictEqual(clean, input);
  const first = writingLayout(input);
  const expected = structuredClone(first);
  first.strokes[0][0].x = 99999;
  first.strokes[0].push({ x: 0, y: 0 });
  clean.text = 'Changed';
  assert.deepEqual(writingLayout(input), expected);
  assert.deepEqual(input, before);
});
