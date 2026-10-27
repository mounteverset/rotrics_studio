import { convertFont } from '../core/font-converter.js';

// The compatibility helper is confined to this disposable conversion worker.
if (!Map.prototype.getOrInsert) Object.defineProperty(Map.prototype, 'getOrInsert', {
  value(key, value) { if (!this.has(key)) this.set(key, value); return this.get(key); },
});
self.onmessage = async ({ data }) => {
  try {
    const font = await convertFont(data.buffer, data.name, (progress) => self.postMessage(progress), data.text);
    self.postMessage({ stage: 'complete', font });
  } catch (error) { self.postMessage({ stage: 'error', message: error.message }); }
};
