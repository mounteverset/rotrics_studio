import * as opentype from '../../node_modules/opentype.js/dist/opentype.mjs';
import { findMats, getPathsFromStr, toScaleAxis, simplifyMat, traverseEdges, getMatCurveToNext } from '../../node_modules/flo-mat/browser/index.min.js';
import { planStrokes } from './centerline-geometry.js';
import { flattenCurve } from './svg.js';
import { MAX_FONT_BYTES, validateCustomFonts } from './custom-font.js';

const chars = Array.from({ length: 94 }, (_, i) => String.fromCharCode(i + 33));
const requireGeometry = (condition, message) => { if (!condition) throw new Error(message); };

function flattenStrokes(strokes) {
  const result = [];
  for (const curves of strokes) {
    const points = [];
    for (const curve of curves) {
      requireGeometry([2, 3, 4].includes(curve.length), 'Invalid curve degree');
      const controls = curve.map(([x, y]) => ({ x, y: -y }));
      requireGeometry(controls.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) <= 2000 && Math.abs(y) <= 2000), 'Invalid curve coordinates');
      if (!points.length) points.push(controls[0]);
      flattenCurve(controls, 0.1, points);
    }
    const rounded = points.map(({ x, y }) => ({ x: Number(x.toFixed(5)), y: Number(y.toFixed(5)) }));
    if (rounded.length && rounded.some((p) => p.x !== rounded[0].x || p.y !== rounded[0].y)) result.push(rounded);
  }
  requireGeometry(result.length > 0, 'No drawable geometry');
  return result;
}

function centerlineFor(loops) {
  const mats = findMats(loops, { applySat: false, simplify: false });
  requireGeometry(mats.length > 0, 'No MAT components');
  const curves = [];
  for (const mat of mats) {
    requireGeometry(mat.cpNode, 'MAT component has no node');
    const raw = [];
    traverseEdges(mat.cpNode, (node) => raw.push(...getMatCurveToNext(node)));
    const original = planStrokes(raw);
    requireGeometry(original.edges > 0 && original.components === 1, 'MAT component has no connected edges');
    const cleaned = simplifyMat(toScaleAxis(mat, 1.5), 0.05);
    requireGeometry(cleaned.cpNode, 'Cleaned MAT component has no node');
    const pruned = [];
    traverseEdges(cleaned.cpNode, (node) => pruned.push(...getMatCurveToNext(node)));
    const component = planStrokes(pruned);
    requireGeometry(component.edges > 0 && component.components === 1 && component.cycles === original.cycles, 'Cleanup lost MAT topology');
    flattenStrokes(component.strokes);
    curves.push(...pruned);
  }
  const planned = planStrokes(curves);
  requireGeometry(planned.components === mats.length, 'Missing MAT component');
  return flattenStrokes(planned.strokes);
}

function localized(names, key) {
  for (const platform of ['windows', 'macintosh', 'unicode']) {
    const entries = names[platform]?.[key];
    const value = entries?.en || (entries && Object.values(entries).find((entry) => typeof entry === 'string' && entry.trim()));
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

export async function convertFont(buffer, filename, onProgress = () => {}, priorityText = '') {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 12 || buffer.byteLength > MAX_FONT_BYTES) throw new Error('Expected an OTF/TTF ArrayBuffer no larger than 2 MB');
  const header = new DataView(buffer).getUint32(0);
  if (header !== 0x4f54544f && header !== 0x00010000 && header !== 0x74727565) throw new Error('Unsupported OTF/TTF header');
  if (typeof filename !== 'string' || typeof onProgress !== 'function' || typeof priorityText !== 'string') throw new Error('Invalid font conversion arguments');
  // Snapshot bytes before the first await so caller mutations cannot change the hashed font.
  const bytes = buffer.slice(0);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const source = opentype.parse(bytes);
  requireGeometry(Number.isFinite(source.unitsPerEm) && source.unitsPerEm > 0, 'Invalid unitsPerEm');
  const scale = 100 / source.unitsPerEm;
  let capHeight = 0;
  if (source.hasChar('H')) {
    const bounds = source.getPath('H', 0, 0, 100).getBoundingBox();
    capHeight = bounds.y2 - bounds.y1;
  }
  if (!Number.isFinite(capHeight) || capHeight <= 0) capHeight = source.ascender * scale;
  const font = {
    id: `custom-${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')}`,
    name: (localized(source.names, 'preferredFamily') || localized(source.names, 'fontFamily') || filename.replace(/\.(otf|ttf)$/i, '')).slice(0, 120),
    capHeight, spaceAdvance: source.charToGlyph(' ').advanceWidth * scale, glyphs: {},
  };
  const license = localized(source.names, 'license');
  if (license) font.license = license.slice(0, 2000);
  const loopsByChar = new Map();
  const checkedGlyph = (char, glyph) => validateCustomFonts([{ ...font, glyphs: { [char]: glyph } }])[0].glyphs[char];
  for (const char of chars) {
    const glyph = { advance: source.charToGlyph(char).advanceWidth * scale, outline: null, centerline: null };
    try {
      requireGeometry(source.hasChar(char), 'Missing source glyph');
      const path = source.getPath(char, 0, 0, 100);
      requireGeometry(path.commands.length <= 5000, 'Glyph exceeds 5000 path commands');
      const loops = getPathsFromStr(path.toPathData({ decimalPlaces: 5, optimize: false, flipY: false }));
      glyph.outline = flattenStrokes(loops);
      checkedGlyph(char, glyph);
      loopsByChar.set(char, loops);
    } catch (error) {
      glyph.outline = null;
      glyph.centerlineError = String(error.message || error).slice(0, 200);
    }
    font.glyphs[char] = checkedGlyph(char, glyph);
  }
  onProgress({ stage: 'outlines', font: validateCustomFonts([font])[0] });
  const order = [...new Set([...priorityText].filter((char) => chars.includes(char)).concat(chars))];
  let completed = 0;
  for (const char of order) {
    const glyph = font.glyphs[char];
    if (glyph.outline !== null) {
      try {
        glyph.centerline = centerlineFor(loopsByChar.get(char));
        checkedGlyph(char, glyph);
      } catch (error) {
        glyph.centerline = null;
        glyph.centerlineError = String(error.message || error).slice(0, 200);
      }
    }
    font.glyphs[char] = checkedGlyph(char, glyph);
    // Validate the aggregate before exposing each incremental result.
    validateCustomFonts([font]);
    onProgress({ stage: 'centerline', completed: ++completed, total: 94, char, glyph: structuredClone(font.glyphs[char]) });
  }
  return validateCustomFonts([font])[0];
}
