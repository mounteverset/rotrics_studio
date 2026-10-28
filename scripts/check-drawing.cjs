// Actual renderer integration against the simulator; no preload, USB or physical motion.
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
app.setPath('userData', path.join(os.tmpdir(), `dexarm-drawing-check-${process.pid}`));
app.disableHardwareAcceleration();
const timeout = setTimeout(() => { console.error('Drawing check timed out'); app.exit(1); }, 30000);
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: {
    sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
  } });
  const js = (source) => window.webContents.executeJavaScript(source);
  const wait = async (source) => {
    for (let i = 0; i < 250; i++) {
      if (await js(source)) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`Condition failed: ${source}`);
  };
  const click = async (id) => {
    await wait(`document.getElementById(${JSON.stringify(id)}) && !document.getElementById(${JSON.stringify(id)}).disabled`);
    await js(`document.getElementById(${JSON.stringify(id)}).click()`);
    assert.equal(await js("document.getElementById('error-dialog').open"), false,
      await js("document.getElementById('error-message').textContent"));
  };
  const input = async (id, value, event = 'input') => {
    await js(`{ const field = document.getElementById(${JSON.stringify(id)});
      field[${typeof value === 'boolean' ? "'checked'" : "'value'"}] = ${JSON.stringify(value)};
      field.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true })); }`);
    assert.equal(await js("document.getElementById('error-dialog').open"), false,
      await js("document.getElementById('error-message').textContent"));
  };
  const count = () => js("document.getElementById('object-list').options.length");
  const geometry = () => js("document.getElementById('drawing-path').getAttribute('d')");
  const saved = async () => {
    await wait("/saved locally/i.test(document.getElementById('autosave-status').textContent)");
    return js("JSON.parse(localStorage.getItem('dexarm-drawing-autosave'))");
  };
  try {
    const file = path.join(__dirname, '../src/renderer/index.html');
    await window.loadFile(file);
    await wait("document.getElementById('preset-shape').options.length > 0");
    assert.equal(await js("typeof window.dexarmDevice"), 'undefined', 'No physical-device preload');
    await click('empty-layout');
    assert.equal(await count(), 0);
    await input('preset-shape', 'Rectangle', 'change');
    await click('preset-add');
    await input('artwork-lock', false);
    await input('artwork-width', 40);
    await input('artwork-height', 20);
    await input('artwork-mirror-x', true);
    assert.equal(await js("document.getElementById('artwork-height').valueAsNumber"), 20);
    await input('preset-shape', 'Heart', 'change');
    await click('preset-add');
    await input('artwork-x', 50);
    const beforeMove = await geometry();
    await input('artwork-x', 55);
    const afterMove = await geometry();
    assert.notEqual(afterMove, beforeMove);
    await click('undo-layout');
    assert.equal(await geometry(), beforeMove, 'Undo restores geometry');
    await click('redo-layout');
    assert.equal(await geometry(), afterMove, 'Redo restores geometry');
    await js(`{ const list = document.getElementById('object-list');
      for (const option of list.options) option.selected = /SVG: Heart/.test(option.textContent);
      list.dispatchEvent(new Event('change', { bubbles: true })); }`);
    await input('artwork-x', 50);
    await click('write-text');
    assert.equal(await count(), 3);
    await js(`{ const list = document.getElementById('object-list');
      for (const option of list.options) option.selected = true;
      list.dispatchEvent(new Event('change', { bubbles: true })); }`);
    await click('selection-group');
    assert.equal(await js("[...document.getElementById('object-list').options].filter(o => /grouped/.test(o.textContent)).length"), 3);
    await click('selection-duplicate');
    assert.equal(await count(), 6);
    assert.equal(await js("document.getElementById('object-list').selectedOptions.length"), 3);
    await click('selection-ungroup');
    assert.equal(await js("[...document.getElementById('object-list').selectedOptions].some(o => /grouped/.test(o.textContent))"), false);
    await click('selection-delete');
    assert.equal(await count(), 3, 'Only duplicate selection is deleted');
    await input('hatch-spacing', 5);
    await input('hatch-angle', 30);
    await input('hatch-fill', true);
    await input('optimize-path', true);
    await input('paper-preset', 'postcard', 'change');
    await click('preview');
    assert.match(await js("document.getElementById('gcode-summary').textContent"), /^[1-9]\d* commands/);
    const code = await js("document.getElementById('gcode-output').value");
    assert.match(code, /G1 X.* Z0\.000/);
    assert.ok((await geometry()).match(/M /g).length > 0);
    const project = await saved();
    assert.equal(project.artworks.length, 2);
    assert.equal(project.texts.length, 1);
    const rectangle = project.artworks.find((a) => a.name === 'Rectangle');
    assert.equal(rectangle.width, 40);
    assert.equal(rectangle.height, 20);
    assert.equal(rectangle.mirrorX, true);
    assert.equal(project.artworks.find((a) => a.name === 'Heart').x, 50);
    assert.equal(new Set([...project.artworks, ...project.texts].map((o) => o.group)).size, 1);
    assert.ok(rectangle.group);
    assert.deepEqual(project.options, { optimize: true, hatch: true, hatchSpacing: 5, hatchAngle: 30 });
    assert.equal(project.paper.width, 148);
    assert.equal(project.paper.height, 105);
    const report = await js(`(async () => {
      const core = await import('../core/project.js');
      const plan = await import('../core/drawing-plan.js');
      const project = core.validateProject(JSON.parse(localStorage.getItem('dexarm-drawing-autosave')));
      const paths = core.drawingStrokes(project);
      return { strokes: paths.length, outlines: core.drawingStrokes({ ...project, options: undefined }).length,
        code: core.drawingCommands(project).join('\\n') + '\\n',
        boundary: plan.boundaryCommands(paths, project.origin, project.travelFeedrate ?? project.feedrate, project.penLift ?? 10) };
    })()`);
    assert.equal(code, report.code, 'Preview commands match final core geometry');
    assert.ok(report.strokes > report.outlines, 'Hatching adds actual paths');
    await click('connect');
    await click('home');
    await wait("!document.getElementById('boundary-run').disabled");
    const sentBefore = await js("document.querySelectorAll('#log .send').length");
    await click('boundary-run');
    await wait("document.getElementById('device-state').textContent === 'Ready' && !document.getElementById('boundary-run').disabled && /complete/i.test(document.getElementById('status-message').textContent)");
    const boundary = await js(`Array.from(document.querySelectorAll('#log .send')).slice(${sentBefore}).map(row => row.textContent.replace(/^→ /, ''))`);
    assert.deepEqual(boundary, report.boundary, 'Simulator sends exactly the raised boundary job');
    const moves = boundary.filter((line) => /^G1\b/.test(line));
    assert.equal(moves.length, 6);
    for (const line of moves) assert.match(line, /\bZ10\.000(?:\s|$)/, 'Every boundary move stays raised');
    assert.ok(!moves.some((line) => /\bZ0(?:\.0+)?(?:\s|$)/.test(line)));
    await saved();
    const persistedGeometry = await geometry();
    await window.loadFile(file);
    await click('restore-autosave');
    assert.equal(await count(), 3);
    assert.equal(await geometry(), persistedGeometry, 'Recovery restores final drawing geometry');
    assert.equal(await js("document.getElementById('paper-width').valueAsNumber"), 148);
    assert.equal(await js("document.getElementById('paper-height').valueAsNumber"), 105);
    assert.deepEqual(await saved(), project, 'Recovery preserves IDs, mirrors, paper, groups and options');
    await click('preview');
    assert.equal(await js("document.getElementById('gcode-output').value"), code);
    await click('empty-layout');
    assert.equal(await count(), 0);
    await click('undo-layout');
    assert.equal(await count(), 3);
    await window.loadFile(file);
    await click('restore-autosave');
    assert.equal(await count(), 3, 'Immediate reload after undo preserves recovered layout');
    assert.equal(await geometry(), persistedGeometry);
    console.log(`Drawing renderer checks passed: presets, dimensions, mirror, text, group/copy/ungroup/delete, undo/redo, ${report.strokes} final paths, raised Z10 boundary and autosave recovery.`);
    clearTimeout(timeout); app.exit(0);
  } catch (error) {
    console.error(error);
    console.error(await js("({ error: document.getElementById('error-message')?.textContent, status: document.getElementById('status-message')?.textContent, autosave: document.getElementById('autosave-status')?.textContent })").catch(() => 'Renderer unavailable'));
    clearTimeout(timeout); app.exit(1);
  }
}).catch((error) => { console.error(error); clearTimeout(timeout); app.exit(1); });
