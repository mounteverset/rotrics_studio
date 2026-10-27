const pointKey = ([x, y]) => `${x.toFixed(5)},${y.toFixed(5)}`;
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function curvePath(curves) {
  if (!curves.length) return '';
  const pair = (point) => point.map((v) => Number(v.toFixed(5))).join(' ');
  return `M${pair(curves[0][0])}` + curves.map((curve) => {
    const command = { 2: 'L', 3: 'Q', 4: 'C' }[curve.length];
    if (!command) throw new Error('Expected a line, quadratic, or cubic curve');
    return `${command}${curve.slice(1).map(pair).join(' ')}`;
  }).join('');
}

// Each undirected edge is consumed once; junctions prefer the straightest continuation.
export function planStrokes(curves) {
  const vertices = new Map();
  const unique = new Set();
  const edges = [];
  for (const curve of curves) {
    if (![2, 3, 4].includes(curve.length) || curve.some((p) => !Array.isArray(p) || p.length !== 2 || p.some((v) => !Number.isFinite(v)))) {
      throw new Error('Centerline returned invalid geometry');
    }
    if (curve.every((p) => distance(p, curve[0]) < 1e-5)) continue;
    const forward = curve.map(pointKey).join(';');
    const reverse = [...curve].reverse().map(pointKey).join(';');
    const key = forward < reverse ? forward : reverse;
    if (unique.has(key)) continue;
    unique.add(key);
    const edge = { curve, a: pointKey(curve[0]), b: pointKey(curve.at(-1)), used: false };
    edges.push(edge);
    for (const vertex of [edge.a, edge.b]) {
      if (!vertices.has(vertex)) vertices.set(vertex, []);
      vertices.get(vertex).push(edge);
    }
  }
  const strokes = [];
  let remaining = edges.length;
  while (remaining) {
    const available = [...vertices].map(([key, incident]) => ({ key, edges: incident.filter((e) => !e.used) })).filter((v) => v.edges.length);
    let vertex = (available.find((v) => v.edges.length === 1) || available[0]).key;
    const stroke = [];
    let incoming = null;
    while (true) {
      const candidates = vertices.get(vertex).filter((edge) => !edge.used);
      if (!candidates.length) break;
      let best, bestCurve, bestScore = -Infinity;
      for (const edge of candidates) {
        const curve = edge.a === vertex ? edge.curve : [...edge.curve].reverse();
        const next = curve.slice(1).find((p) => distance(p, curve[0]) > 1e-8) || curve.at(-1);
        const direction = [next[0] - curve[0][0], next[1] - curve[0][1]];
        const denominator = incoming ? Math.hypot(...incoming) * Math.hypot(...direction) : 0;
        const score = denominator ? (incoming[0] * direction[0] + incoming[1] * direction[1]) / denominator : 0;
        if (score > bestScore) { best = edge; bestCurve = curve; bestScore = score; }
      }
      best.used = true;
      remaining--;
      stroke.push(bestCurve);
      const last = bestCurve.at(-1);
      const previous = bestCurve.slice(0, -1).reverse().find((p) => distance(p, last) > 1e-8) || bestCurve[0];
      incoming = [last[0] - previous[0], last[1] - previous[1]];
      vertex = pointKey(last);
    }
    strokes.push(stroke);
  }
  let components = 0;
  const seen = new Set();
  for (const key of vertices.keys()) {
    if (seen.has(key)) continue;
    components++;
    const stack = [key];
    while (stack.length) {
      const vertex = stack.pop();
      if (seen.has(vertex)) continue;
      seen.add(vertex);
      for (const edge of vertices.get(vertex)) stack.push(edge.a === vertex ? edge.b : edge.a);
    }
  }
  return { strokes, edges: edges.length, components, cycles: edges.length - vertices.size + components };
}
