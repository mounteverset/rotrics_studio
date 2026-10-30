const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dexarmDevice', Object.freeze({
  listPorts: () => ipcRenderer.invoke('device:list'),
  connect: (path) => ipcRenderer.invoke('device:connect', path),
  query: (command) => ipcRenderer.invoke('device:query', command),
  home: () => ipcRenderer.invoke('device:home'),
  move: (step) => ipcRenderer.invoke('device:move', step),
  run: (job) => ipcRenderer.invoke('device:run', job),
  pause: () => ipcRenderer.invoke('device:pause'),
  resume: () => ipcRenderer.invoke('device:resume'),
  stop: () => ipcRenderer.invoke('device:stop'),
  disconnect: () => ipcRenderer.invoke('device:disconnect'),
  getState: () => ipcRenderer.invoke('device:snapshot'),
  onChange(callback) {
    if (typeof callback !== 'function') throw new TypeError('Expected a change callback');
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('device:changed', listener);
    return () => ipcRenderer.removeListener('device:changed', listener);
  },
}));
