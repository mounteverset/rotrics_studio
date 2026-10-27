import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGcode } from '../src/core/gcode.js';
import { defaultProject, drawingCommands } from '../src/core/project.js';

const header = 'G21\nG90\n';
const first = 'G1 X0 Y280 Z0 F600';
const parse = (tail = '') => parseGcode(`${header}${first}\n${tail}`);

test('actual exported drawing commands roundtrip with their startup Z lift', () => {
  const drawing = drawingCommands(defaultProject());
  const result = parseGcode(drawing.join('\n'));
  assert.equal(result.commands[2], drawing[2]);
  assert.equal(result.commands[2], 'G1 Z10.000 F600');
  assert.deepEqual(result.start, { x: 0, y: 320, z: 10 });
  assert.deepEqual(result.segments[0].from, result.start);
  assert.equal(result.segments.length, drawing.length - 5);
  assert.deepEqual(parseGcode(result.commands.join('\n')), result);
  assert.deepEqual(Object.keys(result), ['commands', 'segments', 'start', 'end', 'bounds', 'distance', 'estimatedSeconds']);
  assert.equal(result.commands.at(-1), 'M400');
});

test('initial Z prefixes preserve heights without assuming XY or estimating an approach', () => {
  const result = parseGcode(`${header}G0 Z100 F600\nG1 Z-20 F300\nG1 X3 Y280\nG1 X6 Y284`);
  assert.deepEqual(result.commands.slice(2, 5), ['G1 Z100 F600', 'G1 Z-20 F300', 'G1 X3 Y280 Z-20 F300']);
  assert.deepEqual(result.start, { x: 3, y: 280, z: -20 });
  assert.deepEqual(result.bounds, { min: { x: 3, y: 280, z: -20 }, max: { x: 6, y: 284, z: 100 } });
  assert.equal(result.segments.length, 1);
  assert.equal(result.distance, 5);
  assert.equal(result.estimatedSeconds, 1);
  assert.deepEqual(parseGcode(result.commands.join('\n')), result);
  const explicitZ = parseGcode(`${header}G1 Z10 F600\nG1 X0 Y280 Z0`);
  assert.equal(explicitZ.bounds.max.z, 10);
  assert.deepEqual(explicitZ.segments, []);
  assert.equal(explicitZ.estimatedSeconds, 0);
});

test('initial Z prefix still requires declarations, valid explicit feed and a complete XY start', () => {
  for (const source of [
    'G1 Z10 F600', 'G21\nG1 Z10 F600', 'G90\nG1 Z10 F600',
    `${header}G1 Z10`, `${header}G1 F600\nG1 Z10`,
    ...['G1 Z101 F600', 'G1 Z-21 F600', 'G1 Z10 F59', 'G1 Z10 F3001',
      'G1 ZNaN F600', 'G1 ZInfinity F600', 'G1 Z10 F600 F700',
      'G1 Z10 F600\nG1 Z20', 'G1 Z10 F600\nG1 X0', 'G1 Z10 F600\nG1 Y280',
      'G1 Z10 F600\nG91\nG1 X0 Y280', 'G1 Z10 F600\nM3', 'G1 Z10 F600',
    ].map((tail) => header + tail),
  ]) assert.throws(() => parseGcode(source), /Line \d+:/, source);
});

test('compact syntax, comments, relative coordinates, modal feed, rapid flags and waits', () => {
  const result = parseGcode('; heading\nG21(mm)\nG90\nG1F600\nG00X0Y280Z0\nG91\nG01X3Y4(comment)\nG1 F300\nG0Z5\nG4S.5\nM400\nG90\nG1X0Y280Z0\nG4P2000\nM400\nM400');
  assert.deepEqual(result.start, { x: 0, y: 280, z: 0 });
  assert.deepEqual(result.end, result.start);
  assert.deepEqual(result.bounds, { min: result.start, max: { x: 3, y: 284, z: 5 } });
  assert.deepEqual(result.segments.map((s) => s.rapid), [false, true, false]);
  assert.deepEqual(result.segments[0], { from: result.start, to: { x: 3, y: 284, z: 0 }, rapid: false });
  assert.ok(Math.abs(result.distance - (10 + Math.sqrt(50))) < 1e-12);
  assert.ok(Math.abs(result.estimatedSeconds - (4 + Math.sqrt(50) / 5)) < 1e-12);
  assert.equal(result.commands.filter((c) => c === 'M400').length, 2);
  assert.ok(result.commands.includes('G4 P500'));
  assert.ok(result.commands.includes('G1 X3 Y284 Z5 F300'));
});

test('first point defines bounds without an invented approach or duration', () => {
  const result = parse();
  assert.deepEqual(result.segments, []);
  assert.equal(result.distance, 0);
  assert.equal(result.estimatedSeconds, 0);
  assert.deepEqual(result.bounds, { min: result.start, max: result.start });
});

test('tiny decimals and negative zero remain canonical on roundtrip', () => {
  const result = parse('G1 X-.0000000001\nG4 P.000000001\nG1 X-0');
  assert.deepEqual(parseGcode(result.commands.join('\n')), result);
  assert.ok(result.commands.includes('G1 X-0.0000000001 Y280 Z0 F600'));
});

test('canonical commands fit the 128-character serial limit, with source-line errors', () => {
  for (const template of ['G1 X0.#1 Y280 Z0 F600', 'G4 P0.#1', 'G1 Z0.#1 F600']) {
    const atLimit = template.replace('#', '0'.repeat(128 - template.replace('#', '').length));
    const source = `${header}${atLimit}\n${first}`;
    const result = parseGcode(source);
    assert.equal(result.commands[2].length, 128);
    assert.ok(result.commands.every((command) => command.length <= 128));
    assert.throws(() => parseGcode(source.replace(atLimit, atLimit.replace('0.', '0.0'))),
      /Line 3: Normalized command.*128 characters/);
  }
  const tiny = `0.${'0'.repeat(150)}1`;
  assert.throws(() => parse(`G1 X${tiny}`), /Line 4: Normalized command.*128 characters/);
  assert.throws(() => parse(`G4 S${tiny}`), /Line 4: Normalized command.*128 characters/);
  const longFeed = `600.${'0'.repeat(150)}1`;
  const result = parse(`G1 F${longFeed}\nG1 X1`);
  assert.equal(result.commands.at(-2), 'G1 X1 Y280 Z0 F600');
  assert.ok(result.commands.every((command) => command.length <= 128));
});

test('rejects unsupported commands, malformed input and injection with source lines', () => {
  for (const bad of [
    'M3', 'M5', 'G20', 'G28', 'G2 X1', 'G92 X0', 'N1 G1 X1', 'G1 X1*42',
    'X1', 'G1 X1 E0', 'G1 X1 S0', 'G1 X1 X2', 'G1 X1 G1 Y2', 'G1 X1junk',
    'G1 XNaN', 'G1 XInfinity', 'G1 X1e2', 'G1 X1;\nM3', 'G1 X1\u0000',
    'G1 X1)', 'G1 X1 (open', 'G1 X1 ((nested))', 'G1 X(hi)1',
    'G21 F600', 'G90 X0', 'M400 P1', 'G4', 'G4 P1 S1', 'G4 P1 P2',
    'G4 P2001', 'G4 S2.001', 'G4 P-1', 'G0 F600', 'G1', 'G1 F59', 'G1 F3001',
    'G1 X151', 'G1 Y179', 'G1 Z101', `G1 X${'9'.repeat(310)}`,
  ]) assert.throws(() => parse(bad), /Line \d+:/, bad);
  assert.throws(() => parseGcode(`${header}${first}\n; blank\nM3`), /Line 5:/);
});

test('requires units, absolute declaration, full initial coordinates and feed', () => {
  for (const source of [first, `G21\n${first}`, `G90\n${first}`, `${header}G91\n${first}`,
    `${header}G1 X0 Y280 F600`, `${header}G1 X0 Y280 Z0`, `${header}G1F600`, '; empty']) {
    assert.throws(() => parseGcode(source), /Line \d+:/);
  }
  assert.throws(() => parse('G91\nG1 Y101'), /Line 5:/);
  for (const feed of [60, 3000]) assert.doesNotThrow(() => parse(`G1 X150 Y380 Z100 F${feed}\nG1 X-150 Y180 Z-20`));
});

test('enforces UTF-8 byte and command limits exactly without counting comments', () => {
  const source = `${header}${first}\n`;
  const padded = source + ';' + 'a'.repeat(256 * 1024 - source.length - 1);
  assert.doesNotThrow(() => parseGcode(padded));
  assert.throws(() => parseGcode(padded + 'a'), /256 KB/);
  assert.throws(() => parseGcode(source + ';' + 'é'.repeat(128 * 1024)), /256 KB/);
  assert.doesNotThrow(() => parseGcode(source + 'M400\n'.repeat(4997)));
  assert.throws(() => parseGcode(source + 'M400\n'.repeat(4998)), /Line 5001:/);
  assert.doesNotThrow(() => parseGcode(source + '; comment\n\n'.repeat(5001)));
  for (const value of [null, undefined, [], 42]) assert.throws(() => parseGcode(value), /string/);
});
