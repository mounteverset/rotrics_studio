export class SimulatedTransport {
  constructor({ delay = 180 } = {}) {
    this.delay = delay;
    this.position = { x: 0, y: 300, z: 0 };
    this.closed = false;
    this.pump = 'off';
    this.module = 0;
  }

  write(command) {
    if (this.closed) throw new Error('Simulator is disconnected');
    const code = command.trim();
    if (code === 'M1112') this.position = { x: 0, y: 300, z: 0 };
    else if (/^G1\s/.test(code)) {
      for (const axis of ['x', 'y', 'z']) {
        const value = code.match(new RegExp(`${axis.toUpperCase()}([-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+))`));
        if (value) this.position[axis] = Number(value[1]);
      }
    } else if (/^M100[0-3]$/.test(code)) this.pump = { M1000: 'pump in', M1001: 'pump out', M1002: 'neutral', M1003: 'off' }[code];
    else if (/^M888 P[02]$/.test(code)) this.module = Number(code.at(-1));
    else if (/^G4 P(?:\d+(?:\.\d+)?)$/.test(code) && Number(code.slice(4)) <= 2000) { /* acknowledged after the dwell below */ }
    else if (!['M114', 'M400', 'G21', 'G90'].includes(code)) {
      this.timer = setTimeout(() => this.onData?.('error: Unsupported simulated command\n'), this.delay);
      return;
    }
    // shortcut: acknowledgements follow simulated completion; verify real firmware buffering before hardware support.
    this.timer = setTimeout(() => {
      const { x, y, z } = this.position;
      this.onData?.(`X:${x.toFixed(2)} Y:${y.toFixed(2)} Z:${z.toFixed(2)}\n`);
      this.onData?.('ok\n');
    }, this.delay + (/^G4 P/.test(code) ? Number(code.slice(4)) : 0));
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timer);
    this.onClose?.();
  }
}
