export class SimulatedTransport {
  constructor({ delay = 180 } = {}) {
    this.delay = delay;
    this.position = { x: 0, y: 300, z: 0 };
    this.closed = false;
  }

  write(command) {
    if (this.closed) throw new Error('Simulator is disconnected');
    const code = command.trim();
    if (code === 'M1112') this.position = { x: 0, y: 300, z: 0 };
    else if (/^G1\s/.test(code)) {
      for (const axis of ['x', 'y', 'z']) {
        const value = code.match(new RegExp(`${axis.toUpperCase()}(-?\\d+(?:\\.\\d+)?)`));
        if (value) this.position[axis] = Number(value[1]);
      }
    } else if (!['M114', 'M400', 'G21', 'G90'].includes(code)) {
      this.timer = setTimeout(() => this.onData?.('error: Unsupported simulated command\n'), this.delay);
      return;
    }
    // shortcut: acknowledgements follow simulated completion; verify real firmware buffering before hardware support.
    this.timer = setTimeout(() => {
      const { x, y, z } = this.position;
      this.onData?.(`X:${x.toFixed(2)} Y:${y.toFixed(2)} Z:${z.toFixed(2)}\n`);
      this.onData?.('ok\n');
    }, this.delay);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timer);
    this.onClose?.();
  }
}
