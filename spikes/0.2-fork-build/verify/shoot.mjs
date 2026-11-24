// Story 0.2 evidence: load a built figcraft-web, draw a frame, select it, capture pixels.
//
// Usage: node shoot.mjs <label> [baseUrl]
//   Expects a static server at baseUrl (default http://127.0.0.1:3102) serving
//   /editor/ (the dist) and /host.html (verify/host.html). Writes out/<label>-*.png.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
// Playwright comes from apps/web's dev dependencies (pnpm install at the repo root).
const { chromium } = createRequire(join(repo, 'apps/web/package.json'))('@playwright/test');

const label = process.argv[2] ?? 'shot';
const base = process.argv[3] ?? 'http://127.0.0.1:3102';
const out = join(here, '..', 'out');
mkdirSync(out, { recursive: true });

// Draw a frame and select it through the command API, inside the given frame (page or iframe).
async function drawAndSelect(target) {
  await target.waitForFunction(() => typeof window.figcraft?.execute === 'function', null, { timeout: 120_000 });
  return target.evaluate(async () => {
    const fc = window.figcraft;
    const cmds = await fc.commands();
    const list = Array.isArray(cmds) ? cmds : (cmds.commands ?? []);
    const names = list.map((c) => (typeof c === 'string' ? c : c.name ?? c.id));
    await fc.execute('file.new', {});
    const created = await fc.execute('node.create', {
      type: 'frame', name: 'Spike frame', x: 0, y: 0, width: 320, height: 200, props: { fill: '#FFFFFF' },
    });
    const id = created.id;
    const selectCmd = names.includes('selection.set') ? 'selection.set' : names.find((n) => /^select(ion)?\./.test(n));
    await fc.execute(selectCmd, { ids: [id] });
    if (names.includes('view.zoomSelection')) await fc.execute('view.zoomSelection', {});
    const doc = await fc.docInspect({});
    return {
      id, selectCmd,
      selection: doc.selection,
      
      commandCount: names.length,
    };
  });
}

const browser = await chromium.launch({
  // Headless Chromium has no WebGPU; ?webgl forces WebGL2 (SwiftShader).
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const results = {};
try {
  // 1. The editor on its own.
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const logs = [];
  page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
  const t0 = Date.now();
  await page.goto(`${base}/editor/index.html?control&webgl`);
  results.direct = await drawAndSelect(page);
  results.direct.loadMs = Date.now() - t0;
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(out, `${label}-editor.png`) });
  // ui.render of the frame for comparison (document pixels only, no selection chrome).
  const render = await page.evaluate(async (id) => {
    try {
      const r = await window.figcraft.request('ui.render', { ids: [id], scale: 1 });
      return { keys: Object.keys(r ?? {}), data: r?.data ?? r?.png ?? null };
    } catch (e) {
      return { error: String(e) };
    }
  }, results.direct.id);
  if (render.data) writeFileSync(join(out, `${label}-ui-render.png`), Buffer.from(render.data, 'base64'));
  results.direct.uiRender = render.error ?? render.keys;
  results.direct.consoleTail = logs.slice(-8);
  await page.close();

  // 2. Embedded: same-origin host page, editor in an iframe with ?host=parent&control&author=.
  const host = await browser.newPage({ viewport: { width: 1280, height: 832 } });
  await host.goto(`${base}/host.html?webgl`);
  const el = await host.waitForSelector('#editor');
  const frame = await el.contentFrame();
  results.embedded = await drawAndSelect(frame);
  await host.waitForTimeout(1500);
  results.embedded.hostEvents = await host.evaluate(() => window.hostEvents);
  await host.screenshot({ path: join(out, `${label}-embedded.png`) });
  await host.close();
} finally {
  await browser.close();
}
writeFileSync(join(out, `${label}-result.json`), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
