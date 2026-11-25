#!/usr/bin/env node
/** Print the raw timeline of a few canvas clicks (events mode), to see where the time goes. */
import { chromium, firefox, webkit } from '../../apps/web/node_modules/@playwright/test/index.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]]);
    return acc;
  }, []),
);
const b = await { chromium, firefox, webkit }[args.browser ?? 'chromium'].launch({ headless: !args.headed, channel: args.channel === true ? undefined : args.channel });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto(`http://localhost:3350/dev/canvas-spike?canvas=flag&file=${args.file ?? 'large'}&sync=${args.sync ?? 'events'}`);
await p.waitForFunction(() => window.__spike, null, { timeout: 90000 });
await p.waitForTimeout(1500);
const box = await p.locator('[data-testid=canvas]').boundingBox();
for (let i = 0; i < 3; i++) {
  await p.evaluate(async (k) => {
    const ids = [...document.querySelectorAll('[data-layer]')].filter((e) => /^(R|T|E|V|L)/.test(e.textContent)).map((e) => Number(e.getAttribute('data-layer')));
    await window.__spike.editor.execute('select.set', { ids: [ids[(k * 7) % ids.length]] });
    await window.__spike.editor.execute('view.zoomSelection', {});
    await window.__spike.editor.execute('select.none', {});
  }, i);
  await p.waitForTimeout(600);
  await p.evaluate(() => window.__spikePerf.clear());
  await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await p.waitForTimeout(500);
  const log = await p.evaluate(() => window.__spikePerf.log.filter((e) => e.kind !== 'frame'));
  const t0 = log.find((e) => e.kind === 'input')?.t ?? 0;
  console.log(`--- click ${i}`);
  for (const e of log) {
    const { t, kind, ...rest } = e;
    console.log(`${(t - t0).toFixed(1).padStart(7)}  ${kind} ${JSON.stringify(rest)}`);
  }
}
await b.close();
