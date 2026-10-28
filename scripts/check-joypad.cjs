// Renderer integration check with synthetic controller input; no USB or real gamepad.
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
app.setPath('userData', path.join(os.tmpdir(), 'dexarm-joypad-check'));
app.disableHardwareAcceleration();
const timeout = setTimeout(() => { console.error('Joypad check timed out'); app.exit(1); }, 20000);
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const js = (source) => window.webContents.executeJavaScript(source);
  const wait = async (source) => {
    for (let i = 0; i < 150; i++) {
      if (await js(source)) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`Condition failed: ${source}`);
  };
  const pause = () => new Promise((resolve) => setTimeout(resolve, 750));
  const x = () => js("Number(document.getElementById('pos-x').textContent)");
  try {
    await window.loadFile(path.join(__dirname, '../src/renderer/index.html'));
    await js(`globalThis.testPad = {connected:true, mapping:'standard', index:0, id:'Synthetic Xbox',axes:[0,0,0,0],buttons:Array.from({length:16},()=>({pressed:false,value:0}))};
      Object.defineProperty(navigator,'getGamepads',{value:()=>[globalThis.testPad]});
      Object.defineProperty(document,'hasFocus',{value:()=>true});
      document.querySelector('[data-tab="joypad"]').click(); document.getElementById('connect').click();`);
    await wait("!document.getElementById('joypad-home').disabled");
    await js("document.getElementById('joypad-home').click()");
    await wait("!document.getElementById('joypad-enable').disabled");
    await js("testPad.axes[0]=1; document.getElementById('joypad-enable').click()");
    assert.match(await js("document.getElementById('joypad-state').textContent"), /Center both sticks/);
    await js("testPad.axes[0]=0; document.getElementById('joypad-enable').click();testPad.axes[0]=1");
    await pause(); assert.equal(await x(), 0, 'No hold must mean no movement');
    await js("testPad.buttons[5].pressed=true");
    await wait("Number(document.getElementById('pos-x').textContent)>0");
    await js("testPad.buttons[5].pressed=false");
    await pause(); const stopped = await x();
    await pause(); assert.equal(await x(), stopped, 'No backlog after hold release');
    await js("testPad.buttons[4].pressed=true;testPad.buttons[5].pressed=true");
    await wait(`Number(document.getElementById('pos-x').textContent)>${stopped}`);
    await js("testPad.buttons[5].pressed=false");
    await pause(); assert.ok(Math.abs(await x() - stopped - 0.2) < 0.01, 'Fine mode uses 0.2 mm');
    const beforeSlow = await x();
    await js("testPad.buttons[4].pressed=false;const speed=document.getElementById('joypad-speed');speed.value='10';speed.dispatchEvent(new Event('input'));testPad.buttons[5].pressed=true");
    await wait(`Number(document.getElementById('pos-x').textContent)>${beforeSlow}`);
    await js("testPad.buttons[5].pressed=false");
    await pause(); assert.ok(Math.abs(await x() - beforeSlow - 0.1) < 0.01, '10 percent uses 0.1 mm steps');
    assert.equal(await js("document.getElementById('joypad-speed-value').textContent"), '10%');
    assert.equal(await js("Array.from(document.querySelectorAll('#log li')).some(row => /G1 .* F60$/.test(row.textContent))"), true);
    await js("{const maximum=document.getElementById('joypad-max-speed');maximum.value='120000';maximum.dispatchEvent(new Event('blur'))}");
    assert.equal(await js("document.getElementById('joypad-max-speed').value"), '3000');
    assert.match(await js("document.getElementById('joypad-max-speed-note').textContent"), /Limited to 3000/);
    const beforeMaximum = await x();
    await js("const slider=document.getElementById('joypad-speed');slider.value='100';slider.dispatchEvent(new Event('input'));testPad.buttons[5].pressed=true");
    await wait(`Number(document.getElementById('pos-x').textContent)>${beforeMaximum}`);
    await js("testPad.buttons[5].pressed=false");
    await pause(); assert.ok(Math.abs(await x() - beforeMaximum - 5) < 0.01, 'Configured maximum scales normal step to 5 mm');
    assert.equal(await js("Array.from(document.querySelectorAll('#log li')).some(row => /G1 .* F3000$/.test(row.textContent))"), true);
    await js("{const maximum=document.getElementById('joypad-max-speed');maximum.value='';maximum.dispatchEvent(new Event('blur'))}");
    assert.equal(await js("document.getElementById('joypad-max-speed').value"), '3000');
    await js("{const maximum=document.getElementById('joypad-max-speed');maximum.value='50';maximum.dispatchEvent(new Event('blur'))}");
    assert.equal(await js("document.getElementById('joypad-max-speed').value"), '600');
    await js("window.dispatchEvent(new Event('blur'))");
    assert.equal(await js("document.getElementById('joypad-enable').textContent"), 'Enable joypad');
    await js("testPad.buttons[5].pressed=true");
    const blurred = await x(); await pause(); assert.equal(await x(), blurred, 'Blur does not auto-resume');
    await js("testPad.axes[0]=0;testPad.buttons[5].pressed=false;document.getElementById('joypad-enable').click();document.querySelector('[data-tab=control]').click();document.querySelector('[data-tab=joypad]').click()");
    assert.equal(await js("document.getElementById('joypad-enable').textContent"), 'Enable joypad');
    await js("document.getElementById('joypad-enable').click();testPad.connected=false");
    await wait("document.getElementById('joypad-enable').textContent==='Enable joypad'");
    await js("testPad.connected=true;testPad.mapping='unknown'");
    await wait("document.getElementById('joypad-enable').disabled");
    console.log('Joypad renderer checks passed: neutral gate, hold, fine movement, no backlog, focus, navigation, unplug and unsupported mapping.');
    clearTimeout(timeout); app.exit(0);
  } catch (error) { console.error(error); clearTimeout(timeout); app.exit(1); }
});
