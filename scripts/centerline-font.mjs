import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import opentype from 'opentype.js';
import { findMats, getPathsFromStr, toScaleAxis, simplifyMat, traverseEdges, getMatCurveToNext } from 'flo-mat';
import { planStrokes, curvePath } from './centerline-geometry.js';
import { normalizeStrokes } from '../src/core/svg.js';
import { defaultProject, validateProject, drawingCommands } from '../src/core/project.js';

const [fontFile, text = 'T A O B i g 8', output = 'docs/experiments/centerline'] = process.argv.slice(2);
if (!fontFile) {
  console.error('Usage: npm run experiment:centerline -- /path/font.ttf "T A O B i g 8" [output-directory]');
  process.exit(1);
}
if (!text.trim() || text.length > 40 || /[\r\n\x00-\x1f]/.test(text)) throw new Error('Use 1–40 characters on a single line');
const info = await stat(fontFile);
if (!info.isFile() || info.size > 10 * 1024 * 1024) throw new Error('Select a font file smaller than 10 MB');
const data = await readFile(fontFile);
if (data.length > 10 * 1024 * 1024) throw new Error('Font files must be smaller than 10 MB');
const font = opentype.parse(data);
const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const label = font.names.fullName?.en || basename(fontFile);
const scale = 1.5;
const results = [];
let x = 0;
const centerlines = [], outlines = [], rawLines = [];
const projectCurves = [];
for (const char of text) {
  if (char === ' ') { x += 40; continue; }
  if (!font.hasChar(char)) throw new Error(`Font does not contain ${JSON.stringify(char)}`);
  const path = font.getPath(char, 0, 0, 100);
  const d = path.toPathData({ decimalPlaces: 5, optimize: false, flipY: false });
  const bounds = path.getBoundingBox();
  const start = performance.now();
  const mats = findMats(getPathsFromStr(d), { applySat: false, simplify: false });
  const raw = [], pruned = [];
  for (const mat of mats) {
    if (mat.cpNode) traverseEdges(mat.cpNode, (node) => raw.push(...getMatCurveToNext(node)));
    const sat = simplifyMat(toScaleAxis(mat, scale), 0.05);
    if (sat.cpNode) traverseEdges(sat.cpNode, (node) => pruned.push(...getMatCurveToNext(node)));
  }
  const planned = planStrokes(pruned);
  if (!planned.strokes.length) throw new Error(`No centerline produced for ${JSON.stringify(char)}; refusing to substitute outlines`);
  const rawGraph = planStrokes(raw);
  if (planned.components !== rawGraph.components || planned.cycles !== rawGraph.cycles) throw new Error(`Centerline cleanup changed topology for ${JSON.stringify(char)}`);
  const ms = performance.now() - start;
  const transform = `translate(${Number(x.toFixed(5))} 130)`;
  outlines.push(`<path transform="${transform}" d="${escape(d)}"/>`);
  centerlines.push(`<g transform="${transform}">${planned.strokes.map((stroke) => `<path d="${curvePath(stroke)}"/>`).join('')}</g>`);
  rawLines.push(`<g transform="${transform}">${rawGraph.strokes.map((stroke) => `<path d="${curvePath(stroke)}"/>`).join('')}</g>`);
  for (const stroke of planned.strokes) projectCurves.push(stroke.map((curve) => curve.map(([px, py]) => ({ x: px + x, y: py + 130 }))));
  results.push({ char, milliseconds: Number(ms.toFixed(2)), rawEdges: rawGraph.edges, prunedEdges: planned.edges, penStrokes: planned.strokes.length, components: planned.components, cycles: planned.cycles });
  x += Math.max(font.charToGlyph(char).advanceWidth / font.unitsPerEm * 100, bounds.x2) + 12;
}
const width = Math.ceil(x + 50);
const header = (height) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-25 0 ${width} ${height}" width="${width}" height="${height}">`;
const title = `${escape(label)} — ${escape(text)}`;
const cleanSvg = `${header(170)}<title>${title}</title><g fill="none" stroke="black" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">${centerlines.join('')}</g></svg>\n`;
const comparisonHeight = Math.max(650, 555 + results.length * 12);
const comparison = `${header(comparisonHeight)}<rect x="-25" width="${width}" height="${comparisonHeight}" fill="white"/>
  <g font-family="sans-serif" fill="#263448"><text x="0" y="22" font-size="17">${title}</text><text x="0" y="45" font-size="11">Original font outlines</text></g>
  <g fill="#cbd2de">${outlines.join('')}</g>
  <g transform="translate(0 175)"><text y="15" font-family="sans-serif" font-size="11">Raw medial axis — branches at corners are expected</text><g fill="#eef0f4">${outlines.join('')}</g><g fill="none" stroke="#ce5473" stroke-width="1">${rawLines.join('')}</g></g>
  <g transform="translate(0 350)"><text y="15" font-family="sans-serif" font-size="11">Pruned centerlines (scale ${scale}) — joined without duplicate edges</text><g fill="#eef0f4">${outlines.join('')}</g><g fill="none" stroke="#3564df" stroke-width="1.5" stroke-linecap="round">${centerlines.join('')}</g></g>
  <g font-family="sans-serif" font-size="10" fill="#62718a">${results.map((r, i) => `<text x="0" y="${535 + i * 12}">${escape(r.char)}: ${r.rawEdges} → ${r.prunedEdges} edges; ${r.penStrokes} pen strokes; ${r.components} components; ${r.cycles} cycles; ${r.milliseconds} ms</text>`).join('')}</g></svg>\n`;
const directory = resolve(output);
const project = validateProject({ ...defaultProject(), name: `Centerline ${label}`.slice(0, 80), size: 140,
  artwork: { name: `${label}: ${text}`.slice(0, 120), strokes: normalizeStrokes(projectCurves) } });
const commandCount = drawingCommands(project).length;
await mkdir(directory, { recursive: true });
await writeFile(join(directory, 'centerlines.svg'), cleanSvg);
await writeFile(join(directory, 'comparison.svg'), comparison);
await writeFile(join(directory, 'drawing.dexarm.json'), JSON.stringify(project, null, 2) + '\n');
await writeFile(join(directory, 'metrics.json'), JSON.stringify({ font: label, text, scale, simplifyTolerance: 0.05, runtime: process.version, commandCount, results }, null, 2) + '\n');
console.log(JSON.stringify({ directory, font: label, commandCount, results }, null, 2));
