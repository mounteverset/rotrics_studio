const path = require('node:path');
const { pathToFileURL } = require('node:url');

const rendererUrl = pathToFileURL(path.join(__dirname, '../renderer/index.html')).href;

function registerDeviceIpc(ipcMain, monitor, getWindow) {
  for (const method of ['list', 'connect', 'query', 'disconnect', 'snapshot']) {
    ipcMain.handle(`device:${method}`, async (event, argument) => {
      const webContents = getWindow()?.webContents;
      if (!webContents || !event.senderFrame || event.sender !== webContents ||
          event.senderFrame !== webContents.mainFrame || event.senderFrame.url.split('#')[0] !== rendererUrl) {
        throw new Error('Unauthorized device request');
      }
      if (method === 'connect' && (typeof argument !== 'string' ||
          argument.length < 1 || argument.length > 256 || /[\r\n\0]/.test(argument))) {
        throw new Error('Invalid device path');
      }
      if (method === 'query' && argument !== 'M115' && argument !== 'M114') {
        throw new Error('Invalid device query');
      }
      return method === 'connect' || method === 'query'
        ? monitor[method](argument)
        : monitor[method]();
    });
  }
}

module.exports = { registerDeviceIpc };
