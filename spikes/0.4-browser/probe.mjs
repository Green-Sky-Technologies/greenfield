// Quick probe: what does the editor expose? Usage: node probe.mjs [browser=chromium-headless]
import { launch, openEditor, timed, stopServer } from './lib.mjs';

const name = process.argv[2] ?? 'chromium-headless';
const { browser, page, version } = await launch(name);
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.type(), m.text().slice(0, 200));
});
console.log(name, version);
const { frame, readyMs } = await openEditor(page);
console.log('ready ms', readyMs.toFixed(0));
console.log('api keys', await frame.evaluate(() => Object.keys(window.figcraft)));
const cmds = await frame.evaluate(() => window.figcraft.commands());
console.log('commands', cmds.length);
const interesting = cmds.filter((c) => /export|render|inspect|history|undo|revision|version|dirty|event|batch|file\./.test(c.id));
console.log(JSON.stringify(interesting.map((c) => ({ id: c.id, params: c.params })), null, 0).slice(0, 6000));
console.log('ui.inspect', JSON.stringify(await frame.evaluate(() => window.figcraft.uiInspect({}))).slice(0, 1500));
console.log('doc.inspect (no doc)', (await timed(frame, () => window.figcraft.docInspect({}))).ok);
console.log('screenshot no doc', JSON.stringify(await timed(frame, async () => { const r = await window.figcraft.screenshot({}); return { w: r.width, h: r.height, len: r.data?.length }; })));
console.log('file.new', JSON.stringify(await timed(frame, () => window.figcraft.execute('file.new', {}))));
console.log('rect', JSON.stringify(await timed(frame, () => window.figcraft.execute('node.create', { type: 'rectangle', x: 0, y: 0, width: 100, height: 100 }))));
const di = await timed(frame, () => window.figcraft.docInspect({}));
console.log('doc.inspect', JSON.stringify(di).slice(0, 2500));
console.log('screenshot doc', JSON.stringify(await timed(frame, async () => { const r = await window.figcraft.screenshot({}); return { w: r.width, h: r.height, len: r.data?.length }; })));
console.log('ui.render', JSON.stringify(await timed(frame, async () => { const r = await window.figcraft.request('ui.render', { scale: 1 }); return { keys: Object.keys(r), len: r.data?.length }; })));
await browser.close();
stopServer();
