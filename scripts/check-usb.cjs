// Real sandboxed renderer/preload/IPC with a fake serial port; never opens hardware.
const { app, BrowserWindow, ipcMain } = require('electron');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { registerDeviceIpc } = require('../src/main/device-ipc.cjs');
app.setPath('userData', path.join(os.tmpdir(), `dexarm-usb-check-${process.pid}`));
app.disableHardwareAcceleration();
const deadline = setTimeout(() => { console.error('USB renderer check timed out'); app.exit(1); }, 30000);
app.whenReady().then(async () => {
  let port;
  let portLists = 0;
  class FakePort extends EventEmitter {
    static async list() { portLists++; return [{ path: '/dev/fake-dexarm' }]; }
    constructor() { super(); port = this; this.writes = []; }
    open(cb) { this.isOpen = true; cb(); }
    close(cb) { this.isOpen = false; queueMicrotask(() => { this.emit('close'); cb?.(); }); }
    write(line, cb) {
      this.writes.push(line.trim()); cb?.();
      if (this.hold?.(line.trim())) return;
      queueMicrotask(() => {
        if (!this.isOpen) return;
        if (line === 'M115\n') this.emit('data', Buffer.from('FIRMWARE_NAME:Fake DexArm\n'));
        if (line === 'M114\n') this.emit('data', Buffer.from('X:0 Y:300 Z:0\n'));
        this.emit('data', Buffer.from('ok\n'));
      });
    }
  }
  const { DeviceMonitor } = await import('../src/main/device.js');
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, '../src/main/preload.cjs') } });
  const monitor = new DeviceMonitor(FakePort, { onChange: (s) => window.webContents.send('device:changed', s) });
  registerDeviceIpc(ipcMain, monitor, () => window);
  const js = (s) => window.webContents.executeJavaScript(s);
  const wait = async (s) => {
    for (let i = 0; i < 200; i++) {
      if (await js(s)) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`Condition failed: ${s}`);
  };
  const visible = (selector) => js(`document.querySelector(${JSON.stringify(selector)})?.checkVisibility() === true`);
  const clickSelector = async (selector) => {
    assert.equal(await visible(selector), true, `${selector} must be visible before clicking`);
    await wait(`!document.querySelector(${JSON.stringify(selector)}).disabled`);
    await js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  };
  const click = (id) => clickSelector(`#${id}`);
  const settingsOpen = () => js("document.getElementById('usb-settings').matches(':popover-open')");
  const openSettings = async () => {
    if (!await settingsOpen()) await click('usb-settings-toggle');
    await wait("document.getElementById('usb-settings').matches(':popover-open')");
  };
  const closeSettings = async () => {
    if (await settingsOpen()) await click('usb-settings-close');
    assert.equal(await settingsOpen(), false);
  };
  const headerControls = ['usb-connect', 'usb-home', 'usb-drawing', 'usb-gcode', 'usb-pause', 'usb-stop', 'usb-settings-toggle'];
  const checkHeader = async (mode) => {
    for (const id of headerControls) {
      assert.equal(await js(`!!document.getElementById('${id}').closest('header')`), true, `${id} belongs in the header`);
      assert.equal(await visible(`#${id}`), id !== (mode === 'gcode' ? 'usb-drawing' : 'usb-gcode'), `${id} visibility matches the active mode`);
    }
    for (const id of ['usb-connection-label', 'usb-connection-dot']) assert.equal(await visible(`#${id}`), true, `${id} must be visible`);
  };
  try {
    await window.loadFile(path.join(__dirname, '../src/renderer/index.html'));
    await click('preview');
    await checkHeader('draw');
    await js("window.usbCheckConnect = document.getElementById('usb-connect')");
    assert.equal(await js("document.getElementById('usb-settings-toggle').getAttribute('popovertarget')"), 'usb-settings');
    assert.equal(await js("document.getElementById('usb-settings').hasAttribute('popover')"), true);
    assert.equal(await settingsOpen(), false);
    assert.equal(await js("document.getElementById('usb-port').value"), '');
    const listsBeforeConnect = portLists;
    await click('usb-connect');
    await wait("document.getElementById('usb-settings').matches(':popover-open')");
    await wait("document.getElementById('usb-port').options.length > 1");
    assert.equal(portLists > listsBeforeConnect, true, 'Connect refreshes available ports');
    assert.equal(port, undefined, 'Opening settings must not open serial hardware');
    assert.equal(await visible('#usb-port'), true);
    await js("document.getElementById('usb-port').value = '/dev/fake-dexarm'; document.getElementById('usb-port').dispatchEvent(new Event('change'))");
    await click('usb-connect');
    await wait("document.getElementById('usb-connect').textContent === 'Disconnect robot'");
    assert.deepEqual(port.writes, []);
    assert.equal(await js("document.getElementById('usb-home').disabled"), true);
    const writesBeforeDismiss = [...port.writes];
    await closeSettings();
    await openSettings();
    window.webContents.focus();
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await wait("!document.getElementById('usb-settings').matches(':popover-open')");
    assert.deepEqual(port.writes, writesBeforeDismiss, 'Opening and dismissing settings sends no commands');
    await openSettings();
    await closeSettings();
    assert.deepEqual(port.writes, writesBeforeDismiss, 'The settings close button sends no commands');
    await openSettings();
    await click('usb-firmware');
    await closeSettings();
    await click('usb-home');
    await wait("!document.getElementById('usb-move').disabled");
    await openSettings();
    await clickSelector('[data-usb-axis=x][data-usb-direction="1"]');
    await wait("!document.getElementById('usb-move').disabled");
    await click('usb-move');
    await closeSettings();
    await wait("!document.getElementById('usb-drawing').disabled");
    await click('usb-drawing');
    await wait("document.getElementById('usb-status').textContent.includes('completion barrier acknowledged')");
    assert.equal(port.writes.filter((s) => s.startsWith('G1')).length > 10, true);
    await clickSelector('[data-tab=gcode]');
    await checkHeader('gcode');
    assert.equal(await js("document.getElementById('usb-connect') === window.usbCheckConnect"), true, 'Header connect control persists across modes');
    await click('gcode-example'); await click('gcode-review');
    let held = false;
    port.hold = (line) => !held && line.startsWith('G1') && (held = true);
    await click('usb-gcode');
    await wait("!document.getElementById('usb-pause').disabled");
    await click('usb-pause');
    port.emit('data', Buffer.from('ok\n'));
    await wait("document.getElementById('usb-pause').textContent === 'Resume robot'");
    assert.equal(port.writes.at(-1), 'M400');
    await click('usb-pause');
    await wait("document.getElementById('usb-status').textContent.includes('completion barrier acknowledged')");
    await click('usb-stop');
    await wait("document.getElementById('usb-status').textContent.includes('M410 stop requested')");
    assert.equal(port.writes.at(-1), 'M410');
    assert.equal(await js("document.getElementById('usb-drawing').disabled"), true);
    assert.equal(await js("document.getElementById('error-dialog').open"), false, await js("document.getElementById('error-message').textContent"));
    console.log('USB renderer checks passed: real preload/IPC, connect without motion, identify, home, jog, XYZ, generated drawing, reviewed G-code, pause/resume, stop and motion lock. Fake serial only.');
    clearTimeout(deadline); window.destroy(); app.quit();
  } catch (e) { console.error(e); clearTimeout(deadline); await monitor.disconnect(); window.destroy(); app.exit(1); }
});
