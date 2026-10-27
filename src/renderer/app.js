import { Controller } from '../core/controller.js';
import { defaultProject, validateProject, drawingStrokes, drawingCommands, layoutProject, textBounds } from '../core/project.js';
import { importSvg } from '../core/svg.js';
import { defaultWriting, WRITING_FONTS } from '../core/writing.js';

const $ = (id) => document.getElementById(id);
const controller = new Controller();
const usb = window.dexarmDevice;
let usbState = { status: 'disconnected', busy: false, firmware: '', position: null, log: [], message: 'USB disconnected. Physical motion is disabled.' };
let usbRefreshing = false;
let project = defaultProject();
let writingEnabled = false;
let generated = null;
let selectedText = null;
let dragging = null;
let tab = 'draw';
let lastLog = 0;
const fields = ['project-name', 'size', 'feedrate', 'origin-x', 'origin-y', 'origin-z', 'writing-text', 'writing-font', 'writing-height', 'writing-letter-spacing', 'writing-line-spacing', 'writing-align', 'writing-mode-outline', 'writing-mode-centerline', 'writing-style', 'text-x', 'text-y'];
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
    origin: { x: $('origin-x').valueAsNumber, y: $('origin-y').valueAsNumber, z: $('origin-z').valueAsNumber },
    ...content });
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
    const bounds = textBounds(text, project.origin);
    const [x, y] = screenPoint({ x: bounds.left, y: bounds.top });
    const group = svg('g');
    group.dataset.textId = text.id;
    group.setAttribute('role', 'button');
    group.setAttribute('tabindex', active() || controller.busy ? '-1' : '0');
    group.setAttribute('aria-label', `Text ${index + 1}: ${text.writing.text}. Select to edit; drag or use arrow keys to move.`);
    group.setAttribute('aria-pressed', String(selectedText === text.id));
    group.setAttribute('aria-disabled', String(active() || controller.busy || controller.state === 'connecting'));
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

function render() {
  const ready = controller.state === 'ready' && !controller.busy;
  const locked = active() || controller.busy || controller.state === 'connecting';
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
  const outlineAvailable = WRITING_FONTS.find((font) => font.id === $('writing-font').value)?.outline;
  $('writing-mode-outline').disabled = locked || !outlineAvailable;
  $('writing-mode-centerline').disabled = locked;
  $('writing-style').disabled = locked || !outlineAvailable;
  $('style-help').textContent = outlineAvailable ? 'Real font variants. Centerline follows the selected style; pen thickness stays the same.' : 'Hershey fonts have a fixed stroke style. Choose DejaVu for bold or italic.';
  $('writing-mode-help').textContent = !outlineAvailable
    ? 'Hershey fonts contain pen strokes only. Choose DejaVu Sans or Serif to compare outlines with converted centerlines.'
    : $('writing-mode-outline').checked
      ? 'Outline follows the borders of the letter, including inner contours. Letter height uses the full capital outline.'
      : 'Centerline writes through the middle of the letter. Converted corners and serifs are approximate; inspect the main preview.';
  $('use-position').disabled = !ready;
  $('open').disabled = locked;
  $('import-svg').disabled = locked;
  $('reset-artwork').disabled = locked || (!project.artwork && project.version !== 2);
  $('preview').disabled = locked || (project.version === 2 && !project.texts.length && !project.artwork);
  $('preview').textContent = generated ? '2 · Regenerate G-code' : '2 · Generate G-code';
  $('download-gcode').disabled = !generated;
  $('gcode-output').value = generated ? generated.commands.join('\n') + '\n' : '';
  $('gcode-summary').textContent = generated ? `${generated.commands.length} commands · ready to review` : 'Not generated · layout editable';
  $('gcode-status').textContent = generated ? 'Generated from the current layout. Review below or download; any layout edit requires regeneration.' : 'Create or edit your layout, then generate G-code. No connection is needed.';
  $('run').disabled = !ready || !generated;
  $('pause').hidden = !active();
  $('pause').textContent = controller.state === 'paused' ? 'Resume simulation' : controller.state === 'pausing' ? 'Pausing…' : 'Pause simulation';
  $('pause').disabled = controller.state === 'pausing';
  document.querySelectorAll('[data-axis]').forEach((button) => { button.disabled = !ready; });
  $('status-message').textContent = controller.message;
  $('job-title').textContent = active() ? `${labels[controller.state]} · ${project.name}` : controller.total && controller.completed === controller.total ? 'Your drawing is complete' : generated ? 'G-code generated' : 'Create your layout';
  $('progress-count').textContent = controller.total ? `${controller.completed} / ${controller.total} commands` : '—';
  $('job-progress').max = controller.total || 1;
  $('job-progress').value = controller.completed;
  $('run-hint').textContent = active() ? '3 · Job in progress. Pause or stop the simulator below.' : !generated ? '1 · Arrange text and artwork. Then generate G-code, even while disconnected.' : !ready ? '2 · G-code ready. Download it, or connect and home the simulator for step 3.' : '3 · G-code ready. Send this generated job to the simulator.';
  $('step-prepare').classList.toggle('active', !generated && !active());
  $('step-preview').classList.toggle('active', generated && !active());
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
  draw();
}

controller.addEventListener('change', render);
$('connect').addEventListener('click', () => perform(() => connected() ? controller.stop() : controller.connect()));
$('stop').addEventListener('click', () => controller.stop());
$('home').addEventListener('click', () => perform(() => controller.home()));
$('preview').addEventListener('click', () => perform(() => {
  project = readProject();
  generated = { project: structuredClone(project), commands: drawingCommands(project) };
  $('generated-code').open = true;
  controller.message = `G-code generated: ${generated.commands.length} commands. Review or download, then connect and home to simulate.`;
  render();
}));
$('run').addEventListener('click', () => perform(async () => {
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
  if (id === 'writing-font' && !WRITING_FONTS.find((font) => font.id === $('writing-font').value)?.outline) {
    $('writing-mode-centerline').checked = true;
    $('writing-style').value = 'regular';
  }
  resetPreview();
  try {
    project = readProject();
    $('writing-error').textContent = '';
  } catch (error) {
    $('writing-error').textContent = writingEnabled ? `${error.message}. Preview shows the last valid layout.` : '';
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
  $('jog-settings').hidden = tab !== 'control';
  $('usb-settings').hidden = tab !== 'control';
  $('page-title').textContent = tab === 'draw' ? 'Drawing workspace' : 'Manual control';
  $('page-description').textContent = tab === 'draw' ? 'Create your layout, generate G-code, then send the checked job.' : 'Get familiar with the arm, one deliberate step at a time.';
}));
document.querySelectorAll('[data-axis]').forEach((button) => button.addEventListener('click', () => perform(() =>
  controller.jog(button.dataset.axis, Number(button.dataset.direction) * Number($('jog-step').value)))));
$('save').addEventListener('click', () => perform(() => {
  project = readProject();
  const url = URL.createObjectURL(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${project.name.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase() || 'drawing'}.dexarm.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}));
$('import-svg').addEventListener('click', () => $('svg-file').click());
$('svg-file').addEventListener('change', () => perform(async () => {
  const file = $('svg-file').files[0];
  $('svg-file').value = '';
  if (!file) return;
  if (file.size > 262144) throw new Error('SVG files must be smaller than 256 KB');
  const artwork = importSvg(await file.text(), file.name);
  if (active() || controller.busy || controller.state === 'connecting') throw new Error('Wait for the current operation before importing artwork');
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
  if (!generated) throw new Error('Generate G-code first');
  download(`${project.name}.gcode`, generated.commands.join('\n') + '\n', 'text/plain');
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
  if (!target || event.button !== 0 || active() || controller.busy || controller.state === 'connecting') return;
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
  if (box && !active() && !controller.busy) perform(() => selectText(box.dataset.textId));
});
$('text-boxes').addEventListener('keydown', (event) => {
  const box = event.target.closest('[data-text-id]');
  if (!box || active() || controller.busy || controller.state === 'connecting') return;
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
  if (file.size > 262144) throw new Error('Project files must be smaller than 256 KB');
  const nextProject = validateProject(JSON.parse(await file.text()));
  if (active() || controller.busy) throw new Error('Wait for the current operation before opening a project');
  project = nextProject;
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
for (const { id, name } of WRITING_FONTS) {
  const option = document.createElement('option');
  option.value = id;
  option.textContent = WRITING_FONTS.find((font) => font.id === id).outline ? name : `Hershey ${name}`;
  $('writing-font').append(option);
}
fillProject();
renderUsb();
render();
