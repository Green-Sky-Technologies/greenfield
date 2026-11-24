// Story 0.4 (c): load large files in host mode; time to ready / open / first render, memory, and
// frame times while panning and zooming. Usage:
//   node large.mjs gen [--sizes 10000,30000]           # write gen/gen-<n>.figcraft with the editor
//   node large.mjs run [browser=chromium-headed] [--files a,b] [--pan 5000]
// Writes out/large-<browser>.json.
import { writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { launch, openEditor, stats, generateDoc, stopServer, countNodes } from './lib.mjs';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const cmd = process.argv[2] ?? 'run';
const genDir = new URL('./gen/', import.meta.url);
const outDir = new URL('./out/', import.meta.url);
await mkdir(genDir, { recursive: true });
await mkdir(outDir, { recursive: true });

if (cmd === 'gen') {
  const { browser, page } = await launch('chromium-headless');
  const { frame } = await openEditor(page);
  for (const n of arg('sizes', '10000,30000').split(',').map(Number)) {
    await frame.evaluate(() => window.figcraft.execute('file.new', {}));
    const g = await generateDoc(frame, n, { chunk: 1000 });
    const b64 = await frame.evaluate(async () => (await window.figcraft.execute('file.saveAs', { data: true })).data);
    const buf = Buffer.from(b64, 'base64');
    await writeFile(new URL(`gen-${n}.figcraft`, genDir), buf);
    console.log(`gen-${n}.figcraft`, buf.length, 'bytes', Math.round(g.ms), 'ms to build');
  }
  await browser.close();
  stopServer();
  process.exit(0);
}

const name = process.argv[3] ?? 'chromium-headed';
const PAN_MS = Number(arg('pan', 5000));
const exDir = new URL('./figcraft/examples/', import.meta.url);
const examples = (await readdir(exDir)).filter((f) => f.endsWith('.figcraft'));
const gens = (await readdir(genDir)).filter((f) => f.endsWith('.figcraft'));
const all = [...examples.map((f) => ({ url: `/examples/${f}`, file: f, path: new URL(f, exDir) })), ...gens.map((f) => ({ url: `/gen/${f}`, file: f, path: new URL(f, genDir) }))];
const wanted = arg('files', '');
const files = wanted ? all.filter((f) => wanted.split(',').some((w) => f.file.includes(w))) : all;

const report = { browser: name, files: [] };
for (const f of files) {
  // A fresh browser per file so memory numbers are not cumulative.
  const { browser, context, page, version, cfg } = await launch(name);
  report.version = version;
  const logs = [];
  page.on('console', (m) => logs.push(m.text()));
  await context.addInitScript(() => {
    addEventListener('TrunkApplicationStarted', (e) => {
      window.__wasm = e.detail?.wasm;
    });
  });
  const cdp = cfg.type === 'chromium' ? await context.newCDPSession(page) : null;
  if (cdp) await cdp.send('Performance.enable');
  const mem = async (frame) => {
    const m = await frame.evaluate(async () => {
      const out = {};
      if (performance.memory) out.jsHeapUsedMB = +(performance.memory.usedJSHeapSize / 2 ** 20).toFixed(1);
      const wm = window.__wasm?.memory?.buffer?.byteLength;
      if (wm) out.wasmMemoryMB = +(wm / 2 ** 20).toFixed(1);
      if (performance.measureUserAgentSpecificMemory) {
        try {
          const r = await performance.measureUserAgentSpecificMemory();
          out.uaSpecificMB = +(r.bytes / 2 ** 20).toFixed(1);
        } catch (e) {
          out.uaSpecific = String(e.name);
        }
      } else out.uaSpecific = 'unavailable';
      out.crossOriginIsolated = self.crossOriginIsolated;
      return out;
    });
    if (cdp) {
      const { metrics } = await cdp.send('Performance.getMetrics');
      const g = (k) => metrics.find((x) => x.name === k)?.value;
      m.cdpJSHeapUsedMB = +(g('JSHeapUsedSize') / 2 ** 20).toFixed(1);
      m.cdpJSHeapTotalMB = +(g('JSHeapTotalSize') / 2 ** 20).toFixed(1);
    }
    return m;
  };
  const navStart = Date.now();
  const { frame, readyMs } = await openEditor(page);
  const wallReady = Date.now() - navStart;
  const memIdle = await mem(frame);
  await frame.evaluate(() => window.figcraft.uiInspect({}));
  const size = (await stat(f.path)).size;
  // Open through the host message and time: doc present, then first refined canvas.
  const timing = await page.evaluate(
    async ({ url, file }) => {
      const fr = document.getElementById('ed').contentWindow;
      const { sentAt } = await window.hostOpen(url, file);
      let docAt = null;
      let renderAt = null;
      let ui = null;
      const deadline = sentAt + 120_000;
      while (performance.now() < deadline) {
        const d = await fr.figcraft.docInspect({ depth: 0, fields: [] }).catch(() => null);
        if (d && d.pages?.length) {
          docAt ??= performance.now();
          ui = await fr.figcraft.uiInspect({});
          if (ui.canvas?.quality === 'refined' && ui.canvas?.refineLatencyMs != null) {
            renderAt = performance.now();
            break;
          }
        }
        await new Promise((r) => setTimeout(r, 25));
      }
      return { openToDocMs: docAt && docAt - sentAt, openToRefinedMs: renderAt && renderAt - sentAt, canvas: ui?.canvas, name: (await fr.figcraft.docInspect({ depth: 0, fields: [] })).name };
    },
    { url: f.url, file: f.file },
  );
  const inspect = await frame.evaluate(() => window.figcraft.docInspect({ depth: 64, fields: [], allPages: true }));
  const nodes = countNodes(inspect);
  const memOpen = await mem(frame);
  // Fit, then pan/zoom like a person for PAN_MS, recording rAF deltas in the editor frame and the
  // editor's own frame build times.
  await frame.evaluate(() => window.figcraft.execute('view.zoomFit', {}));
  await frame.evaluate(() => window.figcraft.request('ui.set', { resetFrameStats: true }));
  await page.mouse.move(800, 450);
  await frame.evaluate(() => {
    const r = (window.__raf = { on: true, deltas: [], last: performance.now() });
    const tick = (t) => {
      if (!r.on) return;
      r.deltas.push(t - r.last);
      r.last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const t = Date.now();
  let i = 0;
  while (Date.now() - t < PAN_MS) {
    if (i % 20 < 14) await page.mouse.wheel(i % 40 < 20 ? 40 : -40, 20);
    else {
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, i % 40 < 20 ? -25 : 25);
      await page.keyboard.up('Control');
    }
    i++;
    await new Promise((r) => setTimeout(r, 16));
  }
  const deltas = await frame.evaluate(() => {
    window.__raf.on = false;
    return window.__raf.deltas.slice(1);
  });
  const ui = await frame.evaluate(() => window.figcraft.uiInspect({}));
  const memPan = await mem(frame);
  // Thumbnail cost on this file: ui.render of the page at 0.25 and 1.
  const thumbs = {};
  for (const scale of [0.1, 0.25, 1]) {
    await frame.evaluate(() => window.figcraft.execute('select.none', {}));
    const r = await frame.evaluate(async (scale) => {
      const t = performance.now();
      try {
        const out = await window.figcraft.request('ui.render', { scale });
        return { ms: performance.now() - t, kb: Math.round((out.data.length * 0.75) / 1024) };
      } catch (e) {
        return { ms: performance.now() - t, error: String(e.message).split('\n')[0] };
      }
    }, scale);
    thumbs[`render@${scale}`] = r.error ? { ms: Math.round(r.ms), error: r.error } : { ms: Math.round(r.ms), kb: r.kb };
  }
  const shotPath = new URL(`large-${name}-${f.file.replace(/\.figcraft$/, '')}.png`, outDir);
  await page.screenshot({ path: shotPath.pathname });
  const s = stats(deltas);
  const row = {
    file: f.file,
    bytes: size,
    nodes,
    pages: inspect.pages?.length,
    readyMs: Math.round(readyMs),
    wallReadyMs: wallReady,
    ...timing,
    canvasAfterOpen: timing.canvas,
    memIdle,
    memOpen,
    memPan,
    pan: {
      frames: deltas.length,
      rafMs: s,
      over25ms: deltas.filter((d) => d > 25).length,
      over50ms: deltas.filter((d) => d > 50).length,
      editorFrameTimes: ui.frameTimes,
      framesDrawn: ui.framesDrawn,
      canvas: ui.canvas,
    },
    thumbs,
    backend: logs.find((l) => /wgpu backend/.test(l))?.replace(/.*backend /, '') ?? null,
  };
  report.files.push(row);
  console.log(
    name,
    f.file.padEnd(36),
    `${(size / 1024).toFixed(0)}KiB nodes=${nodes} ready=${row.readyMs}ms open->doc=${Math.round(timing.openToDocMs)}ms open->refined=${Math.round(timing.openToRefinedMs)}ms`,
    `heap=${memOpen.cdpJSHeapUsedMB ?? memOpen.jsHeapUsedMB ?? '-'}MB wasm=${memOpen.wasmMemoryMB ?? '-'}MB->${memPan.wasmMemoryMB ?? '-'}MB`,
    `raf p50=${s.p50} p95=${s.p95} max=${s.max} >25ms=${row.pan.over25ms}/${deltas.length} egui mean=${ui.frameTimes?.meanMs?.toFixed?.(1)} max=${ui.frameTimes?.maxMs?.toFixed?.(1)}`,
    `backend=${row.backend}`,
  );
  console.log('  thumbs', JSON.stringify(thumbs), 'memIdle', JSON.stringify(memIdle));
  await browser.close();
  await writeFile(new URL(`large-${name}.json`, outDir), JSON.stringify(report, null, 2));
}
stopServer();
