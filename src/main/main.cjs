const { app, BrowserWindow, session, ipcMain } = require('electron');
const path = require('node:path');
const { registerDeviceIpc } = require('./device-ipc.cjs');
let mainWindow;
let monitor;

function openWindow() {
  const window = new BrowserWindow({
    width: 1440, height: 960, minWidth: 1000, minHeight: 720,
    backgroundColor: '#f5f6f8', title: 'DexArm Studio',
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.cjs') },
  });
  mainWindow = window;
  window.removeMenu();
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.on('closed', () => { mainWindow = null; monitor.disconnect().catch(console.error); });
  window.loadFile(path.join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(async () => {
  const { DeviceMonitor } = await import('./device.js');
  let SerialPort;
  try { ({ SerialPort } = require('serialport')); }
  catch (error) { console.error('USB serial support could not load:', error.message); }
  monitor = new DeviceMonitor(SerialPort, { onChange: (state) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('device:changed', state);
  } });
  registerDeviceIpc(ipcMain, monitor, () => mainWindow);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  openWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) openWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
