import { hatchStrokes, optimizeStrokes } from './drawing-plan.js';
import { validateCustomFonts } from './custom-font.js';
import { validateWriting, writingLayout } from './writing.js';

export const SIMULATOR_LIMITS = { x: [-150, 150], y: [180, 380], z: [-20, 100] };
export const MAX_ARTWORK_POINTS = 2000;
export const MAX_ARTWORK_STROKES = 200;

export function validatePosition(position) {
  for (const [axis, [min, max]] of Object.entries(SIMULATOR_LIMITS)) {
    const value = position[axis];
    if (!Number.isFinite(value) || value < min || value > max) {
      throw new Error(`${axis.toUpperCase()} must be between ${min} and ${max} mm in the simulator`);
    }
  }
  return position;
}

export function defaultProject() {
  return { version: 1, name: 'First light', size: 80, origin: { x: 0, y: 280, z: 0 }, feedrate: 1200 };
}

export function validateProject(value) {
  if (!value || ![1, 2, 3].includes(value.version) || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 80) {
    throw new Error('Expected a version 1, 2 or 3 Studio project with a name (1–80 characters)');
  }
  if (!Number.isFinite(value.size) || value.size < 10 || value.size > 140) throw new Error('Drawing size must be 10–140 mm');
  if (!Number.isFinite(value.feedrate) || value.feedrate < 60 || value.feedrate > 3000) throw new Error('Feed rate must be 60–3000 mm/min');
  if (!value.origin || typeof value.origin !== 'object') throw new Error('Project is missing its origin');
  const project = {
    version: value.version, name: value.name.trim(), size: value.size, feedrate: value.feedrate,
    origin: { x: value.origin.x, y: value.origin.y, z: value.origin.z },
  };
  if (value.fonts !== undefined) project.fonts = validateCustomFonts(value.fonts);
  for (const [key, min, max, label] of [['travelFeedrate', 60, 3000, 'Travel speed'], ['penLift', 1, 30, 'Pen lift']]) {
    if (value[key] !== undefined) {
      if (!Number.isFinite(value[key]) || value[key] < min || value[key] > max) throw new Error(`${label} must be between ${min} and ${max}`);
      project[key] = value[key];
    }
  }
  if (value.options !== undefined) {
    const options = value.options;
    if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('Invalid drawing options');
    project.options = {};
    for (const key of ['optimize', 'hatch']) {
      if (options[key] !== undefined) {
        if (typeof options[key] !== 'boolean') throw new Error(`${key} must be boolean`);
        project.options[key] = options[key];
      }
    }
    for (const [key, min, max] of [['hatchSpacing', .5, 20], ['hatchAngle', -180, 180]]) {
      if (options[key] !== undefined) {
        if (!Number.isFinite(options[key]) || options[key] < min || options[key] > max) throw new Error(`Invalid ${key}`);
        project.options[key] = options[key];
      }
    }
  }
  if (value.version === 3) {
    if (value.artwork !== undefined || value.writing !== undefined) throw new Error('Version 3 uses artworks and texts');
    if (!Array.isArray(value.artworks) || value.artworks.length > 20) throw new Error('Layout needs at most 20 artworks');
    if (value.paper !== undefined) {
      const paper = value.paper;
      if (!paper || !['width', 'height', 'margin', 'x', 'y'].every((key) => Number.isFinite(paper[key])) ||
          paper.width < 10 || paper.width > 1000 || paper.height < 10 || paper.height > 1000 ||
          paper.margin < 0 || paper.margin >= Math.min(paper.width, paper.height) / 2 || Math.abs(paper.x) > 1000 || Math.abs(paper.y) > 1000) {
        throw new Error('Invalid paper dimensions, margin or origin offsets');
      }
      project.paper = Object.fromEntries(['width', 'height', 'margin', 'x', 'y'].map((key) => [key, paper[key]]));
    }
    const ids = new Set();
    project.artworks = Array.from(value.artworks, (artwork) => {
      validateId(artwork?.id, ids);
      // Reuse the legacy normalized-source validation without changing its serialized shape.
      const source = validateProject({ ...defaultProject(), size: 10, artwork: { name: artwork.name, strokes: artwork.strokes } }).artwork;
      const bounds = sourceBounds(source.strokes);
      for (const [key, limit] of [['x', 300], ['y', 200], ['rotation', 180]]) {
        if (!Number.isFinite(artwork[key]) || Math.abs(artwork[key]) > limit) throw new Error(`Invalid artwork ${key}`);
      }
      for (const key of ['width', 'height']) {
        const extent = key === 'width' ? bounds.right - bounds.left : bounds.top - bounds.bottom;
        if (!Number.isFinite(artwork[key]) || artwork[key] < 0 || artwork[key] > 300 || (artwork[key] === 0) !== (extent === 0)) {
          throw new Error(`Invalid artwork ${key}: zero is only valid for a degenerate source axis`);
        }
      }
      if (typeof artwork.mirrorX !== 'boolean' || typeof artwork.mirrorY !== 'boolean') throw new Error('Artwork mirrors must be boolean');
      return { id: artwork.id, ...source, x: artwork.x, y: artwork.y, rotation: artwork.rotation,
        width: artwork.width, height: artwork.height, mirrorX: artwork.mirrorX, mirrorY: artwork.mirrorY, ...validatedGroup(artwork) };
    });
  } else if (value.artworks !== undefined || value.paper !== undefined) throw new Error('Artworks and paper require version 3');
  if (value.version === 2 || value.version === 3) {
    if (value.writing !== undefined) throw new Error('Layout projects use text boxes instead of single writing');
    if (!Array.isArray(value.texts) || value.texts.length > 20) throw new Error('Layout needs an array of at most 20 text boxes');
    const ids = new Set();
    project.texts = Array.from(value.texts, (text) => {
      if (!text || typeof text.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(text.id) || ids.has(text.id)) {
        throw new Error('Each text box needs a unique ID');
      }
      ids.add(text.id);
      if (!Number.isFinite(text.x) || !Number.isFinite(text.y) || Math.abs(text.x) > 300 || Math.abs(text.y) > 200) {
        throw new Error('Text box X/Y offsets must be finite and within the workspace dimensions');
      }
      if (text.rotation !== undefined && (!Number.isFinite(text.rotation) || Math.abs(text.rotation) > 180)) {
        throw new Error('Text rotation must be between −180 and 180 degrees');
      }
      return { id: text.id, x: text.x, y: text.y, writing: validateWriting(text.writing, project.fonts),
        ...(text.rotation !== undefined ? { rotation: text.rotation } : {}), ...validatedGroup(text) };
    });
  } else if (value.texts !== undefined) throw new Error('Text boxes require a version 2 layout project');
  if (value.writing !== undefined) {
    if (value.artwork !== undefined) throw new Error('Choose either writing or SVG artwork in a project');
    project.writing = validateWriting(value.writing, project.fonts);
    const { strokes } = writingLayout(project.writing, project.fonts);
    if (strokes.length > MAX_ARTWORK_STROKES || strokes.reduce((sum, stroke) => sum + stroke.length, 0) > MAX_ARTWORK_POINTS) {
      throw new Error(`Writing exceeds ${MAX_ARTWORK_STROKES} strokes or ${MAX_ARTWORK_POINTS} points. Shorten the text or choose a simpler font.`);
    }
  }
  if (value.artwork !== undefined) {
    const artwork = value.artwork;
    if (!artwork || typeof artwork !== 'object' || Array.isArray(artwork) || typeof artwork.name !== 'string' ||
        !artwork.name.trim() || artwork.name.length > 120) {
      throw new Error('Artwork needs a name (1–120 characters)');
    }
    if (!Array.isArray(artwork.strokes) || !artwork.strokes.length || artwork.strokes.length > MAX_ARTWORK_STROKES) {
      throw new Error(`Artwork needs 1–${MAX_ARTWORK_STROKES} strokes`);
    }
    let pointCount = 0;
    let hasLength = false;
    const strokes = [];
    for (const stroke of artwork.strokes) {
      if (!Array.isArray(stroke) || stroke.length < 2) throw new Error('Each artwork stroke needs at least two points');
      pointCount += stroke.length;
      if (pointCount > MAX_ARTWORK_POINTS) throw new Error(`Artwork exceeds ${MAX_ARTWORK_POINTS} points`);
      const points = [];
      for (const point of stroke) {
        if (!point || typeof point !== 'object' || Array.isArray(point) || !Number.isFinite(point.x) || !Number.isFinite(point.y) ||
            Math.abs(point.x) > 0.5 || Math.abs(point.y) > 0.5) {
          throw new Error('Artwork points need normalized X/Y coordinates between -0.5 and 0.5');
        }
        const previous = points.at(-1);
        if (previous && (previous.x !== point.x || previous.y !== point.y)) hasLength = true;
        points.push({ x: point.x, y: point.y });
      }
      strokes.push(points);
    }
    if (!hasLength) throw new Error('Artwork must have some nonzero length');
    const placement = {};
    for (const [key, limit] of [['x', 300], ['y', 200], ['rotation', 180]]) {
      if (artwork[key] !== undefined) {
        if (!Number.isFinite(artwork[key]) || Math.abs(artwork[key]) > limit) throw new Error(`Artwork ${key} must be between ${-limit} and ${limit}`);
        placement[key] = artwork[key];
      }
    }
    project.artwork = { name: artwork.name.trim(), strokes, ...placement };
  }
  if (project.version === 3) {
    if (project.texts.length + project.artworks.length > 40) throw new Error('Layout needs at most 40 objects');
    const ids = new Set(project.artworks.map((artwork) => artwork.id));
    for (const text of project.texts) validateId(text.id, ids);
  }
  const strokes = drawingStrokes(project);
  if (strokes.length > MAX_ARTWORK_STROKES || strokes.reduce((sum, stroke) => sum + stroke.length, 0) > MAX_ARTWORK_POINTS) {
    throw new Error(`Layout exceeds ${MAX_ARTWORK_STROKES} strokes or ${MAX_ARTWORK_POINTS} points. Shorten text or simplify the layout.`);
  }
  validatePosition(project.origin);
  for (const point of strokes.flat()) {
    validatePosition(point);
    validatePosition({ ...point, z: point.z + (project.penLift ?? 10) });
  }
  return project;
}

export function drawingStrokes(project) {
  let strokes = baseDrawingStrokes(project);
  if (project.options?.hatch) {
    const objects = project.version === 3 ? project.artworks.map((artwork) => artworkStrokes(artwork, project.origin)) :
      project.artwork ? [baseDrawingStrokes({ ...project, version: 1 })] : [];
    for (const paths of objects) {
      const closed = paths.filter((stroke) => stroke.length >= 4 &&
        stroke[0].x === stroke.at(-1).x && stroke[0].y === stroke.at(-1).y);
      if (closed.length) strokes = [...strokes, ...hatchStrokes(closed, project.options.hatchSpacing, project.options.hatchAngle)];
    }
  }
  return project.options?.optimize ? optimizeStrokes(strokes, project.origin) : strokes;
}

function baseDrawingStrokes(project) {
  const { x, y, z } = project.origin;
  if (project.version === 3) {
    return [...project.artworks.flatMap((artwork) => artworkStrokes(artwork, project.origin)),
      ...project.texts.flatMap((text) => textLayout(text, project.fonts).strokes.map((stroke) =>
        stroke.map((point) => ({ x: x + text.x + point.x, y: y + text.y + point.y, z }))))];
  }
  if (project.version === 2) {
    const artwork = project.artwork ? baseDrawingStrokes({ ...project, version: 1 }) : [];
    return [...artwork, ...project.texts.flatMap((text) => textLayout(text, project.fonts).strokes.map((stroke) =>
      stroke.map((point) => ({ x: x + text.x + point.x, y: y + text.y + point.y, z }))))];
  }
  if (project.writing) {
    return writingLayout(project.writing, project.fonts).strokes.map((stroke) => stroke.map((point) => ({ x: x + point.x, y: y + point.y, z })));
  }
  if (project.artwork) {
    const artwork = project.artwork;
    const angle = (artwork.rotation || 0) * Math.PI / 180;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    return artwork.strokes.map((stroke) => stroke.map((point) => ({
      x: x + (artwork.x || 0) + (point.x * cosine - point.y * sine) * project.size,
      y: y + (artwork.y || 0) + (point.x * sine + point.y * cosine) * project.size, z,
    })));
  }
  const points = Array.from({ length: 10 }, (_, i) => {
    const angle = Math.PI / 2 + i * Math.PI / 5;
    const radius = project.size / 2 * (i % 2 ? 0.45 : 1);
    return { x: x + Math.cos(angle) * radius, y: y + Math.sin(angle) * radius, z };
  });
  return [[...points, { ...points[0] }]];
}

export function drawingPoints(project) {
  return drawingStrokes(project).flat();
}

export function drawingCommands(value) {
  const project = validateProject(value);
  const strokes = drawingStrokes(project);
  if (!strokes.length) throw new Error('Add text or import artwork before generating G-code');
  const move = (point, z = point.z, feedrate = project.feedrate) => `G1 X${point.x.toFixed(3)} Y${point.y.toFixed(3)} Z${z.toFixed(3)} F${feedrate}`;
  const clearance = project.origin.z + (project.penLift ?? 10);
  const lift = `G1 Z${clearance.toFixed(3)} F600`;
  return ['G21', 'G90', lift, ...strokes.flatMap((points) => [
    move(points[0], clearance, project.travelFeedrate ?? project.feedrate), ...points.map((point) => move(point)), lift,
  ]), 'M400'];
}

// Upgrade only when editing a layout; legacy projects keep their exact serialized form.
export function layoutProject(value) {
  const project = validateProject(value);
  if (project.version === 2 || project.version === 3) return project;
  const { writing, ...rest } = project;
  return { ...rest, version: 2, texts: writing ? [{ id: 'text-1', x: 0, y: 0, writing }] : [] };
}

function textLayout(text, fonts) {
  const layout = writingLayout(text.writing, fonts);
  const angle = (text.rotation || 0) * Math.PI / 180;
  const rotate = ({ x, y }) => !angle ? { x, y } : {
    x: x * Math.cos(angle) - y * Math.sin(angle), y: x * Math.sin(angle) + y * Math.cos(angle),
  };
  return { strokes: layout.strokes.map((stroke) => stroke.map(rotate)),
    corners: [-1, 1].flatMap((x) => [-1, 1].map((y) => rotate({ x: x * layout.width / 2, y: y * layout.height / 2 }))) };
}

export function textBounds(text, origin, fonts = []) {
  const layout = textLayout(text, fonts);
  const points = [...layout.strokes.flat(), ...layout.corners];
  return {
    left: origin.x + text.x + Math.min(...points.map((p) => p.x)),
    right: origin.x + text.x + Math.max(...points.map((p) => p.x)),
    bottom: origin.y + text.y + Math.min(...points.map((p) => p.y)),
    top: origin.y + text.y + Math.max(...points.map((p) => p.y)),
  };
}

function validateId(id, ids) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(id) || ids.has(id)) throw new Error('Each layout object needs a unique ID');
  ids.add(id);
}

function validatedGroup(object) {
  if (object.group === undefined) return {};
  if (typeof object.group !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(object.group)) {
    throw new Error('Object group must use 1–80 letters, digits, underscores or hyphens');
  }
  return { group: object.group };
}

function sourceBounds(strokes) {
  const points = strokes.flat();
  return { left: Math.min(...points.map((p) => p.x)), right: Math.max(...points.map((p) => p.x)),
    bottom: Math.min(...points.map((p) => p.y)), top: Math.max(...points.map((p) => p.y)) };
}

export function artworkStrokes(artwork, origin) {
  const bounds = sourceBounds(artwork.strokes);
  const width = bounds.right - bounds.left;
  const height = bounds.top - bounds.bottom;
  const angle = artwork.rotation * Math.PI / 180;
  return artwork.strokes.map((stroke) => stroke.map((point) => {
    const x = (point.x - (bounds.left + bounds.right) / 2) * (width ? artwork.width / width : 0) * (artwork.mirrorX ? -1 : 1);
    const y = (point.y - (bounds.bottom + bounds.top) / 2) * (height ? artwork.height / height : 0) * (artwork.mirrorY ? -1 : 1);
    return { x: origin.x + artwork.x + x * Math.cos(angle) - y * Math.sin(angle),
      y: origin.y + artwork.y + x * Math.sin(angle) + y * Math.cos(angle), z: origin.z };
  }));
}

export function artworkBounds(artwork, origin) {
  return sourceBounds(artworkStrokes(artwork, origin));
}

export function upgradeLayout(value) {
  const project = validateProject(value);
  if (project.version === 3) return project;
  const { artwork, writing, ...common } = project;
  const texts = project.version === 2 ? project.texts : writing ? [{ id: 'text-1', x: 0, y: 0, writing }] : [];
  const artworks = [];
  if (artwork || (project.version === 1 && !writing)) {
    const source = artwork ?? { name: 'Star', strokes: baseDrawingStrokes(project).map((stroke) => stroke.map((p) =>
      ({ x: (p.x - project.origin.x) / project.size, y: (p.y - project.origin.y) / project.size }))) };
    const bounds = sourceBounds(source.strokes);
    const cx = (bounds.left + bounds.right) / 2 * project.size;
    const cy = (bounds.bottom + bounds.top) / 2 * project.size;
    const angle = (source.rotation ?? 0) * Math.PI / 180;
    let id = 'artwork-1';
    while (texts.some((text) => text.id === id)) id += '-1';
    artworks.push({ id, name: source.name, strokes: source.strokes,
      x: (source.x ?? 0) + cx * Math.cos(angle) - cy * Math.sin(angle),
      y: (source.y ?? 0) + cx * Math.sin(angle) + cy * Math.cos(angle), rotation: source.rotation ?? 0,
      width: (bounds.right - bounds.left) * project.size, height: (bounds.top - bounds.bottom) * project.size,
      mirrorX: false, mirrorY: false });
  }
  return validateProject({ ...common, version: 3, texts, artworks });
}
