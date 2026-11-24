// Does figcraft.screenshot() hang once the editor is idle? Usage: node probe-idle.mjs <browser> [host|direct] [idleMs] [dpr]
import { launch, openEditor, timed, generateDoc, stopServer, pw, BROWSERS } from './lib.mjs';

const name = process.argv[2] ?? 'chromium-headless';
const mode = process.argv[3] ?? 'host';
const idle = Number(process.argv[4] ?? 5000);
const dpr = Number(process.argv[5] ?? 1);
let b;
if (dpr !== 1) {
  const cfg = BROWSERS[name];
  const browser = await pw[cfg.type].launch({ headless: cfg.headless, channel: cfg.channel });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: dpr });
  b = { browser, page: await context.newPage() };
} else b = await launch(name);
const { browser, page } = b;
const { frame } = await openEditor(page, { mode });
const fr = async () => (await frame.evaluate(() => window.figcraft.uiInspect({}))).framesDrawn;
if (mode === 'host') await frame.evaluate(() => window.figcraft.execute('file.new', {}));
await generateDoc(frame, 200);
for (let i = 0; i < 4; i++) {
  const before = await fr();
  await new Promise((r) => setTimeout(r, idle));
  const mid = await fr();
  const r = await timed(frame, async () => {
    const s = await window.figcraft.screenshot({});
    return { w: s.width, h: s.height };
  });
  console.log(name, mode, `idle ${idle} ms: frames during idle=${mid - before - 1}`, r.ok ? `ok ${r.ms.toFixed(0)} ms ${r.result.w}x${r.result.h}` : `FAIL ${r.ms.toFixed(0)} ms ${r.error.split('\n')[0]}`);
}
await browser.close();
stopServer();
