import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';

const root = fileURLToPath(new URL('../src/', import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' };
const vendor = new Map(['opentype.js/dist/opentype.mjs', 'flo-mat/browser/index.min.js'].map((name) => [`/node_modules/${name}`, resolve(root, '../node_modules', name)]));
createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/') {
      response.writeHead(302, { Location: '/renderer/index.html' }).end();
      return;
    }
    const file = vendor.get(pathname) || resolve(root, `.${pathname}`);
    if ((!vendor.has(pathname) && !file.startsWith(root.endsWith(sep) ? root : root + sep)) || !types[extname(file)]) {
      response.writeHead(404).end('Not found');
      return;
    }
    const body = await readFile(file);
    response.writeHead(200, { 'Content-Type': types[extname(file)], 'Cache-Control': 'no-store' }).end(body);
  } catch {
    response.writeHead(404).end('Not found');
  }
}).listen(4173, '127.0.0.1', () => console.log('DexArm Studio: http://127.0.0.1:4173'));
