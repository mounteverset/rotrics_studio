const { spawnSync } = require('node:child_process');
const path = require('node:path');
// flo-mat's current dependencies require Map.getOrInsert, available in bundled Electron's Node 24.
const result = spawnSync(require('electron'), [path.join(__dirname, 'centerline-font.mjs'), ...process.argv.slice(2)], {
  stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 60000,
});
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
