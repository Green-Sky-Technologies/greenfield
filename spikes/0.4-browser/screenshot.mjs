// Story 0.4 (a): figcraft.screenshot() vs alternatives, per browser and document size.
// Usage: node screenshot.mjs [--tries 10] [--browsers chromium-headless,firefox-headed,...]
//        [--scenarios nodoc,small,example,large,background] [--methods screenshot,render,...] [--extra webgl]
// Writes out/screenshot-<browser>.json and sample PNGs to out/.
import { writeFile, mkdir } from 'node:fs/promises';
import { launch, openEditor, timed, stats, generateDoc, stopServer, BROWSERS } from './lib.mjs';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const TRIES = Number(arg('tries', 10));
const browsers = arg('browsers', Object.keys(BROWSERS).join(',')).split(',');
const scenarios = arg('scenarios', 'nodoc,small,example,large').split(',');
const methods = arg('methods', 'screenshot,render,export,pwPage,pwCanvas,toDataURL').split(',');
const extra = arg('extra', '');
const LARGE = Number(arg('large', 5000));
const FAIL_FAST = 3; // stop a cell after this many consecutive timeouts (each costs ~30 s)
const outDir = new URL('./out/', import.meta.url);
await mkdir(outDir, { recursive: true });

/** Methods: each returns {png: base64} (or a Buffer for Playwright). */
const METHODS = {
  // ui.screenshot through window.figcraft (the whole window, UI included).
  screenshot: (frame) =>
    timed(frame, async () => {
      const r = await window.figcraft.screenshot({});
      return { b64: r.data, w: r.width, h: r.height };
    }),
  // ui.screenshot while nudging repaints: every window.figcraft call asks egui for a repaint
  // (api.rs send -> ctx.request_repaint), which stands in for the RequestPaintWhileHidden the web
  // runner ignores while the capture settles.
  screenshotNudge: (frame) =>
    timed(frame, async () => {
      let done = false;
      const p = window.figcraft.screenshot({}).finally(() => {
        done = true;
      });
      (async () => {
        while (!done) {
          await window.figcraft.request('window.list', {}).catch(() => {});
          await new Promise((r) => setTimeout(r, 16));
        }
      })();
      const r = await p;
      return { b64: r.data, w: r.width, h: r.height };
    }),
  // ui.render: the document without UI chrome (page top-level layers when nothing is selected).
  render: (frame) =>
    timed(frame, async () => {
      const r = await window.figcraft.request('ui.render', { scale: 1 });
      return { b64: r.data };
    }),
  // file.export png of the page.
  export: (frame) =>
    timed(frame, async () => {
      const r = await window.figcraft.execute('file.export', { format: 'png', scale: 1 });
      return { b64: r.data ?? r.files?.[0]?.data, keys: Object.keys(r) };
    }),
  // Playwright page screenshot (compositor capture of the viewport).
  pwPage: async (frame, page) => {
    const t = performance.now();
    try {
      const buf = await page.screenshot({ timeout: 30_000 });
      return { ok: true, ms: performance.now() - t, result: { b64: buf.toString('base64') } };
    } catch (e) {
      return { ok: false, ms: performance.now() - t, error: String(e.message).slice(0, 200) };
    }
  },
  // Playwright element screenshot of the editor's <canvas>.
  pwCanvas: async (frame) => {
    const t = performance.now();
    try {
      const buf = await frame.locator('#figcraft_canvas').screenshot({ timeout: 30_000 });
      return { ok: true, ms: performance.now() - t, result: { b64: buf.toString('base64') } };
    } catch (e) {
      return { ok: false, ms: performance.now() - t, error: String(e.message).slice(0, 200) };
    }
  },
  // canvas.toDataURL() from the page (no preserveDrawingBuffer: expect blank outside the frame).
  toDataURL: (frame) =>
    timed(frame, async () => {
      const url = document.getElementById('figcraft_canvas').toDataURL('image/png');
      return { b64: url.split(',')[1] };
    }),
};

/** Distinct-colour count over a sample grid, decoded in the page; 1 means blank. */
async function analyse(frame, b64) {
  if (!b64) return { distinct: 0 };
  return frame.evaluate(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = new OffscreenCanvas(img.width, img.height);
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, img.width, img.height).data;
    const seen = new Set();
    const step = Math.max(1, Math.floor((img.width * img.height) / 20000));
    let transparent = 0;
    let n = 0;
    for (let i = 0; i < img.width * img.height; i += step) {
      const o = i * 4;
      seen.add((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]);
      if (d[o + 3] === 0) transparent++;
      n++;
    }
    return { w: img.width, h: img.height, distinct: seen.size, transparentPct: Math.round((100 * transparent) / n) };
  }, b64);
}

async function setup(scenario, frame, page, context) {
  const ex = (c, p) => frame.evaluate(([c, p]) => window.figcraft.execute(c, p), [c, p]);
  if (scenario === 'nodoc') return {};
  if (scenario === 'small') {
    await ex('file.new', {});
    await generateDoc(frame, 24);
  } else if (scenario === 'example') {
    await page.evaluate(() => window.hostOpen('/examples/ridgeline-studio-dashboard.figcraft', 'ridgeline-studio-dashboard.figcraft'));
    await frame.evaluate(async () => {
      const end = performance.now() + 60_000;
      while (performance.now() < end) {
        const d = await window.figcraft.docInspect({ fields: [], depth: 0 });
        if (d?.name) return;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error('example did not open within 60 s');
    });
  } else if (scenario === 'large' || scenario === 'background') {
    await ex('file.new', {});
    await generateDoc(frame, scenario === 'large' ? LARGE : 500);
  }
  await ex('select.none', {});
  await ex('view.zoomFit', {});
  if (scenario === 'background') {
    // Another tab in front: the editor's tab is hidden, the browser pauses its rAF.
    const other = await context.newPage();
    await other.goto('about:blank');
    await other.bringToFront();
    return { other, vis: await page.evaluate(() => document.visibilityState) };
  }
  return { vis: await page.evaluate(() => document.visibilityState) };
}

for (const name of browsers) {
  const report = { browser: name, extra, tries: TRIES, cells: [] };
  let launched;
  try {
    launched = await launch(name);
  } catch (e) {
    console.log(name, 'launch failed', String(e.message).split('\n')[0]);
    report.launchError = String(e.message).split('\n')[0];
    await writeFile(new URL(`screenshot-${name}${extra ? '-' + extra : ''}${arg('tag', '') ? '-' + arg('tag', '') : ''}.json`, outDir), JSON.stringify(report, null, 2));
    continue;
  }
  const { browser, context, page, version } = launched;
  report.version = version;
  const logs = [];
  page.on('console', (m) => logs.push(m.text()));
  for (const scenario of scenarios) {
    const { frame, readyMs } = await openEditor(page, { extra });
    report.readyMs ??= readyMs;
    let env;
    try {
      env = await setup(scenario, frame, page, context);
    } catch (e) {
      console.log(name, scenario, 'setup failed', e.message);
      report.cells.push({ scenario, setupError: String(e.message).slice(0, 200) });
      continue;
    }
    for (const method of methods) {
      if (scenario === 'nodoc' && (method === 'render' || method === 'export')) continue;
      const runs = [];
      let consecutive = 0;
      let sample;
      for (let i = 0; i < TRIES; i++) {
        const r = await METHODS[method](frame, page);
        runs.push({ ok: r.ok, ms: r.ms, error: r.error });
        if (r.ok && !sample) sample = r.result?.b64;
        consecutive = r.ok ? 0 : consecutive + 1;
        if (consecutive >= FAIL_FAST && /timeout|Timeout/.test(r.error ?? '')) break;
      }
      let a = { distinct: 0 };
      try {
        a = await analyse(frame, sample);
      } catch (e) {
        a = { error: String(e.message).slice(0, 100) };
      }
      if (sample && ['nodoc', 'example', 'large'].includes(scenario)) {
        await writeFile(new URL(`shot-${name}-${scenario}-${method}.png`, outDir), Buffer.from(sample, 'base64'));
      }
      const ok = runs.filter((r) => r.ok);
      const cell = {
        scenario,
        method,
        visibility: env.vis,
        tries: runs.length,
        ok: ok.length,
        latency: stats(ok.map((r) => r.ms)),
        failMs: stats(runs.filter((r) => !r.ok).map((r) => r.ms)),
        errors: [...new Set(runs.filter((r) => !r.ok).map((r) => r.error))],
        image: a,
      };
      report.cells.push(cell);
      console.log(
        name.padEnd(18),
        scenario.padEnd(10),
        method.padEnd(10),
        `${cell.ok}/${cell.tries}`,
        `p50=${cell.latency.p50 ?? '-'} p95=${cell.latency.p95 ?? '-'}`,
        `img=${a.w ?? '-'}x${a.h ?? '-'} distinct=${a.distinct}`,
        cell.errors[0] ?? '',
      );
    }
    if (env.other) await env.other.close();
  }
  report.backend = logs.find((l) => /wgpu backend/.test(l)) ?? null;
  report.warnings = [...new Set(logs.filter((l) => /error|panic|Unhandled|timeout/i.test(l)).map((l) => l.slice(0, 160)))].slice(0, 10);
  await writeFile(new URL(`screenshot-${name}${extra ? '-' + extra : ''}${arg('tag', '') ? '-' + arg('tag', '') : ''}.json`, outDir), JSON.stringify(report, null, 2));
  await browser.close();
}
stopServer();
