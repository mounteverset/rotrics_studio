import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { registerDeviceIpc } = require('../src/main/device-ipc.cjs');
const rendererUrl = new URL('../src/renderer/index.html', import.meta.url).href;

function setup() {
  const handlers = new Map();
  const calls = [];
  const ports = [{ path: '/dev/ttyUSB0' }];
  const snapshot = { state: 'connected', path: '/dev/ttyUSB0' };
  const monitor = {};
  for (const method of ['list', 'connect', 'query', 'disconnect', 'snapshot']) {
    monitor[method] = async (...args) => {
      calls.push([method, ...args]);
      return method === 'list' ? ports : snapshot;
    };
  }
  const mainFrame = { url: rendererUrl };
  const webContents = { mainFrame };
  const window = { webContents };
  const event = { sender: webContents, senderFrame: mainFrame };
  registerDeviceIpc({ handle: (channel, handler) => handlers.set(channel, handler) }, monitor, () => window);
  return { handlers, calls, ports, snapshot, window, event };
}

test('all device channels reject unauthorized senders, subframes, and URLs before dispatch', async () => {
  for (const channel of ['device:list', 'device:connect', 'device:query', 'device:disconnect', 'device:snapshot']) {
    for (const invalid of ['sender', 'subframe', 'url', 'missing frame', 'missing window']) {
      const { handlers, calls, window, event } = setup();
      if (invalid === 'sender') event.sender = {};
      if (invalid === 'subframe') event.senderFrame = { url: rendererUrl };
      if (invalid === 'url') event.senderFrame.url = `${rendererUrl}?untrusted`;
      if (invalid === 'missing frame') event.senderFrame = null;
      if (invalid === 'missing window') window.webContents = undefined;
      await assert.rejects(handlers.get(channel)(event, channel === 'device:query' ? 'M115' : '/dev/ttyUSB0'), /Unauthorized/);
      assert.deepEqual(calls, [], `${channel}: ${invalid}`);
    }
  }
});

test('connect rejects malformed paths before calling the monitor', async () => {
  const { handlers, calls, event } = setup();
  for (const path of [undefined, null, 1, {}, [], '', 'x'.repeat(257), 'COM1\r', 'COM1\n', 'COM1\0', '/dev/ttyUSB0\nM115']) {
    await assert.rejects(handlers.get('device:connect')(event, path), /Invalid device path/);
  }
  assert.deepEqual(calls, []);
});

test('query accepts only exact M115 and M114 strings, rejecting command injection before dispatch', async () => {
  const { handlers, calls, event } = setup();
  for (const command of [undefined, null, 115, {}, ['M115'], '', 'm115', ' M115', 'M114 ', 'M115\n', 'M114\r', 'M115\0', 'M115\nG0 X1', 'M114;G28', 'G28']) {
    await assert.rejects(handlers.get('device:query')(event, command), /Invalid device query/);
  }
  assert.deepEqual(calls, []);
});

test('authorized requests dispatch to the matching methods and return their results', async () => {
  const { handlers, calls, ports, snapshot, event } = setup();
  assert.deepEqual([...handlers.keys()], ['device:list', 'device:connect', 'device:query', 'device:disconnect', 'device:snapshot']);
  assert.equal(await handlers.get('device:list')(event), ports);
  for (const path of ['x', '/dev/ttyUSB0', 'x'.repeat(256)]) {
    assert.equal(await handlers.get('device:connect')(event, path), snapshot);
  }
  for (const command of ['M115', 'M114']) {
    assert.equal(await handlers.get('device:query')(event, command), snapshot);
  }
  assert.equal(await handlers.get('device:disconnect')(event), snapshot);
  assert.deepEqual(calls, [
    ['list'], ['connect', 'x'], ['connect', '/dev/ttyUSB0'], ['connect', 'x'.repeat(256)],
    ['query', 'M115'], ['query', 'M114'], ['disconnect'],
  ]);
});

test('in-page activity links keep authorization for the same trusted main frame', async () => {
  const { handlers, calls, event, snapshot } = setup();
  event.senderFrame.url = `${rendererUrl}#activity`;
  assert.equal(await handlers.get('device:snapshot')(event), snapshot);
  assert.deepEqual(calls, [['snapshot']]);
});

test('monitor failures reject the IPC request', async () => {
  const failure = new Error('Device unavailable');
  const handlers = new Map();
  const mainFrame = { url: rendererUrl };
  const webContents = { mainFrame };
  const monitor = { list: async () => { throw failure; } };
  registerDeviceIpc({ handle: (channel, handler) => handlers.set(channel, handler) }, monitor, () => ({ webContents }));
  await assert.rejects(handlers.get('device:list')({ sender: webContents, senderFrame: mainFrame }), (error) => error === failure);
});
