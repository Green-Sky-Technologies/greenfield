#!/usr/bin/env node
/**
 * Story 5.0: functional checks of the patched editor from the host page, in one browser, plus
 * the screenshots the ADR uses.
 *   node spikes/5.0-canvas-spike/probe.mjs <shots-dir> [--browser chromium] [--channel chrome] [--headed 1]
 * Prints one JSON object: what each check saw.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium, firefox, webkit } from '../../apps/web/node_modules/@playwright/test/index.mjs';

const dir = process.argv[2];
const args = Object.fromEntries(
  process.argv.slice(3).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]]);
    return acc;
  }, []),
);
fs.mkdirSync(dir, { recursive: true });
const b = await { chromium, firefox, webkit }[args.browser ?? 'chromium'].launch({
  headless: !args.headed,
  channel: args.channel === true ? undefined : args.channel,
});
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const out = { browser: args.browser ?? 'chromium', errors: [] };
p.on('pageerror', (e) => out.errors.push(e.message));
await p.goto(`http://localhost:3350/dev/canvas-spike?canvas=flag&file=${args.file ?? 'large'}&sync=events`);
await p.waitForFunction(() => window.__spike, null, { timeout: 90000 });
await p.waitForTimeout(1500);
const box = await p.locator('[data-testid=canvas]').boundingBox();
const events = [];
await p.exposeFunction('__collect', (e) => events.push(e));
await p.evaluate(() => window.addEventListener('message', (ev) => { if (ev.data?.type === 'figcraft:event' && ev.data.name !== 'spike.ping') window.__collect({ name: ev.data.name, data: ev.data.data }); }));

// Select on the canvas, then run a command as Claude with presence held.
await p.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.45);
await p.waitForTimeout(600);
await p.screenshot({ path: path.join(dir, `spike-${out.browser}-selected.png`) });
out.canvasModeUi = await p.evaluate(() => window.__spike.editor.request('ui.inspect', {}).then((u) => ({ canvasMode: u.canvasMode, tool: u.status.tool })));
await p.locator('[data-testid=hold-presence]').click();
await p.waitForTimeout(300);
await p.locator('[data-testid=run-claude]').click();
await p.waitForTimeout(1500);
await p.screenshot({ path: path.join(dir, `spike-${out.browser}-claude.png`) });
out.agentEvents = events.filter((e) => e.name === 'agent.presence').slice(0, 4);
out.pillText = await p.locator('header').textContent();
out.undoLabelsAfterAgent = await p.evaluate(() => window.__spike.editor.inspect({ depth: 0, fields: [] }).then((d) => d.history.undo.slice(-3)));
// Release: the avatar lingers 8 s, then clears.
await p.locator('[data-testid=hold-presence]').click();
await p.waitForTimeout(500);
out.afterRelease = events.filter((e) => e.name === 'agent.presence').slice(-2);
await p.waitForTimeout(9000);
out.afterLinger = events.filter((e) => e.name === 'agent.presence').slice(-1);
// Host events.
events.length = 0;
await p.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.45, { button: 'right' });
await p.waitForTimeout(400);
out.rightClick = events.filter((e) => e.name === 'ui.request');
events.length = 0;
await p.evaluate(() => window.__spike.editor.request('engine.execute', { command: 'select.none', params: {} }));
await p.waitForTimeout(400);
out.selectNone = events.slice(0, 3);
events.length = 0;
await p.evaluate(() => window.__spike.editor.execute('view.zoomIn', {}));
await p.waitForTimeout(400);
out.zoomEvents = events.slice(0, 3);
await p.screenshot({ path: path.join(dir, `spike-${out.browser}-after.png`) });
// The fallback (Story 5.13): the editor's own panels come back, no reload.
await p.locator('[data-testid=canvas-toggle]').click();
await p.waitForTimeout(1000);
out.panelsBack = await p.evaluate(() => window.__spike.editor.request('ui.inspect', {}).then((u) => ({ canvasMode: u.canvasMode, leftPanel: u.panels?.left })));
await p.screenshot({ path: path.join(dir, `spike-${out.browser}-panels-back.png`) });
console.log(JSON.stringify(out, null, 1));
await b.close();
