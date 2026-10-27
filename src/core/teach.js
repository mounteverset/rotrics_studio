import { validatePosition } from './project.js';

const actions = {
  suction: { pick: 'M1000', release: 'M1002', neutral: 'M1002', off: 'M1003' },
  gripper: { pick: 'M1001', release: 'M1000', neutral: 'M1002', off: 'M1003' },
};

function fields(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some((key) => !keys.includes(key))) {
    throw new Error('Expected an object with only supported sequence fields');
  }
}

function name(value, max) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new Error(`Name must contain 1–${max} characters`);
  }
  return value.trim();
}

export function defaultSequence() {
  return { version: 1, kind: 'teach', name: 'Teach sequence', tool: 'pen', repeat: 1, steps: [] };
}

export function validateSequence(value) {
  fields(value, ['version', 'kind', 'name', 'tool', 'repeat', 'steps']);
  if (value.version !== 1 || value.kind !== 'teach') throw new Error('Expected a version 1 teach sequence');
  if (!['pen', 'suction', 'gripper'].includes(value.tool)) throw new Error('Unsupported teach tool');
  if (!Number.isInteger(value.repeat) || value.repeat < 1 || value.repeat > 20) throw new Error('Repeat must be an integer from 1–20');
  if (!Array.isArray(value.steps) || value.steps.length > 100) throw new Error('Expected at most 100 steps');
  const sequence = { version: 1, kind: 'teach', name: name(value.name, 80), tool: value.tool, repeat: value.repeat, steps: [] };
  let wait = 0;
  for (const step of value.steps) {
    fields(step, ['type', 'name', 'x', 'y', 'z', 'feedrate', 'milliseconds', 'action']);
    if (step.type === 'move') {
      fields(step, ['type', 'name', 'x', 'y', 'z', 'feedrate']);
      validatePosition(step);
      if (!Number.isFinite(step.feedrate) || step.feedrate < 60 || step.feedrate > 3000) throw new Error('Feed rate must be 60–3000 mm/min');
      sequence.steps.push({ type: 'move', name: name(step.name, 40), x: step.x, y: step.y, z: step.z, feedrate: step.feedrate });
    } else if (step.type === 'wait') {
      fields(step, ['type', 'milliseconds']);
      if (!Number.isInteger(step.milliseconds) || step.milliseconds < 0 || step.milliseconds > 2000) throw new Error('Wait must be an integer from 0–2000 ms');
      wait += step.milliseconds;
      sequence.steps.push({ type: 'wait', milliseconds: step.milliseconds });
    } else if (step.type === 'action') {
      fields(step, ['type', 'action']);
      if (sequence.tool === 'pen' || typeof step.action !== 'string' || !Object.hasOwn(actions[sequence.tool], step.action)) throw new Error('Unsupported tool action');
      sequence.steps.push({ type: 'action', action: step.action });
    } else throw new Error('Unsupported step type');
  }
  if (wait * sequence.repeat > 120000) throw new Error('Total wait exceeds 120000 ms');
  const overhead = sequence.tool === 'pen' ? 4 : 7;
  if (sequence.steps.length * sequence.repeat + overhead > 4000) throw new Error('Sequence exceeds 4000 commands');
  return sequence;
}

export function sequenceCommands(value) {
  const sequence = validateSequence(value);
  if (!sequence.steps.some((step) => step.type === 'move')) throw new Error('Sequence requires at least one move');
  const pneumatic = sequence.tool !== 'pen';
  const commands = ['G21', 'G90', `M888 P${pneumatic ? 2 : 0}`];
  if (pneumatic) commands.push('M1003');
  // Direct XYZ waypoints do not provide automatic clearance or collision checking.
  for (let cycle = 0; cycle < sequence.repeat; cycle++) {
    for (const step of sequence.steps) {
      if (step.type === 'move') commands.push(`G1 X${step.x.toFixed(3)} Y${step.y.toFixed(3)} Z${step.z.toFixed(3)} F${step.feedrate.toFixed(3)}`);
      else if (step.type === 'wait') commands.push(`G4 P${step.milliseconds}`);
      else commands.push(actions[sequence.tool][step.action]);
    }
  }
  if (pneumatic) commands.push('M1002', 'M1003');
  commands.push('M400');
  return commands;
}

export function sequencePoints(value) {
  return validateSequence(value).steps.filter((step) => step.type === 'move')
    .map(({ x, y, z }) => ({ x, y, z }));
}
