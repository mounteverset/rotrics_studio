import test from 'node:test';
import assert from 'node:assert/strict';
import { SerialSession } from '../src/protocol/session.js';

function fixture(options) {
  const writes = [];
  const transport = { write: (line) => writes.push(line), close() {} };
  const session = new SerialSession(transport, options);
  return { transport, session, writes };
}

test('serializes commands and accepts fragmented acknowledgements alongside telemetry', async () => {
  const { transport, session, writes } = fixture();
  const first = session.send('G1 X1.25');
  const second = session.send('M114');
  assert.deepEqual(writes, ['G1 X1.25\n']);
  transport.onData('X:1.25 Y:300 Z:0\nok');
  assert.equal(writes.length, 1);
  transport.onData('\r\n');
  await first;
  await Promise.resolve();
  assert.deepEqual(writes, ['G1 X1.25\n', 'M114\n']);
  transport.onData('ok\n');
  await second;
  session.close();
});

test('a log line containing ok does not acknowledge motion', async () => {
  const { transport, session } = fixture();
  let resolved = false;
  const command = session.send('M114').then(() => { resolved = true; });
  transport.onData('echo: looks ok\n');
  await Promise.resolve();
  assert.equal(resolved, false);
  transport.onData('ok\n');
  await command;
  session.close();
});

test('timeout rejects all queued work and never retries a possibly executed move', async () => {
  const { session, writes } = fixture({ timeout: 10 });
  const first = assert.rejects(session.send('G1 X10'), /timed out/);
  const second = assert.rejects(session.send('G1 X20'), /timed out/);
  await Promise.all([first, second]);
  assert.deepEqual(writes, ['G1 X10\n']);
  await assert.rejects(session.send('M114'), /closed/);
});

test('disconnect and firmware errors reject pending and queued commands', async () => {
  for (const reason of ['disconnect', 'firmware']) {
    const { session, transport, writes } = fixture();
    const first = assert.rejects(session.send('G1 X10'), /Connection lost|error:/);
    const second = assert.rejects(session.send('G1 X20'), /Connection lost|error:/);
    if (reason === 'disconnect') transport.onClose();
    else transport.onData('error: Motion rejected\n');
    await Promise.all([first, second]);
    assert.equal(writes.length, 1);
  }
});

test('rejects multiline commands and oversized device messages', async () => {
  const { session, transport } = fixture();
  await assert.rejects(session.send('M114\nG1 X10'), /one G-code/);
  const pending = assert.rejects(session.send('M114'), /exceeded/);
  transport.onData('x'.repeat(4097));
  await pending;
});

test('coalesced lines do not acknowledge a command that has not been sent', async () => {
  const { session, transport, writes } = fixture();
  const first = session.send('M114');
  let secondDone = false;
  const second = session.send('M400').then(() => { secondDone = true; });
  transport.onData('ok\nok\n');
  await first;
  await Promise.resolve();
  assert.equal(writes.length, 2);
  assert.equal(secondDone, false);
  transport.onData('ok\n');
  await second;
  session.close();
});
