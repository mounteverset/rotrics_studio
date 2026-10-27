import { FONT_DATA } from './font-data.js';
import { PAIRED_FONT_DATA } from './paired-font-data.js';

export const WRITING_FONTS = [
  ...Object.entries(PAIRED_FONT_DATA).map(([id, font]) => ({ id, name: font.name, outline: true })),
  ...Object.entries(FONT_DATA).map(([id, font]) => ({ id, name: font.name, outline: false })),
];

export function defaultWriting() {
  return { text: 'Hello DexArm!', font: 'futural', fontSize: 10, letterSpacing: 0.5, lineSpacing: 1.5, align: 'left' };
}

export function validateWriting(value) {
  if (!value || typeof value !== 'object' || typeof value.text !== 'string') {
    throw new Error('Enter 1–160 characters of text, including spaces and line breaks');
  }
  const text = value.text.replace(/\r\n?/g, '\n');
  if (!text.trim() || text.length > 160) throw new Error('Enter 1–160 characters of text, including spaces and line breaks');
  if (text.split('\n').length > 8) throw new Error('Writing supports at most 8 lines');
  if (!Object.hasOwn(FONT_DATA, value.font) && !Object.hasOwn(PAIRED_FONT_DATA, value.font)) throw new Error('Choose a supported writing font');
  const style = value.style === undefined ? 'regular' : value.style;
  if (!['regular', 'bold', 'italic', 'bold-italic'].includes(style)) throw new Error('Choose regular, bold, italic, or bold-italic writing style');
  const mode = value.mode === undefined ? 'centerline' : value.mode;
  if (!['outline', 'centerline'].includes(mode)) throw new Error('Choose outline or centerline writing');
  const paired = Object.hasOwn(PAIRED_FONT_DATA, value.font) ? PAIRED_FONT_DATA[value.font] : null;
  if (!paired && style !== 'regular') throw new Error('Hershey fonts support regular style only');
  const font = paired ? (style === 'regular' ? paired : paired.styles[style]) : FONT_DATA[value.font];
  if (mode === 'outline' && !paired) throw new Error('Outline mode requires DejaVu Sans or DejaVu Serif; Hershey fonts contain pen strokes only');
  const unsupported = [...new Set([...text].filter((char) => char !== '\n' && (char < ' ' || char > '~')))];
  if (unsupported.length) throw new Error(`Unsupported writing characters: ${unsupported.map((char) => JSON.stringify(char)).join(', ')}. Use English letters, numbers, and ASCII punctuation.`);
  const unavailable = [...new Set([...text].filter((char) => char !== '\n' && char !== ' ' && !(paired ? font.glyphs[char]?.[mode]?.length : font.glyphs[char]?.strokes?.length)))];
  if (unavailable.length) throw new Error(`No verified ${mode} paths for ${unavailable.map((char) => JSON.stringify(char)).join(', ')} in ${paired ? paired.name : value.font} (${style}). Choose another font, style, or mode`);
  for (const [key, min, max, label] of [
    ['fontSize', 2, 40, 'Letter height'], ['letterSpacing', 0, 10, 'Letter spacing'], ['lineSpacing', 1, 3, 'Line spacing'],
  ]) {
    if (!Number.isFinite(value[key]) || value[key] < min || value[key] > max) throw new Error(`${label} must be between ${min} and ${max}`);
  }
  if (!['left', 'center', 'right'].includes(value.align)) throw new Error('Choose left, center, or right text alignment');
  return { text, font: value.font, fontSize: value.fontSize, letterSpacing: value.letterSpacing, lineSpacing: value.lineSpacing, align: value.align,
    ...(value.mode !== undefined ? { mode } : {}), ...(value.style !== undefined ? { style } : {}) };
}

export function writingLayout(value) {
  const settings = validateWriting(value);
  const paired = Object.hasOwn(PAIRED_FONT_DATA, settings.font) ? PAIRED_FONT_DATA[settings.font] : null;
  const font = paired ? (!settings.style || settings.style === 'regular' ? paired : paired.styles[settings.style]) : FONT_DATA[settings.font];
  const scale = settings.fontSize / (paired ? font.capHeight : 21);
  const lines = settings.text.split('\n');
  const advance = (char) => (char === ' ' ? (paired ? font.spaceAdvance : 10) : font.glyphs[char].advance) * scale;
  const widths = lines.map((line) => [...line].reduce((width, char) => width + advance(char), 0) + Math.max(0, line.length - 1) * settings.letterSpacing);
  const width = Math.max(...widths);
  const factor = { left: 0, center: 0.5, right: 1 }[settings.align];
  const strokes = [];
  lines.forEach((line, row) => {
    let x = (width - widths[row]) * factor;
    const baseline = -row * settings.fontSize * settings.lineSpacing;
    for (const char of line) {
      if (char !== ' ') {
        const paths = paired ? font.glyphs[char][settings.mode || 'centerline'] : font.glyphs[char].strokes;
        for (const stroke of paths) {
          strokes.push(stroke.map((point) => ({ x: x + point.x * scale - width / 2, y: baseline + (paired ? point.y : 22 - point.y) * scale })));
        }
      }
      x += advance(char) + settings.letterSpacing;
    }
  });
  const points = strokes.flat();
  const top = Math.max(settings.fontSize, ...points.map((point) => point.y));
  const bottom = Math.min(-(lines.length - 1) * settings.fontSize * settings.lineSpacing, ...points.map((point) => point.y));
  for (const point of points) point.y -= (top + bottom) / 2;
  return { strokes, width, height: top - bottom };
}
