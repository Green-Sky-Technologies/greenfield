// Story 7.2 fidelity check: build FigCraft's `inspect.code {language: tailwind}` output with
// Tailwind v4 + React 19, render it in Chromium, and diff it against the editor's own PNG.
//   node render.mjs <samples dir> <worktree>
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const [samples, wt] = process.argv.slice(2);
const out = path.resolve(samples, '..', 'render');
fs.mkdirSync(out, { recursive: true });
const fromWeb = createRequire(path.join(wt, 'apps/web/package.json'));
const fromBridge = createRequire(path.join(wt, 'packages/bridge/package.json'));
const fromTw = createRequire(
  path.join(wt, 'node_modules/.pnpm/@tailwindcss+turbopack@4.3.4/node_modules/@tailwindcss/turbopack/package.json'),
);
const esbuild = fromBridge('esbuild');
const { compile } = fromTw('@tailwindcss/node');
const { Scanner } = createRequire(fromTw.resolve('@tailwindcss/node'))('@tailwindcss/oxide');
const { chromium } = fromWeb('@playwright/test');

// 1. JS bundle: each sample component, mounted side by side.
const entry = path.join(out, 'entry.jsx');
fs.writeFileSync(
  entry,
  `import { createRoot } from 'react-dom/client';
import { HomeLight } from ${JSON.stringify(path.join(samples, 'frame.tailwind.jsx'))};
import { HomeDark } from ${JSON.stringify(path.join(samples, 'frame-dark.tailwind.jsx'))};
createRoot(document.getElementById('root')).render(
  <div style={{ display: 'flex', gap: 40, alignItems: 'flex-start' }}>
    <div id="light"><HomeLight /></div>
    <div id="dark"><HomeDark /></div>
    <div id="dark-themed" data-theme="Dark"><HomeDark /></div>
  </div>,
);`,
);
await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  outfile: path.join(out, 'bundle.js'),
  jsx: 'automatic',
  loader: { '.jsx': 'jsx' },
  nodePaths: [path.join(wt, 'apps/web/node_modules')],
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'error',
});

// 2. CSS: the exported theme (it imports tailwindcss) + the classes the samples use.
const themeCss = fs.readFileSync(path.join(samples, 'theme.tailwind.css'), 'utf8');
const compiler = await compile(themeCss, { base: path.join(wt, 'apps/web'), onDependency() {} });
const scanner = new Scanner({ sources: [{ base: samples, pattern: '**/*.tailwind.jsx', negated: false }] });
const css = compiler.build(scanner.scan());
fs.writeFileSync(path.join(out, 'styles.css'), css);
fs.writeFileSync(
  path.join(out, 'index.html'),
  `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="styles.css"><body style="margin:0;background:#fff"><div id="root"></div><script src="bundle.js"></script>`,
);

// 3. Render, screenshot each frame, and diff against the editor's PNG in the page.
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
await page.goto('file://' + path.join(out, 'index.html'));
await page.waitForSelector('#light > div');
const result = {};
for (const [id, ref] of [
  ['light', 'editor-light.png'],
  ['dark', 'editor-dark.png'],
  ['dark-themed', 'editor-dark.png'],
]) {
  const shot = await page.locator(`#${id} > div`).screenshot({ path: path.join(out, `${id}.png`) });
  const refB64 = fs.readFileSync(path.resolve(samples, '..', ref)).toString('base64');
  result[id] = await page.evaluate(
    async ([a, b]) => {
      const load = (b64) =>
        new Promise((res) => {
          const i = new Image();
          i.onload = () => res(i);
          i.src = 'data:image/png;base64,' + b64;
        });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const w = Math.min(ia.width, ib.width);
      const h = Math.min(ia.height, ib.height);
      const px = (img) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        return g.getImageData(0, 0, w, h).data;
      };
      const da = px(ia);
      const db = px(ib);
      let diff = 0;
      for (let i = 0; i < da.length; i += 4) {
        const d = Math.max(
          Math.abs(da[i] - db[i]),
          Math.abs(da[i + 1] - db[i + 1]),
          Math.abs(da[i + 2] - db[i + 2]),
        );
        if (d > 48) diff++;
      }
      return {
        size: `${ia.width}x${ia.height} vs editor ${ib.width}x${ib.height}`,
        differingPixels: `${((100 * diff) / (w * h)).toFixed(1)}%`,
      };
    },
    [shot.toString('base64'), refB64],
  );
}
await browser.close();
console.log(JSON.stringify(result, null, 2));
console.log(`css ${css.length} B`);
