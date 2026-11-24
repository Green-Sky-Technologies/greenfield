/**
 * Build the landing fixture in headless FigCraft, then save fixture/landing.figcraft,
 * fixture/landing.png, fixture/ids.json (name -> layer id) and fixture/outline.json.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildLanding, FONT } from './figcraft/fixture';
import { SPIKE_DIR, startFigcraft } from './figcraft/mcp';
import { renderPng } from './figcraft/render';

const dir = join(SPIKE_DIR, 'fixture');
mkdirSync(dir, { recursive: true });
const fc = await startFigcraft({ writeRoot: dir });
const fonts = await fc.cmd<unknown>('text.fonts', { family: FONT });
console.log('font', FONT, JSON.stringify(fonts).slice(0, 300));
const t0 = performance.now();
const fx = await buildLanding(fc);
console.log(`built in ${Math.round(performance.now() - t0)} ms:`, fx.ids);
writeFileSync(join(dir, 'ids.json'), JSON.stringify(fx.ids, null, 2) + '\n');
const outline = await fc.json('get_node', {
  id: fx.rootId,
  depth: 6,
  fields: ['name', 'type', 'x', 'y', 'width', 'height', 'characters'],
});
writeFileSync(join(dir, 'outline.json'), JSON.stringify(outline, null, 2) + '\n');
writeFileSync(join(dir, 'landing.png'), await renderPng(fc, fx.rootId));
console.log(await fc.json('save_file', { path: join(dir, 'landing.figcraft') }));
await fc.close();
