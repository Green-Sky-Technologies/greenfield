#!/usr/bin/env node
/**
 * Print the ADR's tables (Markdown) from results/*.json.
 *   node spikes/5.0-canvas-spike/summarize.mjs [build-prefix]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'results');
const prefix = process.argv[2] ?? '';
const rows = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.json') && f.startsWith(prefix))
  .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
const label = (r) =>
  r.browser === 'chromium' ? (r.channel === 'chrome' ? 'Chrome 158 (GPU)' : 'Chromium (software GL)') : r.browser === 'webkit' ? 'WebKit (Safari engine)' : 'Firefox';
const order = ['Chrome 158 (GPU)', 'WebKit (Safari engine)', 'Firefox', 'Chromium (software GL)'];
rows.sort((a, b) => order.indexOf(label(a)) - order.indexOf(label(b)) || a.file.localeCompare(b.file) || a.sync.localeCompare(b.sync));
const f = (s) => (s && s.p50 !== null ? `${s.p50} / ${s.p95}` : 'n/a');

const table = (title, head, pick) => {
  console.log(`\n**${title}** (p50 / p95 ms)\n`);
  console.log(`| Browser | File (nodes) | Sync | ${head.join(' | ')} |`);
  console.log(`|---|---|---|${head.map(() => '---').join('|')}|`);
  for (const r of rows) console.log(`| ${label(r)} | ${r.file} (${r.nodes}) | ${r.sync}${r.sync === 'poll' ? ' 100 ms' : ''} | ${pick(r).join(' | ')} |`);
};
table('Canvas click to inspector painted', ['click to inspector', 'editor frame done', 'added over canvas', 'input to read', 'one control call'], (r) => {
  const c = r.clickToInspector;
  return [f(c.clickToInspector), f(c.canvasFrameEnd), f(c.addedOverCanvas), f(c.inputToSyncRequest), f(c.gateMs)];
});
table('Scrub to canvas repaint', ['pointer to next editor frame done', 'pointer to reply', 'previews', 'undo steps', 'Esc restores'], (r) => [
  f(r.scrub.moveToCanvasFrameEnd),
  f(r.scrub.moveToApplied),
  `${r.scrub.previewsApplied}/${r.scrub.moves}`,
  r.scrub.undoStepsAdded,
  r.escCancel.restored ? 'yes' : 'no',
]);
table('Canvas edit to layers list painted', ['Cmd+D to rows', 'added over canvas', 'tree read ms', 'Delete to rows', 'control edit to rows'], (r) => {
  const e = r.editToLayers;
  return e ? [f(e.duplicate.keyToLayers), f(e.duplicate.addedOverCanvas), f(e.duplicate.treeMs), f(e.delete.keyToLayers), f(e.controlEdit.editToLayers)] : ['-', '-', '-', '-', '-'];
});
console.log('\n**Event floor** (an event posted from inside an editor frame, to our React tree painted)\n');
console.log('| Browser | postMessage hop | post to painted |\n|---|---|---|');
for (const r of rows.filter((x) => x.sync === 'pointer')) console.log(`| ${label(r)} (${r.file}) | ${f(r.eventFloor.postMessageHop)} | ${f(r.eventFloor.postToPaint)} |`);
console.log('\n**Environment**\n');
for (const r of rows.filter((x) => x.sync === 'pointer' && x.file === 'small')) console.log(`- ${label(r)}: ${r.env.renderer}; editor frame period p50 ${r.framePeriod.periodP50} ms, frame work p50 ${r.framePeriod.workP50} ms; cpu idle ${r.cpuIdle?.start}% at start.`);
