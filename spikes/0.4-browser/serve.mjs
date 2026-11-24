// Static server for the FigCraft web release (Story 0.4 spike).
// Serves spikes/0.4-browser/editor/figcraft-web-0.18.1 at /editor/ and spikes/0.4-browser/pages at /.
// Usage: node spikes/0.4-browser/serve.mjs [port=3104]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const roots = [
  ['/editor/', join(here, 'editor', 'figcraft-web-0.18.1')],
  ['/examples/', join(here, 'figcraft', 'examples')],
  ['/gen/', join(here, 'gen')],
  ['/', join(here, 'pages')],
];
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.figcraft': 'application/octet-stream',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

export function serve(port = 3104) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const path = decodeURIComponent(url.pathname);
    for (const [prefix, dir] of roots) {
      if (!path.startsWith(prefix)) continue;
      let rel = normalize(path.slice(prefix.length));
      if (rel.startsWith('..')) break;
      if (rel === '.' || rel === '' || rel.endsWith('/')) rel = join(rel, 'index.html');
      const file = join(dir, rel);
      try {
        const s = await stat(file);
        if (!s.isFile()) break;
        const body = await readFile(file);
        res.writeHead(200, {
          'content-type': types[extname(file)] ?? 'application/octet-stream',
          'cache-control': 'no-cache',
        });
        res.end(body);
        return;
      } catch {
        break;
      }
    }
    res.writeHead(404).end('not found');
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.argv[2] ?? 3104);
  await serve(port);
  console.log(`serving on http://127.0.0.1:${port}/ (editor at /editor/)`);
}
