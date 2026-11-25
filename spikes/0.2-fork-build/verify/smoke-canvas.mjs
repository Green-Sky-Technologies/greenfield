// Canvas-mode smoke check on a built site (Stories 2.11, 2.12, 2.4): the real wasm in headless
// Chromium, framed by verify/host.html as the app frames it. What the Rust tests cannot show:
// the page's messages arrive, the canvas repaints on every preview, the panels come back.
//
// Usage: node smoke-canvas.mjs <dist-dir> <out-dir>      (a section runs when the build has its commands)
// Playwright comes from apps/web's dev dependencies (pnpm install at the repo root).
import { createRequire } from 'node:module';
import { createReadStream, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const { chromium } = createRequire(join(repo, 'apps/web/package.json'))('@playwright/test');
const [dist, out] = [process.argv[2], process.argv[3]];
if (!dist || !out) throw new Error('usage: smoke-canvas.mjs <dist-dir> <out-dir>');
mkdirSync(out, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.css': 'text/css', '.json': 'application/json' };
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  const file = path === '/host.html' ? join(here, 'host.html') : join(dist, normalize(path.replace(/^\/editor\//, '/')));
  try {
    if (!statSync(file).isFile()) throw new Error('not a file');
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const results = {};
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const logs = [];
  page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
  await page.goto(`${base}/host.html?webgl&canvas`);
  const frame = await (await page.waitForSelector('#editor')).contentFrame();
  await frame.waitForFunction(() => typeof window.figcraft?.execute === 'function', null, { timeout: 120_000 });
  const run = (cmd, params = {}) => frame.evaluate(([c, p]) => window.figcraft.execute(c, p), [cmd, params]);
  const as = (agent, cmd, params = {}) => frame.evaluate(([a, c, p]) => window.figcraft.executeAs(a, c, p), [agent, cmd, params]);
  const ui = () => frame.evaluate(() => window.figcraft.request('ui.inspect', {}));
  const doc = () => frame.evaluate(() => window.figcraft.inspect());
  const frames = (n = 4) => frame.evaluate((k) => new Promise((r) => { let i = 0; const t = () => (++i >= k ? r(i) : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);
  const messages = () => page.evaluate(() => window.hostMessages.splice(0));
  const shot = (name) => page.screenshot({ path: join(out, `${name}.png`) });
  const has = new Set((await frame.evaluate(() => window.figcraft.commands())).map((c) => c.id));
  const px = async () => (await page.screenshot()).toString('base64');

  // 2.11 -----------------------------------------------------------------------------------------
  if (has.has('view.canvasMode')) {
    const s = (results.canvasMode = {});
    await frames(10);
    s.startedInCanvasMode = (await ui()).canvasMode === true;
    await shot('canvas-mode-empty');
    await run('file.new');
    const rect = (await run('node.create', { type: 'rectangle', x: 0, y: 0, width: 240, height: 140, props: { fill: '#3FD67F' } })).id;
    await run('select.set', { ids: [rect] });
    await run('view.zoomSelection');
    await frames(8);
    await shot('canvas-mode-on');
    // Right-click on the rectangle (the middle of the canvas).
    await messages();
    await page.mouse.click(640, 416, { button: 'right' });
    await frames(4);
    s.rightClick = (await messages()).filter((m) => m.name === 'ui.request');
    // The Comment tool's click goes to the host too (control calls never open dialogs, so a menu
    // command's dialog is not checked here; the Rust tests cover it).
    await run('tool.comment');
    await frames(2);
    await page.mouse.click(300, 232);
    await frames(3);
    s.commentClick = (await messages()).filter((m) => m.name === 'ui.request');
    await run('tool.move');
    await run('view.canvasMode', { on: false });
    await frames(8);
    await shot('canvas-mode-off');
    s.offMessages = (await messages()).map((m) => m.name);
    await run('view.canvasMode', { on: true });
    await frames(6);
    s.backOn = (await messages()).map((m) => m.name);
    s.rect = rect;
  }

  // 2.12 -----------------------------------------------------------------------------------------
  if (has.has('edit.begin') && results.canvasMode) {
    const s = (results.gesture = {});
    const rect = results.canvasMode.rect;
    const xOf = async () => (await frame.evaluate((id) => window.figcraft.request('node.get', { id }), rect)).x;
    const undoDepth = async () => (await doc()).history.undoDepth;
    const before = await px();
    const depth0 = await undoDepth();
    await run('edit.begin', { label: 'Scrub X' });
    const seen = [];
    for (const x of [20, 60, 100, 140]) {
      await run('edit.preview', { commands: [{ command: 'node.set', params: { id: rect, x } }] });
      await frames(3);
      seen.push({ x: await xOf(), depth: await undoDepth(), pixels: await px() });
    }
    await shot('gesture-preview');
    s.xs = seen.map((o) => o.x);
    s.depthDuringScrub = [...new Set(seen.map((o) => o.depth))];
    s.canvasRepaintedEachStep = new Set([before, ...seen.map((o) => o.pixels)]).size === seen.length + 1;
    s.commit = await run('edit.commit');
    s.depthAfterCommit = await undoDepth();
    s.depthBefore = depth0;
    await run('edit.begin');
    await run('edit.preview', { commands: [{ command: 'node.set', params: { id: rect, x: 300 } }] });
    await run('edit.cancel');
    s.xAfterCancel = await xOf();
  }

  // 2.4 ------------------------------------------------------------------------------------------
  if (has.has('agent.presence') && results.canvasMode) {
    const s = (results.presence = {});
    await messages();
    await run('agent.presence', { name: 'Claude', active: true });
    await as('Claude', 'node.set', { id: results.canvasMode.rect, props: { fill: '#FF9A4D' } });
    await frames(6);
    await shot('presence-held');
    s.whileHeld = (await messages()).filter((m) => m.name === 'agent.presence').map((m) => m.data);
    await run('agent.presence', { name: 'Claude', active: false });
    await frames(2);
    s.released = (await messages()).filter((m) => m.name === 'agent.presence').map((m) => m.data);
    await new Promise((r) => setTimeout(r, 9000));
    await frames(4);
    s.afterLinger = (await messages()).filter((m) => m.name === 'agent.presence').map((m) => m.data);
  }
  results.errors = logs.filter((l) => /^(error|warning): /.test(l) && !/WebGL|GPU|swiftshader/i.test(l)).slice(0, 10);
} finally {
  await browser.close();
  server.close();
}
writeFileSync(join(out, 'smoke-canvas.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
