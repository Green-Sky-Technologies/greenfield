// What answers while the editor's tab is hidden? Usage: node probe-hidden.mjs <browser> <how: tab|minimize>
import { launch, openEditor, timed, generateDoc, stopServer } from './lib.mjs';

const name = process.argv[2] ?? 'chromium-headed';
const how = process.argv[3] ?? 'tab';
const { browser, context, page } = await launch(name);
const { frame } = await openEditor(page);
await frame.evaluate(() => window.figcraft.execute('file.new', {}));
await generateDoc(frame, 50);

const rafRate = () =>
  frame.evaluate(
    () =>
      new Promise((res) => {
        let n = 0;
        const t = performance.now();
        const tick = () => {
          n++;
          if (performance.now() - t < 2000) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        setTimeout(() => res({ rafIn2s: n, vis: document.visibilityState }), 2100);
      }),
  );

console.log(name, how, 'shown', JSON.stringify(await rafRate()));
let other;
let cdp;
if (how === 'tab') {
  other = await context.newPage();
  await other.goto('about:blank');
  await other.bringToFront();
} else {
  cdp = await context.newCDPSession(page);
  const { windowId } = await cdp.send('Browser.getWindowForTarget');
  await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
  cdp.windowId = windowId;
}
await new Promise((r) => setTimeout(r, 1500));
console.log(name, how, 'hidden', JSON.stringify(await rafRate()));
const T = 35_000;
const tests = {
  'docInspect': () => window.figcraft.docInspect({ fields: ['name'], depth: 2 }).then((r) => r.name),
  'execute node.create': () => window.figcraft.execute('node.create', { type: 'rectangle', x: 0, y: 0, width: 5, height: 5 }),
  'ui.render': () => window.figcraft.request('ui.render', { scale: 1 }).then((r) => r.data.length),
  'screenshot': () => window.figcraft.screenshot({}).then((r) => `${r.width}x${r.height}`),
};
for (const [label, fn] of Object.entries(tests)) {
  const r = await timed(frame, fn, undefined, T);
  console.log(name, how, 'hidden', label.padEnd(20), r.ok ? `ok ${r.ms.toFixed(0)} ms` : `FAIL ${r.ms.toFixed(0)} ms ${r.error.split('\n')[0]}`);
}
// Show again: does a request sent while hidden complete once shown?
const pending = timed(frame, () => window.figcraft.docInspect({ fields: [], depth: 1 }).then(() => 'ok'), undefined, T);
await new Promise((r) => setTimeout(r, 1000));
if (other) await page.bringToFront();
else await cdp.send('Browser.setWindowBounds', { windowId: cdp.windowId, bounds: { windowState: 'normal' } });
const p = await pending;
console.log(name, how, 'request sent hidden, shown after 1 s:', p.ok ? `ok ${p.ms.toFixed(0)} ms` : `FAIL ${p.error}`);
console.log(name, how, 'shown again', JSON.stringify(await rafRate()));
await browser.close();
stopServer();
