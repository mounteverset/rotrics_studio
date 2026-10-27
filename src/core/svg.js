import { MAX_ARTWORK_POINTS, MAX_ARTWORK_STROKES } from './project.js';

const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;
const IDENTITY = [1, 0, 0, 1, 0, 0];
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

export { flatten as flattenCurve };

function numbers(source) {
  const values = source.match(NUMBER) || [];
  if (source.replace(NUMBER, '').replace(/[\s,]/g, '') || values.some((n) => !Number.isFinite(Number(n)))) {
    throw new Error('SVG contains an invalid number');
  }
  return values.map(Number);
}

function multiply(a, b) {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
}

export function parseTransform(source = '') {
  let result = IDENTITY;
  const expression = /([a-zA-Z]+)\s*\(([^()]*)\)/g;
  let end = 0;
  for (const match of source.matchAll(expression)) {
    if (source.slice(end, match.index).replace(/[\s,]/g, '')) throw new Error('Invalid SVG transform');
    end = match.index + match[0].length;
    const p = numbers(match[2]);
    let matrix;
    if (match[1] === 'matrix' && p.length === 6) matrix = p;
    else if (match[1] === 'translate' && [1, 2].includes(p.length)) matrix = [1, 0, 0, 1, p[0], p[1] || 0];
    else if (match[1] === 'scale' && [1, 2].includes(p.length)) matrix = [p[0], 0, 0, p[1] ?? p[0], 0, 0];
    else if (match[1] === 'rotate' && [1, 3].includes(p.length)) {
      const angle = p[0] * Math.PI / 180;
      matrix = [Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 0, 0];
      if (p.length === 3) matrix = multiply(multiply([1, 0, 0, 1, p[1], p[2]], matrix), [1, 0, 0, 1, -p[1], -p[2]]);
    } else throw new Error(`Unsupported SVG transform: ${match[1]}. Use matrix, translate, scale, or rotate.`);
    result = multiply(result, matrix);
  }
  if (source.slice(end).trim() || result.some((n) => !Number.isFinite(n))) throw new Error('Invalid SVG transform');
  return result;
}

export function parsePath(source) {
  const tokens = source.match(/[a-zA-Z]|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) || [];
  if (source.replace(/[a-zA-Z]|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g, '').replace(/[\s,]/g, '')) {
    throw new Error('Invalid SVG path data');
  }
  const counts = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2 };
  const strokes = [];
  let stroke, command, previous, control, start;
  let current = { x: 0, y: 0 };
  let index = 0;
  let segments = 0;
  while (index < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[index])) command = tokens[index++];
    const type = command?.toUpperCase();
    const relative = command !== type;
    if (type === 'Z') {
      if (!stroke || previous === 'Z') throw new Error('SVG close-path requires a preceding move');
      stroke.push([current, start]);
      current = start;
      previous = 'Z';
      command = null;
      continue;
    }
    if (!counts[type]) throw new Error(`Unsupported SVG path command: ${command || 'missing move'}. Convert arcs to Bézier curves and text to paths.`);
    if (type !== 'M' && !stroke) throw new Error('SVG paths must begin with M or m');
    const values = tokens.slice(index, index + counts[type]).map(Number);
    if (values.length !== counts[type] || values.some((n) => !Number.isFinite(n))) throw new Error(`Incomplete SVG ${command} command`);
    index += counts[type];
    const point = (i) => ({ x: values[i] + (relative ? current.x : 0), y: values[i + 1] + (relative ? current.y : 0) });
    let next, controls = [];
    if (type === 'H') next = { x: values[0] + (relative ? current.x : 0), y: current.y };
    else if (type === 'V') next = { x: current.x, y: values[0] + (relative ? current.y : 0) };
    else next = point(values.length - 2);
    if (type === 'C') controls = [point(0), point(2)];
    if (type === 'Q') controls = [point(0)];
    if (type === 'S' || type === 'T') {
      const compatible = type === 'S' ? ['C', 'S'] : ['Q', 'T'];
      const reflected = compatible.includes(previous) ? { x: 2 * current.x - control.x, y: 2 * current.y - control.y } : current;
      controls = type === 'S' ? [reflected, point(0)] : [reflected];
    }
    if (type === 'M') {
      stroke = [];
      strokes.push(stroke);
      start = next;
      command = relative ? 'l' : 'L';
    } else stroke.push([current, ...controls, next]);
    control = controls.at(-1);
    previous = type;
    current = next;
    if (++segments > MAX_ARTWORK_POINTS || strokes.length > MAX_ARTWORK_STROKES) throw new Error('SVG is too complex; simplify its paths');
  }
  return strokes.filter((s) => s.length);
}

function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

function flatten(points, tolerance, output, depth = 0) {
  const first = points[0], last = points.at(-1);
  const chord = distance(first, last);
  const polygon = points.slice(1).reduce((sum, point, i) => sum + distance(points[i], point), 0);
  const flat = points.slice(1, -1).every((point) => {
    const t = chord ? Math.max(0, Math.min(1, ((point.x - first.x) * (last.x - first.x) + (point.y - first.y) * (last.y - first.y)) / chord ** 2)) : 0;
    return distance(point, { x: first.x + t * (last.x - first.x), y: first.y + t * (last.y - first.y) }) <= tolerance;
  });
  if (flat && polygon - chord <= tolerance) {
    output.push(last);
    if (output.length > MAX_ARTWORK_POINTS) throw new Error('SVG has too many points; simplify its paths');
    return;
  }
  if (depth >= 16) throw new Error('SVG curve is too complex; simplify its paths');
  const left = [first], right = [last];
  let row = points;
  while (row.length > 1) {
    row = row.slice(1).map((point, i) => ({ x: (row[i].x + point.x) / 2, y: (row[i].y + point.y) / 2 }));
    left.push(row[0]);
    right.unshift(row.at(-1));
  }
  flatten(left, tolerance, output, depth + 1);
  flatten(right, tolerance, output, depth + 1);
}

export function normalizeStrokes(segments) {
  const controls = segments.flat(2);
  if (segments.length > MAX_ARTWORK_STROKES || controls.length > MAX_ARTWORK_POINTS * 4) throw new Error('SVG is too complex; simplify its paths');
  if (!controls.length || controls.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > 1e9 || Math.abs(p.y) > 1e9)) {
    throw new Error('SVG has no drawable geometry or contains excessive coordinates');
  }
  const bounds = (points) => {
    const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  };
  const initial = bounds(controls);
  const tolerance = Math.max(initial.maxX - initial.minX, initial.maxY - initial.minY) / 8000;
  if (!tolerance) throw new Error('SVG must contain a nonzero-length drawing');
  let count = 0;
  const strokes = segments.map((stroke) => {
    const points = [stroke[0][0]];
    for (const segment of stroke) flatten(segment, tolerance, points);
    count += points.length;
    if (count > MAX_ARTWORK_POINTS) throw new Error(`SVG exceeds ${MAX_ARTWORK_POINTS} points; simplify its paths`);
    return points;
  });
  const box = bounds(strokes.flat());
  const span = Math.max(box.maxX - box.minX, box.maxY - box.minY);
  if (!span) throw new Error('SVG must contain a nonzero-length drawing');
  return strokes.map((stroke) => stroke.map((point) => ({
    x: Number(((point.x - (box.minX + box.maxX) / 2) / span).toFixed(6)),
    y: Number((-(point.y - (box.minY + box.maxY) / 2) / span).toFixed(6)),
  })));
}

function shapePath(element) {
  const name = element.localName;
  const n = (attribute, fallback = 0) => {
    const raw = element.getAttribute(attribute);
    if (raw === null) return fallback;
    const value = numbers(raw);
    if (value.length !== 1) throw new Error(`SVG ${attribute} must be a unitless number`);
    return value[0];
  };
  if (name === 'path') return element.getAttribute('d') || '';
  if (name === 'line') return `M${n('x1')} ${n('y1')} L${n('x2')} ${n('y2')}`;
  if (name === 'polyline' || name === 'polygon') {
    const points = numbers(element.getAttribute('points') || '');
    if (points.length < 4 || points.length % 2) throw new Error('SVG points need at least two XY pairs');
    return `M${points.join(' ')}${name === 'polygon' ? ' Z' : ''}`;
  }
  if (name === 'rect') {
    if (n('rx') || n('ry')) throw new Error('Convert rounded rectangles to Bézier paths before importing');
    const x = n('x'), y = n('y'), w = n('width'), h = n('height');
    if (w <= 0 || h <= 0) throw new Error('SVG rectangles need positive width and height');
    return `M${x} ${y} h${w} v${h} h${-w} Z`;
  }
  const x = n('cx'), y = n('cy');
  const rx = name === 'circle' ? n('r') : n('rx'), ry = name === 'circle' ? rx : n('ry');
  if (rx <= 0 || ry <= 0) throw new Error('SVG ellipses need positive radii');
  const k = 0.5522847498;
  return `M${x + rx} ${y} C${x + rx} ${y + k * ry} ${x + k * rx} ${y + ry} ${x} ${y + ry}
    C${x - k * rx} ${y + ry} ${x - rx} ${y + k * ry} ${x - rx} ${y}
    C${x - rx} ${y - k * ry} ${x - k * rx} ${y - ry} ${x} ${y - ry}
    C${x + k * rx} ${y - ry} ${x + rx} ${y - k * ry} ${x + rx} ${y} Z`;
}

export function importSvg(source, name = 'Imported SVG') {
  if (typeof source !== 'string' || source.length > 262144) throw new Error('SVG files must be smaller than 256 KB');
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(source)) throw new Error('SVG document types, entities, and external stylesheets are not supported');
  // Imported nodes stay in a detached XML document; only validated numeric geometry reaches the UI.
  const document = new DOMParser().parseFromString(source, 'image/svg+xml');
  const root = document.documentElement;
  if (document.querySelector('parsererror') || root.localName !== 'svg' || root.namespaceURI !== SVG_NAMESPACE) throw new Error('Expected a well-formed SVG document');
  const strokes = [];
  let nodes = 0;
  const visit = (element, parent, depth) => {
    if (++nodes > 1000 || depth > 30) throw new Error('SVG is too complex; simplify its groups');
    const tag = element.localName;
    if (element.namespaceURI !== SVG_NAMESPACE || !['svg', 'g', 'path', 'line', 'polyline', 'polygon', 'rect', 'circle', 'ellipse', 'title', 'desc'].includes(tag)) {
      throw new Error(`Unsupported SVG element: ${tag}. Export plain paths without text, images, styles, or clipping.`);
    }
    if (tag === 'svg' && element !== root) throw new Error('Nested SVG viewports are not supported');
    for (const attribute of element.attributes) {
      if (/^on/i.test(attribute.name) || ['style', 'class', 'href', 'clip-path', 'mask', 'filter', 'display', 'visibility', 'opacity', 'stroke-dasharray', 'marker-start', 'marker-mid', 'marker-end'].includes(attribute.localName) || /url\s*\(/i.test(attribute.value)) {
        throw new Error(`Unsupported SVG attribute: ${attribute.name}. Export plain visible paths.`);
      }
    }
    if (['title', 'desc'].includes(tag)) {
      if (element.children.length) throw new Error('SVG titles and descriptions must contain text only');
      return;
    }
    const matrix = multiply(parent, parseTransform(element.getAttribute('transform') || ''));
    if (tag !== 'svg' && tag !== 'g') {
      for (const stroke of parsePath(shapePath(element))) {
        strokes.push(stroke.map((segment) => segment.map(({ x, y }) => ({ x: matrix[0] * x + matrix[2] * y + matrix[4], y: matrix[1] * x + matrix[3] * y + matrix[5] }))));
        if (strokes.length > MAX_ARTWORK_STROKES) throw new Error(`SVG exceeds ${MAX_ARTWORK_STROKES} strokes`);
      }
    }
    for (const child of element.children) visit(child, matrix, depth + 1);
  };
  visit(root, IDENTITY, 0);
  return { name: name.slice(0, 120) || 'Imported SVG', strokes: normalizeStrokes(strokes) };
}
