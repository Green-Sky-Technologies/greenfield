// Story 0.4 (b): cost of polling document.inspect vs document size, correctness of the diff, and the
// effect of polling on frame times. Usage:
//   node measure-change.mjs [browser=chromium-headed] [--sizes 100,1000,5000,10000] [--reps 10]
// Writes out/change-<browser>.json.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { launch, openEditor, stats, generateDoc, stopServer } from './lib.mjs';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const name = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'chromium-headed';
const sizes = arg('sizes', '100,1000,5000,10000').split(',').map(Number);
const REPS = Number(arg('reps', 10));
const ONLY = arg('only', 'cost,correctness,frames').split(',');
const outDir = new URL('./out/', import.meta.url);
await mkdir(outDir, { recursive: true });

// change-detect.ts -> a script that sets window.CD (TypeScript from the repo root).
const ts = createRequire(new URL('../../package.json', import.meta.url))('typescript');
const src = await readFile(new URL('./change-detect.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const inject = `(() => { const exports = {}; ${js}; window.CD = exports; })();`;

const { browser, page, version } = await launch(name);
const logs = [];
page.on('console', (m) => logs.push(m.text()));
const report = { browser: name, version, sizes: [], correctness: null, frames: [] };

/** In-frame helpers: a rAF recorder and a timed inspect that also records the longest frame gap. */
const frameHelpers = `
window.__raf = { on: false, deltas: [], last: 0 };
window.__rafStart = () => { const r = window.__raf; r.on = true; r.deltas = []; r.last = performance.now();
  const tick = (t) => { if (!r.on) return; r.deltas.push(t - r.last); r.last = t; requestAnimationFrame(tick); }; requestAnimationFrame(tick); };
window.__rafStop = () => { window.__raf.on = false; return window.__raf.deltas; };
window.__timedInspect = async (params) => {
  // Longest task: wall time of the call, and the gap between rAF ticks while it ran.
  let gap = 0, last = performance.now(), on = true;
  const tick = (t) => { if (!on) return; gap = Math.max(gap, t - last); last = t; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  const t = performance.now();
  const r = await window.figcraft.docInspect(params);
  const ms = performance.now() - t;
  const s = JSON.stringify(r);
  on = false;
  return { ms, bytes: s.length, maxGap: gap, nodes: (s.match(/"id":/g) || []).length };
};
`;

async function freshDoc(frame) {
  await frame.evaluate(() => window.figcraft.execute('file.new', {}));
}

let { frame } = await openEditor(page);
await frame.evaluate(frameHelpers + inject);

// 1. Cost per poll vs document size.
for (const n of ONLY.includes('cost') ? sizes : []) {
  await freshDoc(frame);
  const gen = await generateDoc(frame, n);
  await frame.evaluate(() => window.figcraft.execute('select.none', {}));
  await frame.evaluate(() => window.figcraft.execute('view.zoomFit', {}));
  const variants = {
    gate: { depth: 0, fields: [] },
    idsOnly: { depth: 64, fields: [] },
    outline: { depth: 64, outline: true },
    diffFields: { depth: 64, fields: ['name', 'type', 'x', 'y', 'width', 'height', 'rotation', 'visible', 'locked', 'opacity', 'fills', 'strokes', 'strokeWeight', 'effects', 'cornerRadius', 'characters'] },
    everything: { depth: 64 },
  };
  const row = { nodes: n, genMs: Math.round(gen.ms) };
  for (const [label, params] of Object.entries(variants)) {
    const runs = [];
    for (let i = 0; i < REPS; i++) runs.push(await frame.evaluate((p) => window.__timedInspect(p), params));
    row[label] = { ms: stats(runs.map((r) => r.ms)), maxGap: stats(runs.map((r) => r.maxGap)), bytes: runs[0].bytes, ids: runs[0].nodes };
  }
  // The detector's own diff cost on an unchanged doc (full tier forced).
  const diffRuns = [];
  for (let i = 0; i < REPS; i++) {
    diffRuns.push(
      await frame.evaluate(async () => {
        window.__det ??= new window.CD.ChangeDetector(window.figcraft, () => {});
        const { stats } = await window.__det.poll(true);
        return stats;
      }),
    );
  }
  row.detectorFull = { fullMs: stats(diffRuns.map((s) => s.fullMs)), diffMs: stats(diffRuns.map((s) => s.diffMs)), nodes: diffRuns[0].nodes };
  await frame.evaluate(() => {
    window.__det = undefined;
  });
  report.sizes.push(row);
  console.log(
    name,
    `n=${n}`,
    `gen=${row.genMs}ms`,
    ...Object.keys(variants).map((k) => `${k}: p50 ${row[k].ms.p50}ms p95 ${row[k].ms.p95}ms gap ${row[k].maxGap.p50}ms ${(row[k].bytes / 1024).toFixed(1)}KiB`),
    `diff p50 ${row.detectorFull.diffMs.p50}ms`,
  );
}

// 2. Correctness: edits through the control channel and a real mouse drag ("a person").
if (ONLY.includes('correctness')) {
  await freshDoc(frame);
  await generateDoc(frame, 1000);
  await frame.evaluate(() => window.figcraft.execute('select.none', {}));
  await frame.evaluate(() => window.figcraft.execute('view.zoomFit', {}));
  const results = [];
  const check = async (label, act) => {
    await frame.evaluate(async () => {
      window.__det = new window.CD.ChangeDetector(window.figcraft, () => {}, { fullEveryMs: 1e9 });
      await window.__det.poll(true);
    });
    const info = await act();
    const r = await frame.evaluate(async () => {
      const { change, stats } = await window.__det.poll();
      return { change, stats };
    });
    const c = r.change;
    const summary = c
      ? { added: c.added.length, removed: c.removed.length, changed: c.changed.slice(0, 5), changedCount: c.changed.length, meta: c.meta }
      : null;
    results.push({ label, info, detected: summary, fullRan: r.stats.fullMs != null });
    console.log('correctness', label, JSON.stringify(info ?? null), '->', JSON.stringify(summary)?.slice(0, 300), 'fullRan', r.stats.fullMs != null);
  };
  const ex = (c, p) => frame.evaluate(([c, p]) => window.figcraft.execute(c, p), [c, p]);
  const ids = await frame.evaluate(async () => {
    const d = await window.figcraft.docInspect({ depth: 2, fields: ['name'] });
    return d.pages[0].children.slice(0, 5).map((f) => ({ id: f.id, kid: f.children?.[0]?.id }));
  });
  await check('node.set fill on 1 rect', () => ex('node.set', { ids: [ids[0].kid], props: { fill: '#FF0000' } }).then(() => ({ id: ids[0].kid })));
  await check('node.set x,y on 2 frames', () => ex('node.set', { ids: [ids[1].id, ids[2].id], props: { x: 5000, y: 5000 } }).then(() => ({ ids: [ids[1].id, ids[2].id] })));
  await check('create 3 nodes', () =>
    ex('command.batch', { commands: [0, 1, 2].map((i) => ({ command: 'node.create', params: { type: 'ellipse', x: i * 10, y: -500, width: 8, height: 8 } })) }),
  );
  await check('delete 1 frame (12 nodes)', () => ex('edit.delete', { ids: [ids[3].id] }).then(() => ({ id: ids[3].id })));
  await check('rename', () => ex('node.set', { ids: [ids[4].id], props: { name: 'Renamed' } }).then(() => ({ id: ids[4].id })));
  await check('selection only', () => ex('select.add', { ids: [ids[4].id] }));
  await check('undo', () => ex('edit.undo', {}));
  // Blind spot: undo then an edit with the same label leaves the gate unchanged.
  await check('undo + same-label edit (gate blind spot)', async () => {
    await ex('node.set', { ids: [ids[4].id], props: { opacity: 0.5 } });
    await frame.evaluate(async () => {
      window.__det = new window.CD.ChangeDetector(window.figcraft, () => {}, { fullEveryMs: 1e9 });
      await window.__det.poll(true);
    });
    await ex('edit.undo', {});
    await ex('node.set', { ids: [ids[4].id], props: { opacity: 0.25 } });
    return { note: 'detector re-created before undo; expect a change on opacity' };
  });
  // A real mouse drag on the canvas (what a person does): drag the selected frame.
  await check('person: mouse drag on the canvas', async () => {
    // Centre the first card in the canvas, deselect, then drag from the canvas centre with the real
    // mouse (the iframe fills the host page, so frame coordinates are page coordinates).
    await ex('select.add', { ids: [ids[0].id] });
    await ex('view.zoomSelection', {});
    await ex('select.none', {});
    await frame.evaluate(async () => {
      window.__det = new window.CD.ChangeDetector(window.figcraft, () => {}, { fullEveryMs: 1e9 });
      await window.__det.poll(true);
    });
    const rect = (await frame.evaluate(() => window.figcraft.uiInspect({}))).canvas.rect;
    const v = await ex('view.get', {});
    const b = (await frame.evaluate((id) => window.figcraft.request('node.get', { id, fields: ['absoluteBounds'] }), ids[0].kid)).absoluteBounds;
    // view.get: (cx, cy) is the page point at the canvas centre, `zoom` screen px per page unit.
    const px = b.x + b.width / 2;
    const py = b.y + b.height / 2;
    const sx = rect[0] + v.vw / 2 + (px - v.cx) * v.zoom;
    const sy = rect[1] + v.vh / 2 + (py - v.cy) * v.zoom;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + 60, sy + 40, { steps: 8 });
    await page.mouse.up();
    await new Promise((r) => setTimeout(r, 300));
    const hist = await frame.evaluate(async () => (await window.figcraft.docInspect({ depth: 0, fields: [] })).history.undo[0]);
    return { screen: [Math.round(sx), Math.round(sy)], view: { cx: v.cx, cy: v.cy, zoom: v.zoom }, lastUndo: hist };
  });
  report.correctness = results;
}

// 3. Frame times while the user pans/zooms, with and without polling.
for (const n of ONLY.includes('frames') ? sizes.filter((s) => s >= 1000) : []) {
  await freshDoc(frame);
  await generateDoc(frame, n);
  await frame.evaluate(() => window.figcraft.execute('select.none', {}));
  await frame.evaluate(() => window.figcraft.execute('view.zoomFit', {}));
  const box = { x: 720, y: 450 };
  for (const mode of ['none', 'gated-1000', 'gated-250', 'full-1000', 'full-250']) {
    await page.mouse.move(box.x, box.y);
    await frame.evaluate(({ mode }) => {
      window.__polls = [];
      if (mode === 'none') return;
      const [kind, ms] = mode.split('-');
      const det = new window.CD.ChangeDetector(window.figcraft, () => {}, { intervalMs: Number(ms), fullEveryMs: kind === 'full' ? 0 : 1e9 });
      window.__pollDet = det;
      const orig = det.poll.bind(det);
      det.poll = async (f) => {
        const r = await orig(f);
        window.__polls.push(r.stats);
        return r;
      };
      det.start();
    }, { mode });
    await frame.evaluate(() => window.__rafStart());
    // 5 s of panning (wheel) and zooming (ctrl+wheel) like a person.
    const t = Date.now();
    let i = 0;
    while (Date.now() - t < 5000) {
      if (i % 20 < 14) await page.mouse.wheel(i % 40 < 20 ? 30 : -30, 15);
      else {
        await page.keyboard.down('Control');
        await page.mouse.wheel(0, i % 40 < 20 ? -20 : 20);
        await page.keyboard.up('Control');
      }
      i++;
      await new Promise((r) => setTimeout(r, 16));
    }
    const deltas = await frame.evaluate(() => window.__rafStop());
    const polls = await frame.evaluate(() => {
      window.__pollDet?.stop();
      window.__pollDet = undefined;
      return window.__polls;
    });
    const s = stats(deltas.slice(1));
    const dropped = deltas.filter((d) => d > 1000 / 60 * 1.5).length;
    const row = {
      nodes: n,
      mode,
      frames: deltas.length,
      rafMs: s,
      over25ms: dropped,
      polls: polls.length,
      pollGateMs: stats(polls.map((p) => p.gateMs)),
      pollFullMs: stats(polls.filter((p) => p.fullMs != null).map((p) => p.fullMs)),
    };
    report.frames.push(row);
    console.log('frames', name, `n=${n}`, mode.padEnd(10), `frames=${row.frames} p50=${s.p50} p95=${s.p95} max=${s.max} >25ms=${dropped} polls=${polls.length} full p50=${row.pollFullMs.p50 ?? '-'}`);
  }
}

report.backend = logs.find((l) => /wgpu backend/.test(l)) ?? null;
await writeFile(new URL(`change-${name}${arg('tag', '') ? '-' + arg('tag', '') : ''}.json`, outDir), JSON.stringify(report, null, 2));
await browser.close();
stopServer();
