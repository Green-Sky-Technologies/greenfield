// Stories 2.1 and 2.2 evidence: the editor in Greenfield's dark and light themes, with a small
// sample design (a frame with text, a rectangle, the rectangle selected), and the loading screen.
//
// Usage: node shoot-brand.mjs <out-dir> [baseUrl]
//   Expects a static server at baseUrl (default http://127.0.0.1:3103) serving /editor/: the built
//   site copied into apps/web/public/editor/, served by `pnpm --filter @greenfield/bridge serve`.
//   Writes <out-dir>/editor-dark.png, editor-light.png, loading.png.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const { chromium } = createRequire(join(repo, 'apps/web/package.json'))('@playwright/test');

const out = process.argv[2];
if (!out) throw new Error('usage: shoot-brand.mjs <out-dir> [baseUrl]');
const base = process.argv[3] ?? 'http://127.0.0.1:3103';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  // Headless Chromium has no WebGPU; ?webgl forces WebGL2 (SwiftShader).
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const logs = [];
  page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
  // The loading screen: hold the wasm back so the page stays on it.
  await page.route('**/*.wasm', async (route) => {
    await new Promise((r) => setTimeout(r, 4000));
    await route.continue();
  });
  const loaded = page.goto(`${base}/editor/index.html?control&webgl`);
  await page.waitForSelector('#figcraft_loading', { state: 'attached' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(out, 'loading.png') });
  await loaded;
  await page.waitForFunction(() => typeof window.figcraft?.execute === 'function', null, { timeout: 120_000 });
  await page.unroute('**/*.wasm');

  const draw = () =>
    page.evaluate(async () => {
      const fc = window.figcraft;
      await fc.execute('file.new', {});
      const frame = await fc.execute('node.create', { type: 'frame', name: 'Marketing site', x: 0, y: 0, width: 600, height: 540, props: { fill: '#F5F3EC' } });
      const text = await fc.execute('node.create', { type: 'text', name: 'Headline', parent: frame.id, x: 40, y: 60, props: { text: 'No AI judge sits until it has been examined.', fontSize: 40, fill: '#14150F' } });
      const rect = await fc.execute('node.create', { type: 'rectangle', name: 'Button', parent: frame.id, x: 40, y: 360, width: 166, height: 50, props: { fill: '#14150F' } });
      await fc.execute('select.set', { ids: [rect.id] });
      await fc.execute('view.zoomSelection', {});
      return { frame: frame.id, text: text.id, rect: rect.id };
    });
  const ids = await draw();
  for (const theme of ['dark', 'light']) {
    await page.evaluate((t) => window.figcraft.execute(t === 'dark' ? 'view.themeDark' : 'view.themeLight', {}), theme);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(out, `editor-${theme}.png`) });
  }
  console.log(JSON.stringify({ ids, title: await page.title(), consoleTail: logs.slice(-5) }, null, 2));
} finally {
  await browser.close();
}
