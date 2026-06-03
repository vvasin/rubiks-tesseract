// Zero-dependency static file server for local dev and the Playwright harness.
// Serves the repo root; ES modules need correct Content-Type, which this sets.
//   node scripts/serve.js            → http://localhost:8791
//   PORT=9000 node scripts/serve.js
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = normalize(join(fileURLToPath(import.meta.url), '..', '..'));
const PORT = Number(process.env.PORT) || 8791;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (urlPath === '/') urlPath = '/index.html';
    const filePath = normalize(join(ROOT, urlPath));
    if (filePath !== ROOT && !filePath.startsWith(ROOT + sep)) {   // no path traversal
      res.writeHead(403); res.end('Forbidden'); return;
    }
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) {
    const code = e.code === 'ENOENT' ? 404 : 500;
    res.writeHead(code); res.end(code === 404 ? 'Not found' : 'Server error');
  }
});

server.listen(PORT, () => console.log(`serving ${ROOT} on http://localhost:${PORT}`));
