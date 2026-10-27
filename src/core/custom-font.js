export const MAX_CUSTOM_FONTS = 4;
export const MAX_PROJECT_BYTES = 4 * 1024 * 1024;
export const MAX_FONT_BYTES = 2 * 1024 * 1024;

function object(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some((key) => !keys.includes(key))) throw new Error('Invalid custom font fields');
}

function text(value, max, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new Error('Invalid custom font text');
  return required ? value.trim() : value;
}

function number(value, max, positive = false) {
  if (!Number.isFinite(value) || value > max || (positive ? value <= 0 : value < 0)) throw new Error('Invalid custom font metric');
  return value;
}

function strokes(value, closed) {
  if (value === null) return null;
  if (!Array.isArray(value) || !value.length || value.length > 200) throw new Error('Invalid custom font stroke count');
  let count = 0;
  const result = [];
  for (const stroke of value) {
    if (!Array.isArray(stroke) || stroke.length < 2 || (count += stroke.length) > 2000) throw new Error('Invalid custom font point count');
    const points = [];
    for (const point of stroke) {
      object(point, ['x', 'y']);
      if (![point.x, point.y].every((n) => Number.isFinite(n) && Math.abs(n) <= 2000)) throw new Error('Invalid custom font coordinates');
      points.push({ x: point.x, y: point.y });
    }
    if (!points.some((p) => p.x !== points[0].x || p.y !== points[0].y)) throw new Error('Zero-length custom font stroke');
    if (closed && (points[0].x !== points.at(-1).x || points[0].y !== points.at(-1).y)) throw new Error('Custom font outline must be closed');
    result.push(points);
  }
  return result;
}

export function validateCustomFonts(value) {
  if (!Array.isArray(value) || value.length > MAX_CUSTOM_FONTS) throw new Error('Expected at most four custom fonts');
  const ids = new Set();
  const result = [];
  let total = 0;
  for (const font of value) {
    object(font, ['id', 'name', 'capHeight', 'spaceAdvance', 'glyphs', 'license']);
    if (typeof font.id !== 'string' || !/^custom-[a-f0-9]{64}$/.test(font.id) || ids.has(font.id)) throw new Error('Invalid or duplicate custom font ID');
    ids.add(font.id);
    object(font.glyphs, Array.from({ length: 94 }, (_, i) => String.fromCharCode(i + 33)));
    if (!Object.keys(font.glyphs).length) throw new Error('Custom font needs glyphs');
    const copy = { id: font.id, name: text(font.name, 120, true), capHeight: number(font.capHeight, 1000, true), spaceAdvance: number(font.spaceAdvance, 1000, true), glyphs: {} };
    if (Object.hasOwn(font, 'license')) copy.license = text(font.license, 2000);
    let count = 0;
    for (const [char, glyph] of Object.entries(font.glyphs)) {
      object(glyph, ['advance', 'outline', 'centerline', 'centerlineError']);
      const entry = { advance: number(glyph.advance, 1000), outline: strokes(glyph.outline, true), centerline: strokes(glyph.centerline, false) };
      if (entry.outline === null && entry.centerline !== null) throw new Error('Centerline requires an outline');
      if (Object.hasOwn(glyph, 'centerlineError')) entry.centerlineError = text(glyph.centerlineError, 200);
      count += [entry.outline, entry.centerline].reduce((sum, mode) => sum + (mode || []).reduce((n, stroke) => n + stroke.length, 0), 0);
      if (count > 30000) throw new Error('Custom font exceeds 30000 points');
      copy.glyphs[char] = entry;
    }
    total += count;
    if (total > 80000) throw new Error('Custom fonts exceed 80000 points');
    result.push(copy);
  }
  return result;
}
