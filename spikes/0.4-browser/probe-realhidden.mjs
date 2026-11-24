// A real background tab, without Playwright (its focus emulation keeps every page "visible"):
// Chrome with a fresh profile, the host page in tab 1, then a new tab in front (PUT /json/new) and
// optionally the window minimised. Talks raw CDP over WebSocket (Node 22).
// Usage: node probe-realhidden.mjs [tab|minimize] [chromePath]
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureServer, ORIGIN, stopServer } from './lib.mjs';

const how = process.argv[2] ?? 'tab';
const chromePath = process.argv[3] ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9334;
const dir = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), 'spike04-chrome-'));
await ensureServer();
const proc = spawn(chromePath, [`--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check', '--window-size=1440,900', `${ORIGIN}/host.html`], { stdio: 'ignore' });
const http = (path, method = 'GET') => fetch(`http://127.0.0.1:${port}${path}`, { method }).then((r) => r.json());
let targets;
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 300));
  targets = await http('/json').catch(() => undefined);
  if (targets?.some((t) => t.url.includes('host.html'))) break;
}
const target = targets.find((t) => t.url.includes('host.html'));
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let seq = 0;
const waiting = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waiting.has(m.id)) {
    waiting.get(m.id)(m);
    waiting.delete(m.id);
  }
});
const send = (method, params = {}) =>
  new Promise((res) => {
    const id = ++seq;
    waiting.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });
const evalIn = async (expr, timeoutMs = 35_000) => {
  const wrapped = `(async () => { const fc = document.getElementById('ed').contentWindow.figcraft; const t = performance.now();
    try { const r = await Promise.race([(async () => (${expr}))(), new Promise((_, j) => setTimeout(() => j(new Error('harness timeout')), ${timeoutMs}))]);
      return JSON.stringify({ ok: true, ms: performance.now() - t, r }); }
    catch (e) { return JSON.stringify({ ok: false, ms: performance.now() - t, e: String(e.message).split('\\n')[0] }); } })()`;
  const m = await send('Runtime.evaluate', { expression: wrapped, awaitPromise: true });
  return JSON.parse(m.result?.result?.value ?? '{"ok":false,"e":"no result"}');
};
const state = () =>
  evalIn(`new Promise((res) => { let n = 0; const t = performance.now(); const w = document.getElementById('ed').contentWindow;
    const tick = () => { n++; if (performance.now() - t < 2000) w.requestAnimationFrame(tick); }; w.requestAnimationFrame(tick);
    setTimeout(() => res({ vis: document.visibilityState, rafIn2s: n }), 2100); })`);

for (let i = 0; i < 100; i++) {
  const r = await evalIn('window.hostState?.ready != null && !!fc');
  if (r.ok && r.r) break;
  await new Promise((r) => setTimeout(r, 300));
}
// Bring this browser to the front (macOS hides occluded windows: a window behind the terminal is
// "hidden" too). `open -a` on the .app bundle activates this instance, not the user's own Chrome.
const app = chromePath.replace(/\.app\/.*$/, '.app');
if (process.env.ACTIVATE !== '0') execFileSync('open', ['-a', app]);
await send('Page.bringToFront');
await new Promise((r) => setTimeout(r, 1500));
await evalIn(`fc.execute('file.new', {})`);
await evalIn(`fc.execute('command.batch', { commands: Array.from({ length: 50 }, (_, i) => ({ command: 'node.create', params: { type: 'rectangle', x: i * 20, y: 0, width: 10, height: 10 } })) })`);
console.log(how, 'shown', JSON.stringify((await state()).r));
await http('/json/new?about:blank', 'PUT');
if (how === 'minimize') {
  const { windowId } = await send('Browser.getWindowForTarget').then((m) => m.result);
  await send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
}
await new Promise((r) => setTimeout(r, 1500));
console.log(how, 'hidden', JSON.stringify((await state()).r));
const tests = {
  docInspect: `fc.docInspect({ fields: ['name'], depth: 2 }).then((r) => r.name)`,
  'execute node.create': `fc.execute('node.create', { type: 'rectangle', x: 0, y: 0, width: 5, height: 5 })`,
  'ui.render': `fc.request('ui.render', { scale: 1 }).then((r) => r.data.length)`,
  screenshot: `fc.screenshot({}).then((r) => r.width + 'x' + r.height)`,
};
for (const [label, expr] of Object.entries(tests)) {
  const r = await evalIn(expr);
  console.log(how, 'hidden', label.padEnd(20), r.ok ? `ok ${r.ms.toFixed(0)} ms` : `FAIL ${r.ms.toFixed(0)} ms ${r.e}`);
}
// A request made while hidden, then the tab shown 3 s later.
const pending = evalIn(`fc.docInspect({ fields: [], depth: 1 }).then(() => 'ok')`);
await new Promise((r) => setTimeout(r, 3000));
if (how === 'minimize') {
  const { windowId } = await send('Browser.getWindowForTarget').then((m) => m.result);
  await send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
}
await send('Page.bringToFront');
if (process.env.ACTIVATE !== '0') execFileSync('open', ['-a', app]);
const p = await pending;
console.log(how, 'request sent hidden, shown after 3 s:', p.ok ? `ok ${p.ms.toFixed(0)} ms` : `FAIL ${p.e}`);
console.log(how, 'shown again', JSON.stringify((await state()).r));
ws.close();
proc.kill();
await new Promise((r) => setTimeout(r, 500));
await rm(dir, { recursive: true, force: true }).catch(() => {});
stopServer();
