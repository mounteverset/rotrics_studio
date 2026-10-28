import { JoypadDrive, readJoypad } from '../core/joypad.js';

export function setupJoypad(controller, isActive) {
  const $ = (id) => document.getElementById(id);
  const drive = new JoypadDrive(controller);
  let signature = '';
  let apiError = '';
  const key = (pad) => `${pad.index}:${pad.id}`;
  function pads() {
    try {
      if (!navigator.getGamepads) throw new Error('Gamepad API is unavailable in this environment.');
      apiError = '';
      return Array.from(navigator.getGamepads()).filter((pad) => pad?.connected);
    } catch (error) { apiError = error.message; return []; }
  }
  function selected(list) { return list.find((pad) => key(pad) === $('joypad-device').value); }
  function refresh() {
    if (!isActive()) return;
    if (drive.enabled && (controller.state !== 'ready' || !controller.homed || (controller.busy && !drive.pending))) drive.disable('Simulator is no longer ready. Joypad disabled.');
    const list = pads();
    const next = JSON.stringify(list.map(key));
    if (signature !== next) {
      const previous = $('joypad-device').value;
      $('joypad-device').replaceChildren(...list.map((pad) => {
        const option = document.createElement('option');
        option.value = key(pad); option.textContent = pad.id;
        return option;
      }));
      if (list.some((pad) => key(pad) === previous)) $('joypad-device').value = previous;
      signature = next;
    }
    const pad = selected(list);
    let input;
    let mappingError = '';
    if (pad) try { input = readJoypad(pad); } catch (error) { mappingError = error.message; }
    $('joypad-detected').textContent = apiError || mappingError || (pad ? 'Standard controller detected.' : 'Connect a gamepad and press a button while this window is focused.');
    $('joypad-input').textContent = input ? `X ${input.x.toFixed(2)} · Y ${input.y.toFixed(2)} · Z ${input.z.toFixed(2)} · Hold ${input.hold ? 'pressed' : 'released'} · ${input.fine ? 'Fine' : 'Normal'}` : 'No mapped input';
    $('joypad-home').disabled = !['uninitialized', 'ready'].includes(controller.state) || controller.busy;
    $('joypad-enable').disabled = !drive.enabled && (!input || controller.state !== 'ready' || !controller.homed || controller.busy || drive.pending);
    $('joypad-enable').textContent = drive.enabled ? 'Disable joypad' : 'Enable joypad';
    $('joypad-state').textContent = drive.message;
    $('joypad-device').disabled = drive.enabled;
  }
  $('joypad-enable').addEventListener('click', () => {
    if (drive.enabled) drive.disable();
    else try { drive.enable(selected(pads())); } catch (error) { drive.disable(error.message); }
    refresh();
  });
  $('joypad-home').addEventListener('click', async () => {
    drive.disable('Joypad disabled for homing. Enable explicitly afterward.');
    try { await controller.home(); } catch (error) { drive.disable(error.message); }
    refresh();
  });
  $('joypad-device').addEventListener('change', () => { drive.disable('Controller changed. Enable explicitly to continue.'); refresh(); });
  const leave = () => { if (drive.enabled) drive.disable('Joypad disabled after losing focus or leaving the workspace.'); refresh(); };
  window.addEventListener('blur', leave);
  document.addEventListener('visibilitychange', () => { if (document.hidden) leave(); });
  window.addEventListener('pagehide', leave);
  window.addEventListener('gamepaddisconnected', (event) => { if (event.gamepad.index === drive.padIndex) { drive.disable('Controller disconnected. Enable explicitly after reconnecting.'); refresh(); } });
  window.addEventListener('keydown', (event) => { if (event.key === 'Escape' && drive.enabled) { drive.disable('Joypad disabled by Escape.'); refresh(); } });
  setInterval(() => {
    if (!isActive()) return;
    void drive.tick(selected(pads()), { active: isActive(), focused: document.hasFocus() && !document.hidden }).then(refresh);
    refresh();
  }, 100);
  return { refresh, leave };
}
