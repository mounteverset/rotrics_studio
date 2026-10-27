import { SIMULATOR_LIMITS, validatePosition } from './project.js';

function decimal(value) {
  const text = String(value);
  if (!text.includes('e')) return text;
  const [coefficient, exponent] = text.split('e');
  const sign = coefficient.startsWith('-') ? '-' : '';
  const digits = coefficient.replace(/[-.]/g, '');
  const point = 1 + Number(exponent);
  return point <= 0 ? `${sign}0.${'0'.repeat(-point)}${digits}`
    : `${sign}${digits.padEnd(point, '0').slice(0, point)}.${digits.slice(point) || '0'}`;
}

export function parseGcode(source) {
  if (typeof source !== 'string') throw new Error('G-code source must be a string');
  if (new TextEncoder().encode(source).length > 256 * 1024) throw new Error('G-code exceeds 256 KB');
  const commands = ['G21', 'G90'];
  const segments = [];
  let millimeters = false;
  let absolute = false;
  let declaredAbsolute = false;
  let feed;
  let start;
  let end;
  let bounds;
  let knownZ;
  let prefixMinZ = Infinity;
  let prefixMaxZ = -Infinity;
  let distance = 0;
  let estimatedSeconds = 0;
  let count = 0;
  const lines = source.split(/\r\n|\n|\r/);
  for (const [index, raw] of lines.entries()) {
    const fail = (message) => { throw new Error(`Line ${index + 1}: ${message}`); };
    const emit = (command) => {
      if (command.length > 128) fail('Normalized command exceeds SerialSession limit of 128 characters');
      commands.push(command);
    };
    let line = '';
    let comment = false;
    for (const char of raw) {
      if (char === ';' && !comment) break;
      if (char === '(') {
        if (comment) fail('Nested comment');
        comment = true;
        line += ' ';
      } else if (char === ')') {
        if (!comment) fail('Unmatched comment');
        comment = false;
      } else if (!comment) line += char;
    }
    if (comment) fail('Unclosed comment');
    line = line.trim();
    if (!line) continue;
    if (++count > 5000) fail('G-code exceeds 5000 command lines');
    const command = /^(G(?:00|01|0|1|21|90|91|4)|M400)(?![\d.])/i.exec(line);
    if (!command) fail('Unsupported command');
    const code = command[1].toUpperCase().replace(/^G0([01])$/, 'G$1');
    let rest = line.slice(command[0].length);
    const params = {};
    let zToken;
    while (rest.trim()) {
      const token = /^\s*([XYZFPS])([+-]?(?:\d+(?:\.\d*)?|\.\d+))/i.exec(rest);
      if (!token) fail('Malformed or unsupported token');
      const key = token[1].toUpperCase();
      if (Object.hasOwn(params, key)) fail(`Duplicate ${key}`);
      const value = Number(token[2]) + 0;
      if (!Number.isFinite(value)) fail('Nonfinite number');
      params[key] = value;
      if (key === 'Z') zToken = token[2];
      rest = rest.slice(token[0].length);
    }
    const keys = Object.keys(params);
    const allowed = code === 'G0' || code === 'G1' ? 'XYZF' : code === 'G4' ? 'PS' : '';
    if (keys.some((key) => !allowed.includes(key))) fail('Unsupported parameter');
    if (code === 'G21') millimeters = true;
    else if (code === 'G90') { absolute = true; declaredAbsolute = true; }
    else if (code === 'G91') {
      if (!start) fail('Relative mode requires a known start');
      absolute = false;
    } else if (code === 'M400') emit('M400');
    else if (code === 'G4') {
      if (keys.length !== 1) fail('Dwell requires exactly one P or S');
      const ms = params.P ?? params.S * 1000;
      if (!Number.isFinite(ms) || ms < 0 || ms > 2000) fail('Dwell must be 0–2000 ms');
      estimatedSeconds += ms / 1000;
      emit(`G4 P${decimal(ms)}`);
    } else {
      if (params.F !== undefined) {
        if (params.F < 60 || params.F > 3000) fail('Feed must be 60–3000 mm/min');
        feed = params.F;
      }
      const axes = ['x', 'y', 'z'];
      if (!axes.some((axis) => params[axis.toUpperCase()] !== undefined)) {
        if (code !== 'G1' || keys.length !== 1 || params.F === undefined) fail('Motion requires axes');
        continue;
      }
      if (!millimeters || !declaredAbsolute) fail('Declare G21 and G90 before motion');
      if (!start && params.X === undefined && params.Y === undefined) {
        if (params.F === undefined) fail('Initial Z motion requires explicit F');
        const [min, max] = SIMULATOR_LIMITS.z;
        if (params.Z < min || params.Z > max) fail(`Z must be between ${min} and ${max} mm in the simulator`);
        knownZ = params.Z;
        prefixMinZ = Math.min(prefixMinZ, knownZ);
        prefixMaxZ = Math.max(prefixMaxZ, knownZ);
        emit(`G1 Z${zToken} F${decimal(feed)}`);
        continue;
      }
      if (!start && (params.X === undefined || params.Y === undefined || (params.Z === undefined && knownZ === undefined))) {
        fail('First XY motion requires both X/Y and a known Z');
      }
      if (feed === undefined) fail('First motion requires F');
      const target = Object.fromEntries(axes.map((axis) => {
        const value = params[axis.toUpperCase()];
        return [axis, value === undefined ? (end ? end[axis] : knownZ) : absolute ? value : end[axis] + value];
      }));
      try { validatePosition(target); } catch (error) { fail(error.message); }
      if (!start) {
        start = target;
        bounds = { min: { ...target }, max: { ...target } };
        bounds.min.z = Math.min(target.z, prefixMinZ);
        bounds.max.z = Math.max(target.z, prefixMaxZ);
      } else {
        const length = Math.hypot(...axes.map((axis) => target[axis] - end[axis]));
        segments.push({ from: { ...end }, to: { ...target }, rapid: code === 'G0' });
        distance += length;
        estimatedSeconds += length / feed * 60;
      }
      for (const axis of axes) {
        bounds.min[axis] = Math.min(bounds.min[axis], target[axis]);
        bounds.max[axis] = Math.max(bounds.max[axis], target[axis]);
      }
      end = target;
      emit(`G1 X${decimal(target.x)} Y${decimal(target.y)} Z${decimal(target.z)} F${decimal(feed)}`);
    }
  }
  if (!start) throw new Error(`Line ${lines.length}: G-code contains no motion`);
  while (commands.at(-1) === 'M400') commands.pop();
  commands.push('M400');
  return { commands, segments, start, end, bounds, distance, estimatedSeconds };
}
