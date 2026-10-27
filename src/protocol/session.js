// One connection owns all commands; a timeout invalidates it instead of retrying motion.
export class SerialSession {
  constructor(transport, { timeout = 3000, onLine = () => {}, onFault = () => {} } = {}) {
    this.transport = transport;
    this.timeout = timeout;
    this.onLine = onLine;
    this.onFault = onFault;
    this.queue = [];
    this.pending = null;
    this.buffer = '';
    this.closed = false;
    transport.onData = (chunk) => this.receive(chunk);
    transport.onClose = () => this.close(new Error('Connection lost'));
  }

  send(command) {
    if (this.closed) return Promise.reject(new Error('Connection is closed'));
    if (typeof command !== 'string' || !command.trim() || /[\r\n]/.test(command) || command.length > 128) {
      return Promise.reject(new Error('Expected one G-code command, at most 128 characters'));
    }
    if (this.queue.length >= 200) return Promise.reject(new Error('Command queue is full'));
    return new Promise((resolve, reject) => {
      this.queue.push({ command, resolve, reject });
      this.advance();
    });
  }

  advance() {
    if (this.closed || this.pending || !this.queue.length) return;
    const entry = this.queue.shift();
    this.pending = entry;
    entry.timer = setTimeout(() => this.close(new Error('Command timed out; execution state is unknown. Reconnect before continuing.')), this.timeout);
    this.onLine('send', entry.command);
    try {
      this.transport.write(`${entry.command}\n`);
    } catch (error) {
      this.close(error);
    }
  }

  receive(chunk) {
    if (this.closed) return;
    this.buffer += chunk;
    let end;
    while ((end = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, end).trim();
      this.buffer = this.buffer.slice(end + 1);
      if (line.length > 4096) return this.close(new Error('Device response exceeded 4096 characters'));
      if (!line) continue;
      this.onLine('receive', line);
      if (/^error:/i.test(line)) return this.close(new Error(line));
      if (/^ok(?:\s|$)/i.test(line) && this.pending) {
        const entry = this.pending;
        clearTimeout(entry.timer);
        this.pending = null;
        entry.resolve();
        // Process the entire received chunk before transmitting another command.
        queueMicrotask(() => this.advance());
      }
    }
    if (this.buffer.length > 4096) this.close(new Error('Device response exceeded 4096 characters'));
  }

  close(error = new Error('Disconnected')) {
    if (this.closed) return;
    this.closed = true;
    const entries = this.pending ? [this.pending, ...this.queue] : this.queue;
    this.pending = null;
    this.queue = [];
    this.buffer = '';
    for (const entry of entries) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.transport.close();
    this.onFault(error);
  }
}
