// Use Electron's detached XML DOM to test the importer without an extra DOM dependency.
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const os = require('node:os');
const { readFile } = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
app.setPath('userData', path.join(os.tmpdir(), 'dexarm-svg-check'));
app.disableHardwareAcceleration();
const timer = setTimeout(() => { console.error('SVG DOM checks timed out'); app.exit(1); }, 15000);
app.whenReady().then(() => {
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  window.webContents.on('console-message', async (event) => {
    if (!event.message.startsWith('SVG_CHECK:')) return;
    const result = JSON.parse(event.message.slice('SVG_CHECK:'.length));
    console.log(result.message);
    if (result.ok && process.argv.length > 2) {
      try {
        const files = await Promise.all(process.argv.slice(2).map(async (file) => ({ name: path.basename(file), source: await readFile(file, 'utf8') })));
        const svgModule = pathToFileURL(path.join(__dirname, '../src/core/svg.js')).href;
        const projectModule = pathToFileURL(path.join(__dirname, '../src/core/project.js')).href;
        const reports = await window.webContents.executeJavaScript(`(async () => {
          const { importSvg } = await import(${JSON.stringify(svgModule)});
          const { defaultProject, validateProject, drawingCommands } = await import(${JSON.stringify(projectModule)});
          return ${JSON.stringify(files)}.map(({ name, source }) => {
            const project = validateProject({ ...defaultProject(), size: 140, artwork: importSvg(source, name) });
            return { name, strokes: project.artwork.strokes.length, commands: drawingCommands(project).length };
          });
        })()`);
        console.log('Exported SVG import checks passed:', JSON.stringify(reports));
      } catch (error) {
        console.error(error.message);
        app.exit(1);
        return;
      }
    }
    clearTimeout(timer);
    app.exit(result.ok ? 0 : 1);
  });
  window.webContents.on('did-fail-load', (_event, _code, description) => { console.error(description); app.exit(1); });
  window.loadFile(path.join(__dirname, '../tests/fixtures/svg-check.html'));
});
