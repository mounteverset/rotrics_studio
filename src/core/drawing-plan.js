function point(value) {
  if (!value || !['x', 'y', 'z'].every((axis) => Number.isFinite(value[axis]))) {
    throw new Error('Expected finite XYZ coordinates');
  }
}

function validateStrokes(strokes) {
  if (!Array.isArray(strokes) || strokes.length > 200) throw new Error('Expected at most 200 strokes');
  let count = 0;
  for (const stroke of strokes) {
    if (!Array.isArray(stroke) || stroke.length < 2 || (count += stroke.length) > 2000) {
      throw new Error('Expected strokes with at least two points and at most 2000 total points');
    }
    for (const value of stroke) point(value);
  }
}

function positive(value, label, allowZero = false) {
  if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) throw new Error(`Invalid ${label}`);
}

const xyDistance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Even-odd fill in XY; every generated endpoint uses the first input point's Z. */
export function hatchStrokes(strokes, spacing = 2, angle = 0) {
  validateStrokes(strokes);
  if (!Number.isFinite(spacing) || spacing < 0.5 || spacing > 20) throw new Error('Spacing must be 0.5–20 mm');
  if (!Number.isFinite(angle) || angle < -180 || angle > 180) throw new Error('Angle must be −180–180 degrees');
  if (!strokes.length) return [];
  const radians = angle * Math.PI / 180;
  const cos = Math.cos(radians), sin = Math.sin(radians);
  const contours = strokes.map((stroke) => {
    const first = stroke[0], last = stroke.at(-1);
    if (stroke.length < 4 || first.x !== last.x || first.y !== last.y || first.z !== last.z) {
      throw new Error('Fill requires closed, nondegenerate contours');
    }
    const rotated = stroke.map(({ x, y }) => ({ x: x * cos + y * sin, y: -x * sin + y * cos }));
    let area = 0;
    for (let i = 1; i < rotated.length; i++) {
      area += (rotated[i - 1].x - rotated[0].x) * (rotated[i].y - rotated[0].y)
        - (rotated[i].x - rotated[0].x) * (rotated[i - 1].y - rotated[0].y);
    }
    if (!Number.isFinite(area) || Math.abs(area) < 1e-10) throw new Error('Fill requires nondegenerate contours');
    return rotated;
  });
  const points = contours.flat();
  const min = Math.min(...points.map((p) => p.y));
  const max = Math.max(...points.map((p) => p.y));
  const rows = Math.ceil((max - min) / spacing);
  // Bound work before scanning even when contours cancel under the even-odd rule.
  if (!Number.isFinite(rows) || rows > 2000 || rows * points.length > 400000) {
    throw new Error('Hatch complexity exceeds limits');
  }
  const output = [];
  const z = strokes[0][0].z;
  for (let row = 0; row < rows; row++) {
    const y = min + row * spacing;
    const intersections = [];
    for (const contour of contours) {
      for (let i = 1; i < contour.length; i++) {
        const a = contour[i - 1], b = contour[i];
        // Half-open edges count a shared vertex once and ignore horizontal edges.
        if ((a.y <= y && y < b.y) || (b.y <= y && y < a.y)) {
          intersections.push(a.x + (y - a.y) / (b.y - a.y) * (b.x - a.x));
        }
      }
    }
    intersections.sort((a, b) => a - b);
    for (let i = 0; i + 1 < intersections.length; i += 2) {
      if (intersections[i + 1] - intersections[i] <= 1e-10) continue;
      if (output.length >= 200) throw new Error('Hatch exceeds 200 strokes / 2000 points');
      output.push([intersections[i], intersections[i + 1]].map((x) => ({ x: x * cos - y * sin, y: x * sin + y * cos, z })));
    }
  }
  return output;
}

function travel(strokes, start) {
  let distance = 0;
  for (const stroke of strokes) {
    distance += xyDistance(start, stroke[0]);
    start = stroke.at(-1);
  }
  return distance;
}

/** Stable nearest-endpoint greedy order, with no final trip home; returns independent copies. */
export function optimizeStrokes(strokes, start) {
  validateStrokes(strokes);
  point(start);
  const remaining = strokes.map((stroke) => stroke.map((p) => ({ ...p })));
  const ordered = [];
  let current = start;
  while (remaining.length) {
    let best = 0, reverse = false, distance = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      for (const end of [false, true]) {
        const candidate = xyDistance(current, end ? remaining[i].at(-1) : remaining[i][0]);
        if (candidate < distance) { best = i; reverse = end; distance = candidate; }
      }
    }
    const [stroke] = remaining.splice(best, 1);
    if (reverse) stroke.reverse();
    ordered.push(stroke);
    current = stroke.at(-1);
  }
  return travel(ordered, start) <= travel(strokes, start)
    ? ordered : strokes.map((stroke) => stroke.map((p) => ({ ...p })));
}

/** Assumes initial XY at origin, omits the unknown robot approach and any trip home.
 * Draw distance is XYZ; clearance travel is XY; each stroke adds two penLift moves at 600 mm/min.
 */
export function drawingMetrics(strokes, origin, workFeedrate, travelFeedrate, penLift) {
  validateStrokes(strokes);
  point(origin);
  positive(workFeedrate, 'work feedrate');
  positive(travelFeedrate, 'travel feedrate');
  positive(penLift, 'pen lift', true);
  let drawDistance = 0, pointCount = 0;
  for (const stroke of strokes) {
    pointCount += stroke.length;
    for (let i = 1; i < stroke.length; i++) {
      drawDistance += Math.hypot(...['x', 'y', 'z'].map((axis) => stroke[i][axis] - stroke[i - 1][axis]));
    }
  }
  const travelDistance = travel(strokes, origin);
  const liftDistance = 2 * penLift * strokes.length;
  const seconds = 60 * (drawDistance / workFeedrate + travelDistance / travelFeedrate + liftDistance / 600);
  if (![drawDistance, travelDistance, liftDistance, seconds].every(Number.isFinite)) throw new Error('Metrics exceed finite range');
  return { drawDistance, travelDistance, liftDistance, seconds, strokeCount: strokes.length, pointCount };
}

/** Bounds are absolute XY; caller validates robot target bounds, including clearance. */
export function boundaryCommands(strokes, origin, travelFeedrate, penLift) {
  validateStrokes(strokes);
  if (!strokes.length) throw new Error('Boundary requires nonempty strokes');
  point(origin);
  positive(travelFeedrate, 'travel feedrate');
  positive(penLift, 'pen lift');
  const z = origin.z + penLift;
  if (!Number.isFinite(z)) throw new Error('Clearance must be finite');
  const points = strokes.flat();
  const minX = Math.min(...points.map((p) => p.x)), maxX = Math.max(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y)), maxY = Math.max(...points.map((p) => p.y));
  return ['G21', 'G90', `G1 Z${z.toFixed(3)} F600`,
    ...[[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY], [minX, minY]].map(([x, y]) =>
      `G1 X${x.toFixed(3)} Y${y.toFixed(3)} Z${z.toFixed(3)} F${travelFeedrate}`), 'M400'];
}
