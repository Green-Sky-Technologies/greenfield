#!/usr/bin/env node
/**
 * Run measure.mjs over browsers x files x sync modes, one after the other (they share a CPU, so
 * never in parallel).
 *
 *   node spikes/5.0-canvas-spike/run-matrix.mjs --build upstream-0.18.1 --canvas toggle \
 *     [--browsers chromium,webkit,firefox] [--files small,large] [--syncs pointer,poll] [--trials 30]
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]]);
    return acc;
  }, []),
);
const list = (k, d) => (args[k] ?? d).split(',');
for (const browser of list('browsers', 'chromium,webkit,firefox')) {
  for (const file of list('files', 'small,large')) {
    for (const sync of list('syncs', 'pointer,poll')) {
      const a = ['--browser', browser, '--file', file, '--sync', sync];
      for (const k of ['build', 'canvas', 'trials', 'pollMs', 'out', 'channel']) if (args[k]) a.push(`--${k}`, args[k]);
      if (args.headed) a.push('--headed');
      console.log(`\n=== ${browser} ${file} ${sync}`);
      const r = spawnSync('node', [path.join(here, 'measure.mjs'), ...a], { encoding: 'utf8', timeout: 600_000 });
      if (r.status !== 0) console.log('FAILED', (r.stderr || r.stdout).slice(-800));
      else {
        const j = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
        console.log(
          `nodes ${j.nodes}; click->inspector p50 ${j.clickToInspector.clickToInspector.p50} p95 ${j.clickToInspector.clickToInspector.p95};` +
            ` scrub p50 ${j.scrub.moveToApplied.p50} p95 ${j.scrub.moveToApplied.p95} undo+${j.scrub.undoStepsAdded};` +
            ` dup->layers p50 ${j.editToLayers?.duplicate.keyToLayers.p50} p95 ${j.editToLayers?.duplicate.keyToLayers.p95}`,
        );
      }
    }
  }
}
