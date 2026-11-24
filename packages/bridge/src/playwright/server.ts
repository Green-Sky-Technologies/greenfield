/**
 * A tiny static server for driving the real editor without the Next.js app:
 *
 * - `/editor/*`          the pinned FigCraft web release (`apps/web/public/editor`, fetched by
 *                        `node spikes/0.1-embed/fetch-editor.mjs`)
 * - `/__bridge/host.html` a host page that embeds the editor through `createBridge` and exposes it
 *                        as `window.__greenfieldBridge` (see `host-entry.ts`)
 * - `/__bridge/host.js`   that page's script, bundled from TS source with esbuild on first request
 *
 * Node only (used by the Playwright config, the command-type generator and other lanes' suites).
 */
import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
/** `apps/web/public/editor` in this repository. */
export const DEFAULT_EDITOR_DIR = resolve(here, '../../../../apps/web/public/editor');
/** The port the bridge's own suites use. */
export const DEFAULT_PORT = 3103;

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff2': 'font/woff2',
};

const HOST_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Bridge host</title>
<style>html,body{margin:0;height:100%}iframe{border:0;width:100%;height:100%;display:block}</style>
</head>
<body>
<iframe id="editor" title="Editor" allow="clipboard-read; clipboard-write"></iframe>
<script type="module" src="/__bridge/host.js"></script>
</body>
</html>
`;

let bundle: Promise<string> | undefined;

/** The host page's script: `host-entry.ts` and the bridge, bundled for the browser. */
export function buildHostScript(): Promise<string> {
  bundle ??= (async () => {
    const { build } = await import('esbuild');
    const out = await build({
      entryPoints: [join(here, 'host-entry.ts')],
      bundle: true,
      format: 'esm',
      target: 'es2022',
      write: false,
      sourcemap: 'inline',
      logLevel: 'error',
    });
    return out.outputFiles[0]!.text;
  })();
  bundle.catch(() => (bundle = undefined));
  return bundle;
}

export interface HostServerOptions {
  port?: number;
  host?: string;
  editorDir?: string;
}

export interface HostServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

/** The pinned editor's stamp (`<version> <sha256>`), or null when it hasn't been fetched. */
export function editorStamp(editorDir = DEFAULT_EDITOR_DIR): string | null {
  const stamp = join(editorDir, '.figcraft-version');
  return existsSync(stamp) ? readFileSync(stamp, 'utf8').trim() : null;
}

export async function startHostServer(opts: HostServerOptions = {}): Promise<HostServer> {
  const editorDir = resolve(opts.editorDir ?? DEFAULT_EDITOR_DIR);
  if (!existsSync(join(editorDir, 'index.html'))) {
    throw new Error(
      `No editor in ${editorDir}. Run \`node spikes/0.1-embed/fetch-editor.mjs\` from the repo root.`,
    );
  }
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const send = (status: number, body: string | Buffer, type = 'text/plain; charset=utf-8') => {
      res.writeHead(status, {
        'content-type': type,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      });
      res.end(body);
    };
    if (url.pathname === '/__bridge/host.html') return send(200, HOST_HTML, TYPES['.html']);
    if (url.pathname === '/__bridge/host.js') {
      buildHostScript().then(
        (js) => send(200, js, TYPES['.js']),
        (e: unknown) => send(500, String(e)),
      );
      return;
    }
    if (url.pathname === '/editor' || url.pathname === '/editor/') {
      res.writeHead(302, { location: '/editor/index.html' + url.search });
      return res.end();
    }
    if (!url.pathname.startsWith('/editor/')) return send(404, 'not found');
    const rel = normalize(decodeURIComponent(url.pathname.slice('/editor/'.length)));
    const file = join(editorDir, rel);
    if (!file.startsWith(editorDir + sep) || !existsSync(file) || !statSync(file).isFile()) {
      return send(404, 'not found');
    }
    send(200, readFileSync(file), TYPES[extname(file)] ?? 'application/octet-stream');
  });
  const host = opts.host ?? '127.0.0.1';
  await new Promise<void>((ok, fail) => {
    server.once('error', fail);
    server.listen(opts.port ?? DEFAULT_PORT, host, () => ok());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : (opts.port ?? 0);
  return {
    url: `http://${host}:${port}`,
    port,
    close: () => new Promise((ok) => server.close(() => ok())),
  };
}
