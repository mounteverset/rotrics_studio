import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import opentype from 'opentype.js';
import { findMats, getPathsFromStr, toScaleAxis, simplifyMat, traverseEdges, getMatCurveToNext } from 'flo-mat';
import { planStrokes } from './centerline-geometry.js';
import { flattenCurve } from '../src/core/svg.js';
import { MAX_ARTWORK_POINTS, MAX_ARTWORK_STROKES } from '../src/core/project.js';

const args = process.argv.slice(2);
assert(args.length === 0 || args.length === 2, 'Usage: generate-paired-fonts.mjs [DejaVuSans.ttf DejaVuSerif.ttf]');
const paths = args.length ? args : [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf',
];
const settings = { em: 100, decimalPlaces: 5, applySat: false, simplify: false, scaleAxis: 1.5, simplifyTolerance: 0.05, flattenTolerance: 0.1 };
const versions = {};
for (const name of ['opentype.js', 'flo-mat']) {
  versions[name] = JSON.parse(await readFile(new URL(`../node_modules/${name}/package.json`, import.meta.url), 'utf8')).version;
}

function validateStrokes(strokes) {
  assert(strokes.length > 0 && strokes.length <= MAX_ARTWORK_STROKES, 'Invalid stroke count');
  let count = 0;
  for (const stroke of strokes) {
    assert(stroke.length >= 2, 'Stroke needs at least two points');
    assert(stroke.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)), 'Nonfinite coordinates');
    assert(stroke.some((p) => p.x !== stroke[0].x || p.y !== stroke[0].y), 'Zero-length stroke');
    count += stroke.length;
  }
  assert(count <= MAX_ARTWORK_POINTS, 'Glyph exceeds point cap');
}

function flattenStrokes(strokes) {
  const result = [];
  for (const curves of strokes) {
    if (!curves.length) continue;
    const points = [];
    for (const curve of curves) {
      assert([2, 3, 4].includes(curve.length), 'Invalid curve degree');
      // opentype SVG coordinates are Y-down; the bundle is Y-up at the original baseline.
      const controls = curve.map(([x, y]) => ({ x, y: -y }));
      assert(controls.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)), 'Nonfinite curve');
      if (!points.length) points.push(controls[0]);
      flattenCurve(controls, settings.flattenTolerance, points);
    }
    const rounded = points.map(({ x, y }) => ({ x: Number(x.toFixed(5)), y: Number(y.toFixed(5)) }));
    if (rounded.some((p) => p.x !== rounded[0].x || p.y !== rounded[0].y)) result.push(rounded);
  }
  if (result.length) validateStrokes(result);
  return result;
}

function centerlineFor(loops) {
  const mats = findMats(loops, { applySat: settings.applySat, simplify: settings.simplify });
  assert(mats.length > 0, 'No MAT components');
  const curves = [];
  for (const mat of mats) {
    assert(mat.cpNode, 'MAT component has no node');
    const raw = [];
    traverseEdges(mat.cpNode, (node) => raw.push(...getMatCurveToNext(node)));
    const original = planStrokes(raw);
    assert(original.edges > 0 && original.components === 1, 'MAT component has no nondegenerate connected edges');
    const cleaned = simplifyMat(toScaleAxis(mat, settings.scaleAxis), settings.simplifyTolerance);
    assert(cleaned.cpNode, 'Cleaned MAT component has no node');
    const pruned = [];
    traverseEdges(cleaned.cpNode, (node) => pruned.push(...getMatCurveToNext(node)));
    const component = planStrokes(pruned);
    assert(component.edges > 0 && component.components === 1 && component.cycles === original.cycles, 'Cleanup lost MAT topology');
    assert(flattenStrokes(component.strokes).length > 0, 'Flattening lost MAT component');
    curves.push(...pruned);
  }
  const planned = planStrokes(curves);
  assert.equal(planned.components, mats.length, 'Missing MAT component');
  const strokes = flattenStrokes(planned.strokes);
  validateStrokes(strokes);
  return strokes;
}

const paired = {};
const reports = [];
for (const [index, id] of ['dejavu-sans', 'dejavu-serif'].entries()) {
  const name = index === 0 ? 'DejaVu Sans' : 'DejaVu Serif';
  for (const [style, suffix] of Object.entries({ regular: '', bold: '-Bold', italic: index === 0 ? '-Oblique' : '-Italic', 'bold-italic': index === 0 ? '-BoldOblique' : '-BoldItalic' })) {
    const source = style === 'regular' ? paths[index] : join(dirname(paths[index]), `DejaVu${index === 0 ? 'Sans' : 'Serif'}${suffix}.ttf`);
    const info = await stat(source);
    assert(info.isFile() && info.size <= 10 * 1024 * 1024, 'Expected a font file no larger than 10 MB');
    const bytes = await readFile(source);
    assert(bytes.length <= 10 * 1024 * 1024, 'Font exceeds 10 MB');
    const font = opentype.parse(bytes);
    assert(Number.isFinite(font.unitsPerEm) && font.unitsPerEm > 0, 'Invalid unitsPerEm');
    const names = font.names.windows;
    assert.equal(names.preferredFamily?.en || names.fontFamily.en, name, 'Unexpected font family');
    const scale = settings.em / font.unitsPerEm;
    const bounds = font.getPath('H', 0, 0, settings.em).getBoundingBox();
    const entry = { name, capHeight: bounds.y2 - bounds.y1, spaceAdvance: font.charToGlyph(' ').advanceWidth * scale, glyphs: {} };
    const unavailable = [];
    for (let code = 33; code <= 126; code++) {
      const char = String.fromCharCode(code);
      assert(font.hasChar(char), `Missing source glyph ${JSON.stringify(char)}`);
      const path = font.getPath(char, 0, 0, settings.em);
      const loops = getPathsFromStr(path.toPathData({ decimalPlaces: settings.decimalPlaces, optimize: false, flipY: false }));
      const outline = flattenStrokes(loops);
      validateStrokes(outline);
      let centerline = null;
      try {
        centerline = centerlineFor(loops);
        assert(outline.length + centerline.length <= MAX_ARTWORK_STROKES, 'Glyph exceeds combined stroke cap');
        assert([...outline, ...centerline].reduce((sum, stroke) => sum + stroke.length, 0) <= MAX_ARTWORK_POINTS, 'Glyph exceeds combined point cap');
      } catch (error) {
        centerline = null;
        unavailable.push({ char, code, reason: error.message });
      }
      entry.glyphs[char] = { advance: font.charToGlyph(char).advanceWidth * scale, outline, centerline };
    }
    if (style === 'regular') paired[id] = { ...entry, styles: {} };
    else paired[id].styles[style] = entry;
    reports.push({ id, style, source, name, version: names.version.en, sha256: createHash('sha256').update(bytes).digest('hex'), glyphs: Object.keys(entry.glyphs).length, available: 94 - unavailable.length, unavailableCount: unavailable.length, unavailable });
    console.log(`${name} ${style}: 94 glyphs; ${unavailable.length} unavailable centerlines: ${unavailable.map(({ char }) => JSON.stringify(char)).join(', ') || 'none'}`);
  }
}

// Self-check the serialized artifact, including every available mode and source-space orientation.
const serialized = JSON.stringify(paired);
const checked = JSON.parse(serialized);
assert.equal(Object.keys(checked).length, 2);
for (const family of Object.values(checked)) {
  assert.deepEqual(Object.keys(family.styles), ['bold', 'italic', 'bold-italic']);
  for (const font of [family, ...Object.values(family.styles)]) {
    assert(Number.isFinite(font.capHeight) && font.capHeight > 0);
    assert(Number.isFinite(font.spaceAdvance) && font.spaceAdvance > 0);
    assert.equal(Object.keys(font.glyphs).length, 94);
    for (let code = 33; code <= 126; code++) {
      const glyph = font.glyphs[String.fromCharCode(code)];
      assert(Number.isFinite(glyph.advance) && glyph.advance > 0);
      validateStrokes(glyph.outline);
      for (const loop of glyph.outline) assert.deepEqual(loop[0], loop.at(-1), 'Open outline');
      if (glyph.centerline !== null) validateStrokes(glyph.centerline);
      const modes = [...glyph.outline, ...(glyph.centerline || [])];
      validateStrokes(modes);
    }
    const hPoints = font.glyphs.H.outline.flat();
    assert.equal(Math.min(...hPoints.map((p) => p.y)), 0, 'H baseline must be zero');
    assert(Math.abs(Math.max(...hPoints.map((p) => p.y)) - font.capHeight) < 1e-5, 'H must extend upward to capHeight');
  }
}
assert.equal(checked['dejavu-sans'].glyphs.T.centerline?.length, 2, 'Sans T needs two centerline strokes');
for (const loop of checked['dejavu-sans'].glyphs.T.outline) assert.deepEqual(loop[0], loop.at(-1));

const provenance = `// Generated by scripts/generate-paired-fonts.mjs from DejaVu TrueType fonts; see assets/fonts/DejaVu-LICENSE.txt.\n// ${JSON.stringify({ settings, versions, sources: reports.map(({ id, style, source, version, sha256 }) => ({ id, style, source, version, sha256 })) })}\n`;
await writeFile(new URL('../src/core/paired-font-data.js', import.meta.url), `${provenance}export const PAIRED_FONT_DATA = ${serialized};\n`);
console.log(JSON.stringify({ runtime: process.version, settings, versions, checks: '2 families × 4 styles × 94 glyphs; finite nonzero strokes; closed outlines; caps; Y-up H; Sans T = 2 strokes', reports }, null, 2));
