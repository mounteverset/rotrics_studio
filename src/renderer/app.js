import { Controller } from '../core/controller.js';
import { defaultProject, validateProject, drawingStrokes, drawingCommands, layoutProject, textBounds } from '../core/project.js';
import { importSvg } from '../core/svg.js';
import { parseGcode } from '../core/gcode.js';
import { defaultSequence, validateSequence, sequenceCommands, sequencePoints } from '../core/teach.js';
import { validateCustomFonts, MAX_CUSTOM_FONTS, MAX_PROJECT_BYTES, MAX_FONT_BYTES } from '../core/custom-font.js';
import { defaultWriting, WRITING_FONTS } from '../core/writing.js';

const $ = (id) => document.getElementById(id);
const controller = new Controller();
const usb = window.dexarmDevice;
let usbState = { status: 'disconnected', busy: false, firmware: '', position: null, log: [], message: 'USB disconnected. Physical motion is disabled.' };
let usbRefreshing = false;
let project = defaultProject();
let writingEnabled = false;
let customFonts = [];
let fontBusy = false;
let fontTask = null;
let generated = null;
let importedJob = null;
let sequence = defaultSequence();
let taughtJob = null;
let selectedText = null;
let dragging = null;
let tab = 'draw';
let lastLog = 0;
const fields = ['project-name', 'size', 'feedrate', 'origin-x', 'origin-y', 'origin-z', 'writing-text', 'writing-font', 'writing-height', 'writing-letter-spacing', 'writing-line-spacing', 'writing-align', 'writing-mode-outline', 'writing-mode-centerline', 'writing-style', 'text-x', 'text-y', 'travel-feedrate', 'pen-lift'];
const fontOptions = () => [...WRITING_FONTS, ...customFonts.map(({ id, name }) => ({ id, name: `${name} (imported)`, outline: true, custom: true }))];
const active = () => ['running', 'pausing', 'paused'].includes(controller.state);
const connected = () => !['disconnected', 'faulted', 'connecting'].includes(controller.state);
const labels = { disconnected: 'Offline', connecting: 'Connecting', uninitialized: 'Needs home', ready: 'Ready', running: 'Running', pausing: 'Pausing', paused: 'Paused', faulted: 'Faulted' };
const screenPoint = ({ x, y }) => [380 + x * 2.2, 485 - (y - 180) * 2.2];

function resetPreview() {
  generated = null;
  controller.message = 'Layout changed. Generate G-code again before sending.';
  controller.completed = controller.total = 0;
}

function renderUsb() {
  const available = Boolean(usb);
  const connected = usbState.status === 'connected';
  const opening = usbState.status === 'connecting';
  $('usb-availability').textContent = available ? 'Desktop USB diagnostics. The workspace and motion controls still operate the simulator.' : 'USB diagnostics require the Electron desktop app (npm start). Simulation works in this browser.';
  $('usb-port').disabled = !available || connected || opening || usbRefreshing;
  $('usb-refresh').disabled = !available || opening || usbRefreshing;
  $('usb-refresh').textContent = usbRefreshing ? 'Finding ports…' : 'Refresh ports';
  $('usb-connect').disabled = !available || usbRefreshing || (!connected && !opening && !$('usb-port').value);
  $('usb-connect').textContent = opening ? 'Cancel connection' : connected ? 'Disconnect USB' : 'Connect USB';
  $('usb-status').textContent = usbState.message;
  $('usb-firmware').disabled = $('usb-position').disabled = !connected || usbState.busy;
  $('usb-export').disabled = !usbState.log.length;
  $('usb-firmware-report').textContent = usbState.firmware || 'Not reported';
  $('usb-position-report').textContent = usbState.position ? ['x', 'y', 'z'].map((axis) => `${axis.toUpperCase()} ${usbState.position[axis].toFixed(2)}`).join(' · ') : 'Unknown · not physical tracking';
  if (usbState.log.length) $('usb-log').replaceChildren(...usbState.log.map(({ direction, text, time }) => {
    const entry = document.createElement('li');
    entry.textContent = `${time} ${direction === 'send' ? '→' : '←'} ${text}`;
    return entry;
  }));
}

if (usb) {
  usb.onChange((state) => { usbState = state; renderUsb(); });
  usb.getState().then((state) => { usbState = state; renderUsb(); }).catch(showError);
}

function showError(error) {
  $('error-message').textContent = error.message;
  if (!$('error-dialog').open) $('error-dialog').showModal();
}

async function perform(action) {
  try { await action(); } catch (error) { showError(error); }
}

function readProject(content) {
  if (content === undefined) {
    content = project.version === 2 ? { version: 2, texts: project.texts.map((text) => text.id !== selectedText ? text : {
      id: text.id, x: $('text-x').valueAsNumber, y: $('text-y').valueAsNumber,
      writing: {
        text: $('writing-text').value, font: $('writing-font').value,
        mode: $('writing-mode-outline').checked ? 'outline' : 'centerline', style: $('writing-style').value,
        fontSize: $('writing-height').valueAsNumber, letterSpacing: $('writing-letter-spacing').valueAsNumber,
        lineSpacing: $('writing-line-spacing').valueAsNumber, align: $('writing-align').value,
      },
    }), ...(project.artwork ? { artwork: project.artwork } : {}) } : project.artwork ? { artwork: project.artwork } : {};
  }
  return validateProject({ version: 1, name: $('project-name').value,
    size: $('size').valueAsNumber, feedrate: $('feedrate').valueAsNumber,
    travelFeedrate: $('travel-feedrate').valueAsNumber, penLift: $('pen-lift').valueAsNumber,
    origin: { x: $('origin-x').valueAsNumber, y: $('origin-y').valueAsNumber, z: $('origin-z').valueAsNumber },
    ...content,
    ...(customFonts.length ? { fonts: customFonts.filter((font) => content.writing?.font === font.id || content.texts?.some((text) => text.writing.font === font.id)) } : {}) });
}

function fillWriting() {
  const box = project.texts?.find((text) => text.id === selectedText);
  writingEnabled = Boolean(box);
  const writing = box?.writing || defaultWriting();
  $('writing-text').value = writing.text;
  $('writing-font').value = writing.font;
  $('writing-height').value = writing.fontSize;
  $('writing-letter-spacing').value = writing.letterSpacing;
  $('writing-line-spacing').value = writing.lineSpacing;
  $('writing-align').value = writing.align;
  $('writing-style').value = writing.style || 'regular';
  $('text-x').value = box?.x || 0;
  $('text-y').value = box?.y || 0;
  $('writing-mode-outline').checked = writing.mode === 'outline';
  $('writing-mode-centerline').checked = writing.mode !== 'outline';
  $('writing-error').textContent = '';
}

function fillProject() {
  if (project.writing) project = layoutProject(project);
  selectedText = project.texts?.[0]?.id || null;
  $('project-name').value = project.name;
  $('size').value = project.size;
  $('feedrate').value = project.feedrate;
  $('travel-feedrate').value = project.travelFeedrate ?? project.feedrate;
  $('pen-lift').value = project.penLift ?? 10;
  $('motion-error').textContent = '';
  for (const axis of ['x', 'y', 'z']) $(`origin-${axis}`).value = project.origin[axis];
  fillWriting();
}

function selectText(id) {
  project = readProject();
  selectedText = id;
  fillWriting();
  render();
}

function drawTextBoxes() {
  const svg = (name) => document.createElementNS('http://www.w3.org/2000/svg', name);
  $('text-boxes').replaceChildren(...(project.texts || []).map((text, index) => {
    const bounds = textBounds(text, project.origin, project.fonts);
    const [x, y] = screenPoint({ x: bounds.left, y: bounds.top });
    const group = svg('g');
    group.dataset.textId = text.id;
    group.setAttribute('role', 'button');
    group.setAttribute('tabindex', active() || controller.busy || fontBusy ? '-1' : '0');
    group.setAttribute('aria-label', `Text ${index + 1}: ${text.writing.text}. Select to edit; drag or use arrow keys to move.`);
    group.setAttribute('aria-pressed', String(selectedText === text.id));
    group.setAttribute('aria-disabled', String(active() || controller.busy || controller.state === 'connecting' || fontBusy));
    group.classList.add('text-box');
    if (selectedText === text.id) group.classList.add('selected');
    const rect = svg('rect');
    rect.setAttribute('x', x - 6); rect.setAttribute('y', y - 6);
    rect.setAttribute('width', Math.max(12, (bounds.right - bounds.left) * 2.2 + 12));
    rect.setAttribute('height', Math.max(12, (bounds.top - bounds.bottom) * 2.2 + 12));
    rect.setAttribute('rx', '3');
    group.append(rect);
    return group;
  }));
}

function draw() {
  if (['gcode', 'teach'].includes(tab)) { drawJob(); return; }
  $('job-endpoints').setAttribute('hidden', '');
  $('origin-marker').removeAttribute('hidden');
  const strokes = drawingStrokes(project).map((stroke) => stroke.map(screenPoint));
  const path = (points) => points.map(([x, y], i) => `${i ? 'L' : 'M'} ${x} ${y}`).join(' ');
  $('drawing-path').setAttribute('d', strokes.map(path).join(' '));
  const origin = screenPoint(project.origin);
  $('origin-marker').setAttribute('transform', `translate(${origin.join(' ')})`);
  const from = screenPoint(controller.position || { x: 0, y: 300 });
  const travel = strokes.map((stroke, i) => path([i ? strokes[i - 1].at(-1) : from, stroke[0]]));
  $('travel-path').setAttribute('d', travel.join(' '));
  $('pen-marker').toggleAttribute('hidden', !controller.position);
  if (controller.position) $('pen-marker').setAttribute('transform', `translate(${from.join(' ')})`);
  const boxes = project.texts || [];
  $('drawing-dimensions').textContent = boxes.length ? `${boxes.length} text box${boxes.length === 1 ? '' : 'es'} · ${project.feedrate} mm/min` : project.version === 2 && !project.artwork ? 'Empty layout · insert text' : `${project.size} mm design · ${project.feedrate} mm/min`;
  const artworkName = boxes.length ? `${boxes.length} editable text box${boxes.length === 1 ? '' : 'es'}${project.artwork ? ` + ${project.artwork.name}` : ''}` : project.artwork?.name || (project.version === 2 ? 'Empty layout · insert text' : 'Built-in star');
  $('artwork-name').textContent = artworkName;
  $('artwork-details').textContent = `${strokes.length} stroke${strokes.length === 1 ? '' : 's'} · ${strokes.reduce((sum, stroke) => sum + stroke.length, 0)} points`;
  $('canvas-description').textContent = `${artworkName} with ${strokes.length} separate pen strokes. Select text boxes to edit or move them. Limits are illustrative, not verified DexArm limits.`;
  if (!dragging) drawTextBoxes();
}

function drawJob() {
  const points = tab === 'teach' ? Array.from({ length: sequence.repeat }, () => sequencePoints(sequence)).flat() : importedJob ? [importedJob.start, ...importedJob.segments.map(({ to }) => to)] : [];
  const path = (points) => points.map((point, i) => `${i ? 'L' : 'M'} ${screenPoint(point).join(' ')}`).join(' ');
  const segments = tab === 'gcode' ? importedJob?.segments || [] : points.slice(1).map((to, index) => ({ from: points[index], to, rapid: false }));
  $('drawing-path').setAttribute('d', segments.filter((s) => !s.rapid).map((s) => path([s.from, s.to])).join(' '));
  $('travel-path').setAttribute('d', segments.filter((s) => s.rapid).map((s) => path([s.from, s.to])).join(' '));
  $('origin-marker').setAttribute('hidden', '');
  $('pen-marker').toggleAttribute('hidden', !controller.position);
  if (controller.position) $('pen-marker').setAttribute('transform', `translate(${screenPoint(controller.position).join(' ')})`);
  $('job-endpoints').toggleAttribute('hidden', !points.length);
  if (points.length) {
    $('job-start-marker').setAttribute('transform', `translate(${screenPoint(points[0]).join(' ')})`);
    $('job-end-marker').setAttribute('transform', `translate(${screenPoint(points.at(-1)).join(' ')})`);
  }
  $('drawing-dimensions').textContent = tab === 'teach' ? `${sequence.steps.filter((step) => step.type === 'move').length} waypoints · ${sequence.repeat} repeat(s)` : importedJob ? `${importedJob.commands.length} reviewed commands · ${importedJob.distance.toFixed(1)} mm path` : 'Review G-code to display its path';
  $('canvas-description').textContent = `${tab === 'teach' ? 'Teach sequence' : 'Reviewed G-code'}: top view of XYZ motion. Green is the first point; amber is the last. Z movement and approach to the first point are not shown. Simulator limits only.`;
}

function render() {
  const ready = controller.state === 'ready' && !controller.busy && !fontBusy;
  const reviewed = tab === 'gcode' ? importedJob : tab === 'teach' ? taughtJob : generated;
  const locked = active() || controller.busy || controller.state === 'connecting' || fontBusy;
  $('connection-label').textContent = connected() ? 'Simulator connected' : 'Simulator disconnected';
  $('connection-dot').classList.toggle('online', connected());
  $('connect').textContent = connected() ? 'Disconnect' : controller.state === 'connecting' ? 'Connecting…' : 'Connect simulator';
  $('connect').disabled = controller.state === 'connecting';
  $('stop').disabled = !connected() && controller.state !== 'connecting';
  $('device-state').textContent = labels[controller.state];
  $('home').disabled = !connected() || locked;
  $('home-hint').textContent = controller.homed ? 'Homed in simulator. Work origin is a separate project setting.' : 'Connect, then home before jogging or running.';
  for (const axis of ['x', 'y', 'z']) $(`pos-${axis}`).textContent = controller.position ? controller.position[axis].toFixed(2) : '—';
  for (const id of fields) $(id).disabled = locked;
  $('text-boxes').toggleAttribute('hidden', tab !== 'draw');
  $('size').disabled = locked || (project.version === 2 && !project.artwork);
  $('design-size-field').hidden = project.version === 2 && !project.artwork;
  $('writing-editor').hidden = !writingEnabled;
  $('write-text').disabled = locked;
  $('delete-text').disabled = locked;
  $('text-list').disabled = locked;
  $('text-list-field').hidden = !project.texts?.length;
  const options = (project.texts || []).map((text, index) => {
    const option = document.createElement('option');
    option.value = text.id;
    option.textContent = `${index + 1} · ${text.writing.text.replace(/\n/g, ' ').slice(0, 35)}`;
    return option;
  });
  $('text-list').replaceChildren(...options);
  $('text-list').value = selectedText || '';
  const selectedFont = fontOptions().find((font) => font.id === $('writing-font').value);
  const outlineAvailable = selectedFont?.outline;
  $('writing-mode-outline').disabled = locked || !outlineAvailable;
  $('writing-mode-centerline').disabled = locked;
  $('writing-style').disabled = locked || !outlineAvailable || selectedFont?.custom;
  $('style-help').textContent = selectedFont?.custom ? 'Imported font uses its original face style. Import a separate font file for another weight or italic face.' : outlineAvailable ? 'Real font variants. Centerline follows the selected style; pen thickness stays the same.' : 'Hershey fonts have a fixed stroke style. Choose DejaVu for bold or italic.';
  $('writing-mode-help').textContent = !outlineAvailable
    ? 'Hershey fonts contain pen strokes only. Choose DejaVu Sans or Serif to compare outlines with converted centerlines.'
    : $('writing-mode-outline').checked
      ? 'Outline follows the borders of the letter, including inner contours. Letter height uses the full capital outline.'
      : 'Centerline writes through the middle of the letter. Converted corners and serifs are approximate; inspect the main preview.';
  $('use-position').disabled = !ready;
  $('import-font').disabled = locked;
  $('font-import-cancel').hidden = !fontBusy;
  $('font-import-progress').hidden = !fontBusy;
  $('open').disabled = locked;
  $('import-svg').disabled = locked;
  $('reset-artwork').disabled = locked || (!project.artwork && project.version !== 2);
  $('preview').disabled = locked || (tab === 'draw' && project.version === 2 && !project.texts.length && !project.artwork);
  $('preview').textContent = tab === 'gcode' ? '2 · Review G-code' : tab === 'teach' ? '2 · Generate sequence G-code' : generated ? '2 · Regenerate G-code' : '2 · Generate G-code';
  $('workflow-title').textContent = tab === 'gcode' ? 'Source → Review → Simulate' : tab === 'teach' ? 'Sequence → G-code → Play' : 'Layout → G-code → Send';
  $('canvas-tool').textContent = tab === 'gcode' ? 'XYZ MOTION' : tab === 'teach' ? sequence.tool.toUpperCase() : 'PEN TOOL';
  $('download-gcode').disabled = !reviewed;
  $('gcode-output').value = reviewed ? reviewed.commands.join('\n') + '\n' : '';
  $('gcode-summary').textContent = reviewed ? `${reviewed.commands.length} commands · ready to review` : 'Generate or review the current job first';
  $('gcode-status').textContent = reviewed ? 'Commands below are the current reviewed job. Changes require a new review or generation.' : 'Create or edit your job, then generate or review its G-code. No connection is needed.';
  $('run').disabled = !ready || !reviewed;
  $('pause').hidden = !active();
  $('pause').textContent = controller.state === 'paused' ? 'Resume simulation' : controller.state === 'pausing' ? 'Pausing…' : 'Pause simulation';
  $('pause').disabled = controller.state === 'pausing';
  document.querySelectorAll('[data-axis]').forEach((button) => { button.disabled = !ready; });
  $('status-message').textContent = controller.message;
  $('job-title').textContent = active() ? `${labels[controller.state]} · ${controller.jobName || project.name}` : controller.total && controller.completed === controller.total ? 'Your job is complete' : reviewed ? 'Job ready to simulate' : tab === 'teach' ? 'Create a sequence' : tab === 'gcode' ? 'Review your G-code' : 'Create your layout';
  $('progress-count').textContent = controller.total ? `${controller.completed} / ${controller.total} commands` : '—';
  $('job-progress').max = controller.total || 1;
  $('job-progress').value = controller.completed;
  $('run-hint').textContent = fontBusy ? 'Font conversion in progress. You can cancel and keep completed glyph paths.' : active() ? '3 · Job in progress. Pause or stop the simulator below.' : !reviewed ? tab === 'gcode' ? '1 · Open or paste source, then review G-code. No connection needed.' : tab === 'teach' ? '1 · Add or record steps, then generate G-code. You can edit offline.' : '1 · Arrange text and artwork. Then generate G-code, even while disconnected.' : !ready ? '2 · G-code ready. Download it, or connect and home the simulator for step 3.' : '3 · G-code ready. Send this generated job to the simulator.';
  $('step-prepare').querySelector('b').textContent = tab === 'gcode' ? 'Source' : tab === 'teach' ? 'Sequence' : 'Layout';
  $('step-preview').querySelector('b').textContent = tab === 'gcode' ? 'Review G-code' : 'Generate G-code';
  $('step-prepare').classList.toggle('active', !reviewed && !active());
  $('step-preview').classList.toggle('active', Boolean(reviewed) && !active());
  $('step-run').classList.toggle('active', active());
  if (controller.log.length !== lastLog || controller.log.length === 150) {
    const entries = controller.log.map(({ direction, text, time }) => {
      const row = document.createElement('li');
      const stamp = document.createElement('span');
      stamp.className = 'log-time';
      stamp.textContent = time;
      const content = document.createElement('span');
      content.className = direction;
      content.textContent = `${direction === 'send' ? '→' : '←'} ${text}`;
      row.append(stamp, content);
      return row;
    });
    $('log').replaceChildren(...entries);
    $('log').scrollTop = $('log').scrollHeight;
    lastLog = controller.log.length;
  }
  renderJobEditors(ready, locked);
  draw();
}

controller.addEventListener('change', render);
$('connect').addEventListener('click', () => perform(() => connected() ? controller.stop() : controller.connect()));
$('stop').addEventListener('click', () => controller.stop());
$('home').addEventListener('click', () => perform(() => controller.home()));
$('preview').addEventListener('click', () => perform(() => {
  if (tab === 'gcode') { $('gcode-review').click(); return; }
  if (tab === 'teach') { $('teach-generate').click(); return; }
  project = readProject();
  generated = { project: structuredClone(project), commands: drawingCommands(project) };
  $('generated-code').open = true;
  controller.message = `G-code generated: ${generated.commands.length} commands. Review or download, then connect and home to simulate.`;
  render();
}));
$('run').addEventListener('click', () => perform(async () => {
  if (tab === 'gcode') { $('gcode-run').click(); return; }
  if (tab === 'teach') { $('teach-run').click(); return; }
  if (!generated) throw new Error('Generate G-code before sending');
  project = readProject();
  if (JSON.stringify(project) !== JSON.stringify(generated.project)) {
    resetPreview(); render();
    throw new Error('Layout changed. Generate G-code again before sending');
  }
  await controller.run(generated.project);
}));
$('pause').addEventListener('click', () => perform(() => controller.state === 'paused' ? controller.resume() : controller.pause()));
$('use-position').addEventListener('click', () => perform(() => {
  project = validateProject({ ...readProject(), origin: { ...controller.position } });
  resetPreview();
  fillProject();
  render();
}));
for (const id of fields) $(id).addEventListener('input', () => {
  if (id === 'writing-font' && fontOptions().find((font) => font.id === $('writing-font').value)?.custom) $('writing-style').value = 'regular';
  if (id === 'writing-font' && !fontOptions().find((font) => font.id === $('writing-font').value)?.outline) {
    $('writing-mode-centerline').checked = true;
    $('writing-style').value = 'regular';
  }
  resetPreview();
  try {
    project = readProject();
    $('writing-error').textContent = '';
    $('motion-error').textContent = '';
  } catch (error) {
    $('writing-error').textContent = writingEnabled ? `${error.message}. Preview shows the last valid layout.` : '';
    $('motion-error').textContent = writingEnabled ? '' : `${error.message}. Canvas shows the last valid layout.`;
  }
  render();
});
document.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => {
  tab = button.dataset.tab;
  document.querySelectorAll('[data-tab]').forEach((item) => {
    item.classList.toggle('selected', item === button);
    if (item === button) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
  $('drawing-settings').hidden = tab !== 'draw';
  $('drawing-workflow').hidden = tab === 'control';
  $('gcode-settings').hidden = tab !== 'gcode';
  $('teach-settings').hidden = tab !== 'teach';
  $('jog-settings').hidden = !['control', 'teach'].includes(tab);
  $('usb-settings').hidden = tab !== 'control';
  $('generated-code').hidden = tab === 'control';
  $('open').hidden = $('save').hidden = tab !== 'draw';
  const titles = { draw: 'Drawing workspace', control: 'Manual control', gcode: 'G-code workspace', teach: 'Teach & Play' };
  const descriptions = { draw: 'Create your layout, generate G-code, then send the checked job.', control: 'Move to coordinates or jog the simulator. USB diagnostics stay separate.', gcode: 'Open or paste XYZ G-code, review the path, then simulate.', teach: 'Record points, arrange actions, and replay a repeatable sequence.' };
  $('page-title').textContent = titles[tab];
  $('page-description').textContent = descriptions[tab];
  $('canvas-instructions').textContent = tab === 'gcode' ? 'Green: first point. Amber: last point. Top view only; initial approach and Z motion are not shown.' : tab === 'teach' ? 'Move directly between recorded points. Add explicit lift points for clearance. Green: first point; amber: last point. No collision simulation.' : tab === 'control' ? 'Jog or move to explicit XYZ coordinates. The drawing is shown for reference; manual moves do not change it.' : 'Insert text, click a box to edit it, then drag it into place. Arrow keys move the selected box 1 mm; Shift moves 10 mm.';
  $('path-legend').textContent = ['gcode', 'teach'].includes(tab) ? 'Linear XYZ motion (top view)' : 'Drawing path';
  $('travel-legend').textContent = tab === 'gcode' ? 'Source G0 travel' : tab === 'teach' ? 'No implicit pen lift' : 'Pen-up travel';
  render();
}));
document.querySelectorAll('[data-axis]').forEach((button) => button.addEventListener('click', () => perform(() =>
  controller.jog(button.dataset.axis, Number(button.dataset.direction) * Number($('jog-step').value), $('jog-feedrate').valueAsNumber))));
$('move-current').addEventListener('click', () => {
  if (controller.position) for (const axis of ['x', 'y', 'z']) $(`move-${axis}`).value = controller.position[axis];
});
$('move-to').addEventListener('click', () => perform(() => controller.moveTo({ x: $('move-x').valueAsNumber, y: $('move-y').valueAsNumber, z: $('move-z').valueAsNumber }, $('jog-feedrate').valueAsNumber)));
$('save').addEventListener('click', () => perform(() => {
  project = readProject();
  const json = JSON.stringify(project);
  if (new Blob([json]).size > MAX_PROJECT_BYTES) throw new Error('Project exceeds 4 MB. Use fewer imported fonts or simplify the layout.');
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${project.name.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase() || 'drawing'}.dexarm.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}));
function convertFontFile(file, buffer) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./font-worker.js', import.meta.url), { type: 'module' });
    let partial;
    let watchdog;
    const finish = (error, font = partial) => {
      clearTimeout(watchdog); clearTimeout(deadline); worker.terminate(); fontTask = null;
      if (font) resolve({ font, warning: error?.message || '' });
      else reject(error || new Error('Font conversion cancelled'));
    };
    const touch = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => finish(new Error('Conversion stopped after a glyph timed out. Completed paths were kept.')), 15000);
    };
    const deadline = setTimeout(() => finish(new Error('Conversion time limit reached. Completed paths were kept.')), 120000);
    fontTask = { cancel: () => finish(new Error('Conversion cancelled. Completed paths were kept.')) };
    worker.onmessage = ({ data }) => {
      touch();
      if (data.stage === 'outlines') partial = data.font;
      if (data.stage === 'centerline') {
        partial.glyphs[data.char] = data.glyph;
        $('font-import-progress').value = data.completed;
        $('font-import-status').textContent = `Converting ${partial.name}: ${data.completed}/${data.total} characters…`;
      }
      if (data.stage === 'complete') finish(null, data.font);
      if (data.stage === 'error') finish(new Error(data.message));
    };
    worker.onerror = (event) => { event.preventDefault(); finish(new Error(event.message || 'Font worker failed. Run npm ci and restart Studio.')); };
    touch();
    worker.postMessage({ buffer, name: file.name, text: $('writing-text').value }, [buffer]);
  });
}
$('import-font').addEventListener('click', () => $('font-file').click());
$('font-import-cancel').addEventListener('click', () => fontTask?.cancel());
$('font-file').addEventListener('change', () => perform(async () => {
  const file = $('font-file').files[0];
  $('font-file').value = '';
  if (!file) return;
  if (active() || controller.busy || controller.state === 'connecting' || fontBusy) return;
  $('font-import-error').textContent = '';
  try {
    if (!/\.(otf|ttf)$/i.test(file.name) || file.size > MAX_FONT_BYTES) throw new Error('Choose a TTF or OTF file no larger than 2 MB');
    fontBusy = true;
    $('font-import-status').textContent = 'Reading font outlines…';
    $('font-import-progress').value = 0;
    resetPreview(); render();
    const { font: raw, warning } = await convertFontFile(file, await file.arrayBuffer());
    const font = validateCustomFonts([raw])[0];
    if (!Object.values(font.glyphs).some((glyph) => glyph.outline)) throw new Error('This font has no supported drawable ASCII characters');
    const existing = customFonts.findIndex((item) => item.id === font.id);
    if (existing >= 0) for (const [char, glyph] of Object.entries(customFonts[existing].glyphs)) {
      if (glyph.centerline && !font.glyphs[char]?.centerline) font.glyphs[char] = glyph;
    }
    if (existing < 0 && customFonts.length >= MAX_CUSTOM_FONTS) throw new Error('Four imported fonts are already loaded. Open another project to start a new font library.');
    validateCustomFonts([...customFonts.filter((item) => item.id !== font.id), font]);
    if (existing < 0) customFonts.push(font); else customFonts[existing] = font;
    fontBusy = false; render();
    if (!selectedText) $('write-text').click();
    fillFontOptions();
    $('writing-font').value = font.id;
    $('writing-style').value = 'regular';
    const missingCenterline = [...$('writing-text').value].some((char) => !/\s/.test(char) && !font.glyphs[char]?.centerline);
    if (missingCenterline) $('writing-mode-outline').checked = true;
    $('writing-font').dispatchEvent(new Event('input'));
    const available = Object.values(font.glyphs).filter((glyph) => glyph.centerline).length;
    $('font-import-status').textContent = `${font.name} imported. ${available}/94 centerline characters ready.${missingCenterline ? ' Outline selected because this text has unavailable centerlines.' : ''} ${warning}`;
    $('font-import-details').hidden = false;
    $('font-import-report').textContent = Object.entries(font.glyphs).filter(([, glyph]) => !glyph.centerline).map(([char, glyph]) => `${char}: ${glyph.centerlineError || 'Not converted'}`).join(' · ') + (font.license ? ` · Font license: ${font.license}` : '');
  } catch (error) {
    $('font-import-status').textContent = '';
    $('font-import-error').textContent = error.message;
  } finally { fontBusy = false; render(); }
}));
$('import-svg').addEventListener('click', () => $('svg-file').click());
$('svg-file').addEventListener('change', () => perform(async () => {
  const file = $('svg-file').files[0];
  $('svg-file').value = '';
  if (!file) return;
  if (file.size > 262144) throw new Error('SVG files must be smaller than 256 KB');
  const artwork = importSvg(await file.text(), file.name);
  if (active() || controller.busy || controller.state === 'connecting' || fontBusy) throw new Error('Wait for the current operation before importing artwork');
  const current = readProject();
  const nextProject = readProject({ ...(current.version === 2 ? { version: 2, texts: current.texts } : {}), artwork });
  project = nextProject;
  resetPreview();
  controller.message = `Imported ${artwork.name}. SVG outlines are centered on the work origin; review the layout, then generate G-code.`;
  render();
}));
$('reset-artwork').addEventListener('click', () => perform(() => {
  project = readProject({});
  selectedText = null; fillWriting();
  resetPreview();
  controller.message = 'Built-in star restored. Generate G-code before sending.';
  render();
}));
$('write-text').addEventListener('click', () => perform(() => {
  const current = layoutProject(readProject());
  const previous = current.texts.find((text) => text.id === selectedText);
  const id = crypto.randomUUID();
  const text = { id, x: previous?.x || 0, y: previous ? previous.y - previous.writing.fontSize * 2 : 0,
    writing: { ...defaultWriting(), text: 'New text', font: 'dejavu-sans', mode: 'centerline', style: 'regular' } };
  project = validateProject({ ...current, texts: [...current.texts, text] });
  selectedText = id;
  fillWriting(); resetPreview();
  controller.message = 'Text inserted. Drag its box to position it, or edit settings on the right. Insert text again to add another box.';
  render();
  $('writing-text').focus(); $('writing-text').select();
}));
$('text-list').addEventListener('change', () => perform(() => selectText($('text-list').value)));
$('delete-text').addEventListener('click', () => perform(() => {
  // Delete the selected box even when its draft text is invalid.
  project = validateProject({ ...project, texts: project.texts.filter((text) => text.id !== selectedText) });
  selectedText = project.texts[0]?.id || null;
  fillWriting(); resetPreview(); render();
}));
$('download-gcode').addEventListener('click', () => perform(() => {
  const job = tab === 'gcode' ? importedJob : tab === 'teach' ? taughtJob : generated;
  if (!job) throw new Error('Generate or review G-code first');
  download(`${tab === 'gcode' ? 'reviewed' : tab === 'teach' ? sequence.name : project.name}.gcode`, job.commands.join('\n') + '\n', 'text/plain');
}));
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function canvasPoint(event) {
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform($('workspace').getScreenCTM().inverse());
  return { x: (point.x - 380) / 2.2, y: 180 + (485 - point.y) / 2.2 };
}
function moveText(id, x, y) {
  const next = validateProject({ ...readProject(), texts: project.texts.map((text) => text.id === id ? { ...text, x, y } : text) });
  project = next;
  $('text-x').value = x; $('text-y').value = y;
  $('writing-error').textContent = '';
  resetPreview(); render();
}
$('text-boxes').addEventListener('pointerdown', (event) => {
  const target = event.target.closest('[data-text-id]');
  if (tab !== 'draw' || fontBusy || !target || event.button !== 0 || active() || controller.busy || controller.state === 'connecting') return;
  perform(() => {
    selectText(target.dataset.textId);
    const text = project.texts.find((text) => text.id === selectedText);
    dragging = { id: text.id, start: canvasPoint(event), x: text.x, y: text.y };
    $('workspace').setPointerCapture(event.pointerId);
    event.preventDefault();
  });
});
$('workspace').addEventListener('pointermove', (event) => {
  if (!dragging) return;
  const point = canvasPoint(event);
  const x = Math.round((dragging.x + point.x - dragging.start.x) * 10) / 10;
  const y = Math.round((dragging.y + point.y - dragging.start.y) * 10) / 10;
  try { moveText(dragging.id, x, y); drawTextBoxes(); }
  catch (error) { $('writing-error').textContent = `${error.message}. Last valid position retained.`; }
});
function endDrag(event) {
  if (!dragging) return;
  dragging = null;
  if ($('workspace').hasPointerCapture(event.pointerId)) $('workspace').releasePointerCapture(event.pointerId);
  drawTextBoxes();
}
$('workspace').addEventListener('pointerup', endDrag);
$('workspace').addEventListener('pointercancel', endDrag);
$('text-boxes').addEventListener('click', (event) => {
  const box = event.target.closest('[data-text-id]');
  if (tab === 'draw' && !fontBusy && box && !active() && !controller.busy) perform(() => selectText(box.dataset.textId));
});
$('text-boxes').addEventListener('keydown', (event) => {
  const box = event.target.closest('[data-text-id]');
  if (tab !== 'draw' || fontBusy || !box || active() || controller.busy || controller.state === 'connecting') return;
  if (['Enter', ' '].includes(event.key)) {
    event.preventDefault(); perform(() => {
      selectText(box.dataset.textId);
      $('text-boxes').querySelector(`[data-text-id="${selectedText}"]`).focus();
    });
  }
  const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
  if (!directions[event.key]) return;
  event.preventDefault();
  perform(() => {
    selectText(box.dataset.textId);
    const text = project.texts.find((text) => text.id === selectedText);
    const [dx, dy] = directions[event.key]; const step = event.shiftKey ? 10 : 1;
    moveText(text.id, text.x + dx * step, text.y + dy * step);
    $('text-boxes').querySelector(`[data-text-id="${text.id}"]`).focus();
  });
});
$('open').addEventListener('click', () => $('project-file').click());
$('project-file').addEventListener('change', () => perform(async () => {
  const file = $('project-file').files[0];
  $('project-file').value = '';
  if (!file) return;
  if (file.size > MAX_PROJECT_BYTES) throw new Error('Project files must be smaller than 4 MB');
  const nextProject = validateProject(JSON.parse(await file.text()));
  if (active() || controller.busy || fontBusy) throw new Error('Wait for the current operation before opening a project');
  project = nextProject;
  customFonts = project.fonts || [];
  fillFontOptions();
  resetPreview();
  fillProject();
  controller.message = 'Project opened. Review its layout and origin, then generate G-code.';
  render();
}));
window.addEventListener('beforeunload', (event) => {
  if (active()) { event.preventDefault(); event.returnValue = ''; }
});
$('usb-refresh').addEventListener('click', () => perform(async () => {
  usbRefreshing = true;
  renderUsb();
  try {
    const ports = await usb.listPorts();
    const selected = $('usb-port').value;
    const options = ports.map(({ path, manufacturer }) => {
      const option = document.createElement('option');
      option.value = path;
      option.textContent = `${path}${manufacturer ? ` · ${manufacturer}` : ''}`;
      return option;
    });
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = ports.length ? 'Select a serial port' : 'No serial ports found';
    $('usb-port').replaceChildren(placeholder, ...options);
    if (ports.some((port) => port.path === selected)) $('usb-port').value = selected;
    if (!ports.length) usbState.message = 'No ports found. Check the computer data cable, power, drivers, and port permissions.';
  } finally {
    usbRefreshing = false;
    renderUsb();
  }
}));
$('usb-port').addEventListener('change', renderUsb);
$('usb-connect').addEventListener('click', () => perform(async () => {
  if (['connected', 'connecting'].includes(usbState.status)) await usb.disconnect();
  else await usb.connect($('usb-port').value);
}));
$('usb-firmware').addEventListener('click', () => perform(() => usb.query('M115')));
$('usb-position').addEventListener('click', () => perform(() => usb.query('M114')));
$('usb-export').addEventListener('click', () => {
  const report = { exportedAt: new Date().toISOString(), mode: 'USB diagnostics only; motion disabled', ...usbState };
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'dexarm-diagnostics.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
function renderJobEditors(ready, locked) {
  for (const id of ['gcode-source', 'gcode-import', 'gcode-example', 'gcode-review', 'teach-name', 'teach-tool', 'teach-repeat', 'teach-add-type', 'teach-add', 'teach-open', 'teach-generate', 'jog-feedrate', 'jog-step', 'move-x', 'move-y', 'move-z']) $(id).disabled = locked;
  $('move-to').disabled = $('move-current').disabled = !ready;
  $('gcode-export').disabled = !importedJob;
  $('gcode-run').disabled = !ready || !importedJob;
  $('teach-record').disabled = !ready;
  $('teach-export').disabled = !taughtJob;
  $('teach-run').disabled = !ready || !taughtJob;
  $('teach-save').disabled = locked;
  $('teach-add-type').querySelector('option[value="action"]').disabled = $('teach-tool').value === 'pen';
  if ($('teach-tool').value === 'pen' && $('teach-add-type').value === 'action') $('teach-add-type').value = 'move';
  $('teach-steps').querySelectorAll('input,select,button').forEach((element) => { element.disabled = locked; });
  [...$('teach-steps').children].forEach((row, index, rows) => {
    row.querySelector('[data-operation="up"]').disabled = locked || index === 0;
    row.querySelector('[data-operation="down"]').disabled = locked || index === rows.length - 1;
  });
  $('teach-pump').textContent = `Simulated pump: ${controller.pump}`;
  $('clearance-hint').textContent = `${project.penLift ?? 10} mm pen-up clearance between strokes. Work origin changes this project only.`;
}

function invalidateGcode() {
  importedJob = null;
  controller.completed = controller.total = 0;
  controller.message = 'G-code source changed. Review again before sending.';
  $('gcode-error').textContent = '';
  $('gcode-review-info').textContent = 'Source changed. Review the complete G-code again before sending.';
  render();
}
$('gcode-source').addEventListener('input', invalidateGcode);
$('gcode-import').addEventListener('click', () => $('gcode-file').click());
$('gcode-file').addEventListener('change', () => perform(async () => {
  const file = $('gcode-file').files[0]; $('gcode-file').value = '';
  if (!file) return;
  if (file.size > 262144) throw new Error('G-code files must be smaller than 256 KB');
  const source = await file.text();
  if (active() || controller.busy || controller.state === 'connecting' || fontBusy) throw new Error('Wait for the current operation before importing');
  $('gcode-source').value = source; invalidateGcode();
}));
$('gcode-example').addEventListener('click', () => {
  $('gcode-source').value = 'G21\nG90\nG0 X-20 Y280 Z10 F1200\nG1 X20 Y280 Z10 F600\nG1 X20 Y320 Z10\nG1 X-20 Y320 Z10\nG1 X-20 Y280 Z10\nM400\n';
  invalidateGcode();
});
$('gcode-review').addEventListener('click', () => {
  importedJob = null;
  try {
    const source = $('gcode-source').value;
    importedJob = { ...parseGcode(source), source };
    $('gcode-error').textContent = '';
    const { bounds, estimatedSeconds } = importedJob;
    $('gcode-review-info').textContent = `${importedJob.commands.length} commands · X ${bounds.min.x.toFixed(1)}…${bounds.max.x.toFixed(1)}, Y ${bounds.min.y.toFixed(1)}…${bounds.max.y.toFixed(1)}, Z ${bounds.min.z.toFixed(1)}…${bounds.max.z.toFixed(1)} mm. Ideal path time ${estimatedSeconds.toFixed(1)} s, excluding the initial approach and acceleration; simulator timing differs.`;
    $('generated-code').open = true;
    controller.message = 'G-code reviewed against simulator limits. Unsupported commands are never sent. Connect and home to simulate.';
  } catch (error) { $('gcode-error').textContent = error.message; $('gcode-review-info').textContent = 'Review failed. No commands are available to send.'; controller.message = 'G-code review failed. Correct the reported line before sending.'; }
  render();
});
$('gcode-export').addEventListener('click', () => { if (importedJob) download('reviewed.gcode', importedJob.commands.join('\n') + '\n', 'text/plain'); });
$('gcode-run').addEventListener('click', () => perform(async () => {
  if (!importedJob) throw new Error('Review G-code first');
  await controller.runGcode(importedJob.source);
}));

function readSequence(skip = -1) {
  const steps = [...$('teach-steps').children].filter((_, index) => index !== skip).map((row) => {
    const value = (field) => row.querySelector(`[data-field="${field}"]`);
    if (row.dataset.type === 'move') return { type: 'move', name: value('name').value, x: value('x').valueAsNumber, y: value('y').valueAsNumber, z: value('z').valueAsNumber, feedrate: value('feedrate').valueAsNumber };
    if (row.dataset.type === 'wait') return { type: 'wait', milliseconds: value('milliseconds').valueAsNumber };
    return { type: 'action', action: value('action').value };
  });
  return validateSequence({ version: 1, kind: 'teach', name: $('teach-name').value, tool: $('teach-tool').value, repeat: $('teach-repeat').valueAsNumber, steps });
}
function fillSequence() {
  $('teach-name').value = sequence.name; $('teach-tool').value = sequence.tool; $('teach-repeat').value = sequence.repeat;
  $('teach-steps').replaceChildren(...sequence.steps.map((step, index) => {
    const row = document.createElement('li'); row.dataset.type = step.type;
    const heading = document.createElement('div'); heading.className = 'section-heading';
    const title = document.createElement('strong'); title.textContent = `${index + 1} · ${step.type === 'action' ? 'Tool action' : step.type === 'wait' ? 'Wait' : 'Move'}`;
    heading.append(title);
    for (const [operation, label] of [['up', '↑'], ['down', '↓'], ['delete', '×']]) {
      const button = document.createElement('button'); button.className = 'text-button'; button.dataset.operation = operation;
      button.textContent = label; button.setAttribute('aria-label', `${operation} step ${index + 1}`); heading.append(button);
    }
    row.append(heading);
    const addInput = (field, label, type = 'number') => {
      const wrap = document.createElement('label'); wrap.textContent = label;
      const input = document.createElement('input'); input.dataset.field = field; input.type = type;
      if (type === 'number') input.step = field === 'milliseconds' ? '1' : '0.1';
      else input.maxLength = 40;
      input.value = step[field]; input.setAttribute('aria-label', `${label} step ${index + 1}`); wrap.append(input); row.append(wrap);
    };
    if (step.type === 'move') {
      addInput('name', 'Point name', 'text');
      for (const axis of ['x', 'y', 'z']) addInput(axis, `${axis.toUpperCase()} mm`);
      addInput('feedrate', 'Speed mm/min');
    } else if (step.type === 'wait') addInput('milliseconds', 'Wait ms');
    else {
      const label = document.createElement('label'); label.textContent = 'Action';
      const select = document.createElement('select'); select.dataset.field = 'action'; select.setAttribute('aria-label', `Action step ${index + 1}`);
      for (const [action, title] of [['pick', sequence.tool === 'gripper' ? 'Grip / pick' : 'Pick'], ['release', 'Release'], ['neutral', 'Neutral'], ['off', 'Off']]) {
        const option = document.createElement('option'); option.value = action; option.textContent = title; select.append(option);
      }
      select.value = step.action; label.append(select); row.append(label);
    }
    return row;
  }));
  $('teach-error').textContent = '';
}
function invalidateSequence() {
  taughtJob = null;
  controller.completed = controller.total = 0;
  controller.message = 'Sequence changed. Generate G-code again before playback.';
  $('teach-info').textContent = 'Sequence changed. Generate G-code again before playback.';
  try { sequence = readSequence(); $('teach-error').textContent = ''; }
  catch (error) { $('teach-error').textContent = `${error.message}. Preview retains the last valid sequence.`; }
  render();
}
for (const id of ['teach-name', 'teach-tool', 'teach-repeat', 'teach-steps']) $(id).addEventListener('input', invalidateSequence);
function addSequenceStep(record = false) {
  sequence = readSequence();
  const type = record ? 'move' : $('teach-add-type').value;
  if (record && (!controller.position || controller.state !== 'ready')) throw new Error('Connect and home before recording a simulator point');
  const point = record ? controller.position : { x: 0, y: 300, z: 10 };
  const step = type === 'move' ? { type: 'move', name: `Point ${sequence.steps.filter((s) => s.type === 'move').length + 1}`, ...point, feedrate: 600 } : type === 'wait' ? { type: 'wait', milliseconds: 500 } : { type: 'action', action: 'off' };
  sequence = validateSequence({ ...sequence, steps: [...sequence.steps, step] });
  taughtJob = null; controller.completed = controller.total = 0; fillSequence(); render();
}
$('teach-record').addEventListener('click', () => perform(() => addSequenceStep(true)));
$('teach-add').addEventListener('click', () => perform(() => addSequenceStep()));
$('teach-steps').addEventListener('click', (event) => {
  const button = event.target.closest('[data-operation]'); if (!button || active() || controller.busy) return;
  perform(() => {
    const index = [...$('teach-steps').children].indexOf(button.closest('li'));
    if (button.dataset.operation === 'delete') sequence = readSequence(index);
    else {
      sequence = readSequence(); const target = index + (button.dataset.operation === 'up' ? -1 : 1);
      if (target < 0 || target >= sequence.steps.length) return;
      [sequence.steps[index], sequence.steps[target]] = [sequence.steps[target], sequence.steps[index]];
    }
    taughtJob = null; controller.completed = controller.total = 0; fillSequence(); render();
  });
});
$('teach-generate').addEventListener('click', () => perform(() => {
  taughtJob = null;
  try {
    sequence = readSequence();
    taughtJob = { sequence: structuredClone(sequence), commands: sequenceCommands(sequence) };
    $('teach-info').textContent = `${sequence.steps.length} steps × ${sequence.repeat} repeat(s) · ${taughtJob.commands.length} commands. Ready to review; connect and home to play.`;
    controller.message = 'Sequence G-code generated. Review the commands, then connect and home to play.';
    $('generated-code').open = true;
  } finally { render(); }
}));
$('teach-export').addEventListener('click', () => { if (taughtJob) download(`${sequence.name}.gcode`, taughtJob.commands.join('\n') + '\n', 'text/plain'); });
$('teach-run').addEventListener('click', () => perform(async () => {
  if (!taughtJob) throw new Error('Generate sequence G-code first');
  await controller.runSequence(taughtJob.sequence);
}));
$('teach-save').addEventListener('click', () => perform(() => { sequence = readSequence(); download(`${sequence.name}.teach.json`, JSON.stringify(sequence, null, 2), 'application/json'); }));
$('teach-open').addEventListener('click', () => $('teach-file').click());
$('teach-file').addEventListener('change', () => perform(async () => {
  const file = $('teach-file').files[0]; $('teach-file').value = ''; if (!file) return;
  if (file.size > 262144) throw new Error('Sequence files must be smaller than 256 KB');
  const next = validateSequence(JSON.parse(await file.text()));
  if (active() || controller.busy || controller.state === 'connecting' || fontBusy) throw new Error('Wait for the current operation before opening a sequence');
  sequence = next; taughtJob = null; fillSequence(); render();
}));
fillSequence();
function fillFontOptions() {
  const selected = $('writing-font').value;
  $('writing-font').replaceChildren(...fontOptions().map(({ id, name, outline }) => {
    const option = document.createElement('option'); option.value = id; option.textContent = outline ? name : `Hershey ${name}`;
    return option;
  }));
  if (fontOptions().some((font) => font.id === selected)) $('writing-font').value = selected;
}
fillFontOptions();
fillProject();
renderUsb();
render();
