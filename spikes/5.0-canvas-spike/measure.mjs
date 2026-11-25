#!/usr/bin/env node
/**
 * Story 5.0: measure the three latencies on /dev/canvas-spike, in one browser, with one file.
 *
 *   node spikes/5.0-canvas-spike/measure.mjs --browser chromium --file small --sync pointer
 *        [--canvas flag|toggle] [--build label] [--trials 30] [--pollMs 100] [--headed]
 *        [--channel chrome] [--base http://localhost:3350] [--out dir] [--shot path.png]
 *
 * It drives real input with Playwright (pointer and key events reach the page like a person's),
 * and reads the timestamps the page logs on one clock (apps/web/src/app/dev/canvas-spike/perf.ts).
 * See docs/adr/0005-canvas-mode.md for how each number is defined.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from '../../apps/web/node_modules/@playwright/test/index.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]]);
    return acc;
  }, []),
);
const browserName = args.browser ?? 'chromium';
const file = args.file ?? 'small';
const sync = args.sync ?? 'pointer';
const canvas = args.canvas ?? 'flag';
const build = args.build ?? 'upstream-0.18.1';
const trials = Number(args.trials ?? 30);
const base = args.base ?? 'http://localhost:3350';
const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = args.out ?? path.join(here, 'results');

/** CPU idle % over ~2 s (macOS `top`). Docker builds on this machine saturate it and wreck latency numbers. */
function cpuIdle() {
  try {
    const out = execFileSync('top', ['-l', '2', '-n', '0', '-s', '1'], { encoding: 'utf8' });
    const m = [...out.matchAll(/CPU usage:.*?([\d.]+)% idle/g)].at(-1);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}
const quietMin = Number(args.quiet ?? 75);
const quietDeadline = Date.now() + Number(args.quietWaitMin ?? 30) * 60_000;
let idleStart = cpuIdle();
while (idleStart !== null && idleStart < quietMin && Date.now() < quietDeadline) {
  console.error(`waiting for a quiet machine (cpu idle ${idleStart}% < ${quietMin}%)`);
  await new Promise((r) => setTimeout(r, 20_000));
  idleStart = cpuIdle();
}

const types = { chromium, firefox, webkit };
const browser = await types[browserName].launch({
  headless: !args.headed,
  channel: args.channel === true ? undefined : args.channel,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error' && !/Clerk|clerk|favicon/.test(m.text())) problems.push(`console: ${m.text().slice(0, 200)}`);
});

const q = new URLSearchParams({ file, sync, canvas });
if (args.pollMs) q.set('pollMs', String(args.pollMs));
const t0 = Date.now();
await page.goto(`${base}/dev/canvas-spike?${q}`);
await page.waitForFunction(() => window.__spike, null, { timeout: 180_000 });
const loadMs = Date.now() - t0;
const nodes = await page.evaluate(() => window.__spike.loaded.then((l) => l.nodes));
await page.waitForTimeout(1500);

const env = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl');
  const ext = gl?.getExtension('WEBGL_debug_renderer_info');
  return {
    ua: navigator.userAgent,
    renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl ? 'webgl (masked)' : 'none',
    dpr: devicePixelRatio,
    webgpu: 'gpu' in navigator,
  };
});

const clear = () => page.evaluate(() => window.__spikePerf.clear());
const readLog = () => page.evaluate(() => window.__spikePerf.log.slice());
const iframeBox = await page.locator('[data-testid=canvas]').boundingBox();
const exec = (command, params) => page.evaluate(([c, p]) => window.__spike.editor.execute(c, p), [command, params]);
// `history.undo` lists only the last 20 steps; `undoDepth` (patch 0002) counts them all.
const undoDepthOf = (d) => d.history.undoDepth ?? d.history.undo.length;
const inspect = () => page.evaluate(() => window.__spike.editor.inspect({ depth: 0, fields: [] }));
const inspectorSig = () => page.evaluate(() => document.querySelector('[data-testid=inspector]')?.getAttribute('data-node') ?? '');
const layerRows = () => page.evaluate(() => Number(document.querySelector('[data-testid=layers]')?.getAttribute('data-rows') ?? 0));

const pct = (xs, p) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] * 10) / 10;
};
const stats = (xs) => ({ n: xs.length, p50: pct(xs, 50), p95: pct(xs, 95), max: xs.length ? Math.round(Math.max(...xs) * 10) / 10 : null, min: xs.length ? Math.round(Math.min(...xs) * 10) / 10 : null });

/** The end of the first editor frame that starts after `t`. */
const frameEndAfter = (log, t) => log.find((e) => e.kind === 'frame' && e.start >= t)?.end ?? null;

async function waitFor(fn, ms = 2500) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await page.waitForTimeout(8);
  }
  return null;
}

// Idle frame period of the editor (it only draws when something changes, so provoke it).
async function framePeriod() {
  await clear();
  await page.mouse.move(iframeBox.x + 200, iframeBox.y + 200);
  for (let i = 0; i < 40; i++) {
    await page.mouse.move(iframeBox.x + 200 + i * 6, iframeBox.y + 200 + i * 3);
    await page.waitForTimeout(8);
  }
  const frames = (await readLog()).filter((e) => e.kind === 'frame');
  const d = frames.slice(1).map((f, i) => f.start - frames[i].start);
  const work = frames.map((f) => f.end - f.start);
  return { frames: frames.length, periodP50: pct(d, 50), workP50: pct(work, 50), workP95: pct(work, 95) };
}

// ---- floor: an event posted from inside an editor frame, to a repaint of our React tree
async function eventFloor() {
  const hop = [];
  const toPaint = [];
  for (let i = 0; i < 40; i++) {
    await clear();
    await page.evaluate(() => {
      const win = window.__spike.iframe.contentWindow;
      win.requestAnimationFrame(() => {
        win.parent.postMessage({ type: 'figcraft:event', name: 'spike.ping', data: { t0: performance.now() } }, '*');
      });
    });
    const log = await waitFor(async () => {
      const l = await readLog();
      return l.find((e) => e.kind === 'ping-painted') ? l : null;
    }, 1500);
    if (!log) continue;
    const painted = log.find((e) => e.kind === 'ping-painted');
    const ev = log.find((e) => e.kind === 'event' && e.name === 'spike.ping');
    hop.push(ev.t - painted.t0);
    toPaint.push(painted.t - painted.t0);
    await page.waitForTimeout(40 + (i % 5) * 7);
  }
  return { postMessageHop: stats(hop), postToPaint: stats(toPaint) };
}

// ---- A. canvas click -> inspector
async function clickToInspector() {
  const samples = [];
  const leafIds = await page.evaluate(() =>
    [...document.querySelectorAll('[data-layer]')]
      .filter((e) => /^(R|T|E|V|L)/.test(e.textContent))
      .map((e) => Number(e.getAttribute('data-layer'))),
  );
  let last = await inspectorSig();
  for (let k = 0; samples.length < trials && k < trials * 2; k++) {
    // Put a leaf in the middle of the view with nothing selected, then click it for real.
    await exec('select.set', { ids: [leafIds[(k * 7) % leafIds.length]] });
    await exec('view.zoomSelection', {});
    await exec('select.none', {});
    await waitFor(async () => (await inspectorSig()) === '', 3000);
    await page.waitForTimeout(300);
    last = await inspectorSig();
    await clear();
    await page.mouse.click(iframeBox.x + iframeBox.width / 2, iframeBox.y + iframeBox.height / 2);
    // Wait for the inspector to paint a different selection.
    const got = await waitFor(async () => {
      const log = await readLog();
      const changed = (e) => e.kind === 'inspector-painted' && (e.id === null ? last !== '' : String(e.id) !== last);
      return log.find(changed) ? log : null;
    }, 2500);
    if (!got) continue;
    const input = got.find((e) => e.kind === 'input' && e.type === 'pointerdown');
    const inspectorEv = got.find((e) => e.kind === 'inspector-painted' && (e.id === null ? last !== '' : String(e.id) !== last));
    const up = got.find((e) => e.kind === 'input' && e.type === 'pointerup');
    const frameEnd = frameEndAfter(got, input.t);
    const gate = got.filter((e) => e.kind === 'gate' && e.t >= input.t && e.t <= inspectorEv.t).map((e) => e.ms);
    const stateSet = got.find((e) => e.kind === 'state-set' && e.t >= input.t);
    const request = got.find((e) => e.kind === 'sync-request' && e.t >= input.t);
    samples.push({
      clickToInspector: inspectorEv.t - input.t,
      canvasFrameEnd: frameEnd === null ? null : frameEnd - input.t,
      addedOverCanvas: frameEnd === null ? null : inspectorEv.t - frameEnd,
      inputToSyncRequest: request ? request.t - input.t : null,
      gateMs: gate[0] ?? null,
      stateSetToPaint: stateSet ? inspectorEv.t - stateSet.t : null,
      pointerupGap: up ? up.t - input.t : null,
    });
  }
  const col = (k) => samples.map((s) => s[k]).filter((v) => v !== null);
  return {
    samples: samples.length,
    clickToInspector: stats(col('clickToInspector')),
    canvasFrameEnd: stats(col('canvasFrameEnd')),
    addedOverCanvas: stats(col('addedOverCanvas')),
    inputToSyncRequest: stats(col('inputToSyncRequest')),
    gateMs: stats(col('gateMs')),
    stateSetToPaint: stats(col('stateSetToPaint')),
  };
}

// ---- B. scrub -> canvas repaint, undo steps, Esc
async function scrub(target = 'leaf') {
  // Select something to scrub: a leaf layer (rectangle, text...), or the first row (a top frame).
  const row = target === 'leaf'
    ? page.locator('[data-layer]').filter({ hasText: /^(R|T|E|V|L)/ }).first()
    : page.locator('[data-layer]').first();
  const rowId = await row.getAttribute('data-layer');
  await row.click();
  await waitFor(async () => (await inspectorSig()) === rowId);
  await page.waitForTimeout(150);
  const undoDepth = async () => undoDepthOf(await inspect());
  const before = await undoDepth();
  const label = page.locator('[data-testid=field-x-label]');
  const lb = await label.boundingBox();
  const startValue = Number(await page.locator('[data-testid=field-x]').textContent());
  await clear();
  await page.mouse.move(lb.x + 8, lb.y + 8);
  await page.mouse.down();
  const N = 60;
  for (let i = 1; i <= N; i++) {
    await page.mouse.move(lb.x + 8 + i * 2, lb.y + 8);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await waitFor(async () => (await readLog()).some((e) => e.kind === 'scrub-commit'), 4000);
  const log = await readLog();
  const moves = log.filter((e) => e.kind === 'scrub-move');
  const applied = log.filter((e) => e.kind === 'scrub-applied');
  const lat = [];
  const callMs = applied.map((a) => a.callMs);
  const toCanvas = [];
  for (const m of moves) {
    // The first applied call that carried this move or a later one.
    const a = applied.find((x) => x.seq >= m.seq);
    if (a) lat.push(a.t - m.t);
    // The canvas draws it in the first editor frame that starts after the call is sent.
    const sent = log.find((x) => x.kind === 'scrub-sent' && x.seq >= m.seq);
    const fe = sent ? frameEndAfter(log, sent.t) : null;
    if (sent && fe !== null) toCanvas.push(fe - m.t);
  }
  const frames = log.filter((e) => e.kind === 'frame');
  await page.waitForTimeout(300);
  const after = await undoDepth();
  const endValue = Number(await page.locator('[data-testid=field-x]').textContent());
  const canvasFrames = frames.length;
  return {
    target,
    moves: moves.length,
    previewsApplied: applied.length,
    moveToApplied: stats(lat),
    moveToAppliedAll: lat.map((v) => Math.round(v)),
    moveToCanvasFrameEnd: stats(toCanvas),
    previewCallMs: stats(callMs),
    editorFramesDuringScrub: canvasFrames,
    undoStepsAdded: after - before,
    startValue,
    endValue,
  };
}

async function escCancel(gestures) {
  const startValue = Number(await page.locator('[data-testid=field-x]').textContent());
  const label = page.locator('[data-testid=field-x-label]');
  const lb = await label.boundingBox();
  const before = undoDepthOf(await inspect());
  await page.mouse.move(lb.x + 8, lb.y + 8);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) {
    await page.mouse.move(lb.x + 8 + i * 3, lb.y + 8);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(100);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.waitForTimeout(500);
  const sig = await page.evaluate(() => window.__spike.editor.request('node.get', { id: Number(document.querySelector('[data-testid=inspector]').getAttribute('data-node')), fields: ['x'], depth: 0 }));
  const after = undoDepthOf(await inspect());
  return { gestures, startValue, xAfterEsc: sig?.x, restored: sig?.x === startValue, undoStepsAdded: after - before };
}

// ---- C. canvas edit -> layers list
async function editToLayers() {
  const out = { duplicate: [], delete: [], control: [], dragSettle: [] };
  // Make the canvas the keyboard target: click a node on it.
  const click = async (fx, fy) => page.mouse.click(iframeBox.x + fx * iframeBox.width, iframeBox.y + fy * iframeBox.height);
  const n = Math.min(trials, 8);
  for (let i = 0; i < n; i++) {
    // Duplicate the selection from the canvas (Cmd/Ctrl+D) and watch the list grow.
    await page.locator('[data-layer]').first().click(); // selects something
    await page.waitForTimeout(250);
    await click(0.9, 0.9); // focus the canvas (an empty spot may deselect; reselect by command)
    await exec('select.set', { ids: [(await inspect()).selection[0] ?? (await page.evaluate(() => Number(document.querySelector('[data-layer]')?.getAttribute('data-layer'))))].filter(Boolean) });
    await page.waitForTimeout(300);
    const rows0 = await layerRows();
    await clear();
    await page.keyboard.press('ControlOrMeta+D');
    const log = await waitFor(async () => {
      const l = await readLog();
      return l.find((e) => e.kind === 'layers-painted' && e.rows > rows0) ? l : null;
    }, 3000);
    if (log) {
      const input = log.find((e) => e.kind === 'input' && e.type === 'keydown');
      const painted = log.find((e) => e.kind === 'layers-painted' && e.rows > rows0);
      const frameEnd = input ? frameEndAfter(log, input.t) : null;
      const tree = log.find((e) => e.kind === 'tree');
      out.duplicate.push({ keyToLayers: painted.t - input.t, addedOverCanvas: frameEnd ? painted.t - frameEnd : null, treeMs: tree?.ms ?? null, rows: tree?.rows ?? null });
    }
    // Delete it again from the canvas.
    const rows1 = await layerRows();
    await clear();
    await page.keyboard.press('Delete');
    const log2 = await waitFor(async () => {
      const l = await readLog();
      return l.find((e) => e.kind === 'layers-painted' && e.rows < rows1) ? l : null;
    }, 3000);
    if (log2) {
      const input = log2.find((e) => e.kind === 'input' && e.type === 'keydown');
      const painted = log2.find((e) => e.kind === 'layers-painted' && e.rows < rows1);
      out.delete.push({ keyToLayers: painted.t - input.t });
    }
    await page.waitForTimeout(150);
  }
  // A control-channel edit (what the agent does): rename through the bridge, watch the list.
  for (let i = 0; i < n; i++) {
    const id = Number(await page.evaluate(() => document.querySelector('[data-layer]')?.getAttribute('data-layer')));
    await clear();
    const name = `Renamed ${i}-${Date.now() % 10000}`;
    await page.evaluate(([id_, nm]) => { window.__spikePerf.log.push({ t: performance.now(), kind: 'agent-edit' }); return window.__spike.editor.execute('node.set', { ids: [id_], name: nm }); }, [id, name]);
    const log = await waitFor(async () => {
      const l = await readLog();
      return (await page.locator(`[data-layer="${id}"]`).first().textContent().catch(() => '')) === ('R' + name) || (await page.locator(`[data-layer="${id}"]`).first().textContent().catch(() => '')).endsWith(name) ? l : null;
    }, 3000);
    if (log) {
      const start = log.find((e) => e.kind === 'agent-edit');
      const painted = log.filter((e) => e.kind === 'layers-painted').at(-1);
      if (start && painted) out.control.push({ editToLayers: painted.t - start.t });
    }
    await page.waitForTimeout(100);
  }
  const col = (xs, k) => xs.map((s) => s[k]).filter((v) => v !== null && v !== undefined);
  return {
    duplicate: { n: out.duplicate.length, keyToLayers: stats(col(out.duplicate, 'keyToLayers')), addedOverCanvas: stats(col(out.duplicate, 'addedOverCanvas')), treeMs: stats(col(out.duplicate, 'treeMs')), rows: out.duplicate.at(-1)?.rows ?? null },
    delete: { n: out.delete.length, keyToLayers: stats(col(out.delete, 'keyToLayers')) },
    controlEdit: { n: out.control.length, editToLayers: stats(col(out.control, 'editToLayers')) },
  };
}

// ---- D. canvas drag -> inspector settle
async function dragSettle() {
  const samples = [];
  const reps = Math.min(trials, 6);
  for (let r = 0; r < reps; r++) {
    // A leaf layer, zoomed to fill the view so its centre is the centre of the canvas.
    const id = await page.evaluate((k) => {
      const rows = [...document.querySelectorAll('[data-layer]')].filter((e) => e.textContent.startsWith('R'));
      return Number((rows[k % Math.max(1, rows.length)] ?? document.querySelector('[data-layer]')).getAttribute('data-layer'));
    }, r);
    await exec('select.set', { ids: [id] });
    await exec('view.zoomSelection', {});
    await page.waitForTimeout(400);
    const cx = iframeBox.x + iframeBox.width / 2;
    const cy = iframeBox.y + iframeBox.height / 2;
    await page.mouse.move(cx, cy);
    await clear();
    await page.mouse.down();
    for (let i = 1; i <= 20; i++) {
      await page.mouse.move(cx + i * 3, cy + i * 2);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
    await waitFor(async () => {
      const l = await readLog();
      const up = l.find((e) => e.kind === 'input' && e.type === 'pointerup');
      if (!up) return null;
      const last = l.filter((e) => e.kind === 'inspector-painted' && e.t >= up.t).at(-1);
      return last && l.filter((e) => e.kind === 'frame' && e.start > up.t).length > 0 ? l : null;
    }, 2500);
    await page.waitForTimeout(500);
    const l2 = await readLog();
    const up = l2.find((e) => e.kind === 'input' && e.type === 'pointerup');
    const downs = l2.filter((e) => e.kind === 'inspector-painted');
    if (up && downs.length) {
      const lastPaint = downs.at(-1);
      samples.push({ upToFinalInspector: Math.max(0, lastPaint.t - up.t), paintsDuringDrag: downs.filter((e) => e.t < up.t).length });
    }
  }
  return { n: samples.length, upToFinalInspector: stats(samples.map((s) => s.upToFinalInspector)), inspectorPaintsPerDrag: stats(samples.map((s) => s.paintsDuringDrag)) };
}

const result = { build, browser: browserName, channel: args.channel ?? null, headless: !args.headed, file, nodes, sync, canvas, loadMs, env, trials };
result.framePeriod = await framePeriod();
result.canvasInfo = await page.evaluate(() => window.__spike.editor.request('ui.inspect', {}).then((u) => ({ rect: u.canvas?.rect, zoom: u.status?.zoom, panels: u.panels })).catch(() => null));
if (args.shot) await page.screenshot({ path: args.shot });
result.eventFloor = await eventFloor();
result.clickToInspector = await clickToInspector();
const gestures = await page.evaluate(() => window.__spike.store.current.gestures);
result.gestures = gestures;
result.scrub = await scrub('leaf');
if (nodes > 100) result.scrubFrame = await scrub('frame');
result.escCancel = await escCancel(gestures);
if (!args.skipEdit) {
  result.editToLayers = await editToLayers();
  result.dragSettle = await dragSettle();
}
result.cpuIdle = { start: idleStart, end: cpuIdle(), quietMin };
result.problems = problems.slice(0, 10);
fs.mkdirSync(outDir, { recursive: true });
const name = `${build}__${browserName}${args.channel && args.channel !== true ? '-' + args.channel : ''}__${file}__${sync}${sync === 'poll' ? args.pollMs ?? 100 : ''}__${canvas}.json`;
fs.writeFileSync(path.join(outDir, name), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 1));
await browser.close();
