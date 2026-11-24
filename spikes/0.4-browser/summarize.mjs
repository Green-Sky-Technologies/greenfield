// Print markdown tables from out/*.json. Usage: node summarize.mjs [screenshot|change|large]
import { readdir, readFile } from 'node:fs/promises';

const what = process.argv[2] ?? 'screenshot';
if (what === 'compact') {
  // One row per browser x method over every scenario (and the tagged re-runs).
  const dir = new URL('./out/', import.meta.url);
  const files = (await readdir(dir)).filter((f) => f.startsWith('screenshot-') && f.endsWith('.json')).sort();
  const rows = new Map();
  for (const f of files) {
    const r = JSON.parse(await readFile(new URL(f, dir), 'utf8'));
    for (const c of r.cells) {
      if (c.setupError) continue;
      const key = `${r.browser}|${c.method}`;
      const row = rows.get(key) ?? { browser: r.browser, version: r.version, backend: r.backend?.replace(/.*backend /, ''), method: c.method, ok: 0, tries: 0, p50: [], p95: [], timeouts: 0, blank: 0, cells: 0 };
      row.ok += c.ok;
      row.tries += c.tries;
      row.timeouts += c.errors.length ? c.tries - c.ok : 0;
      if (c.latency.p50 != null) row.p50.push(c.latency.p50);
      if (c.latency.p95 != null) row.p95.push(c.latency.p95);
      if (c.image?.distinct === 1) row.blank++;
      row.cells++;
      rows.set(key, row);
    }
  }
  console.log('| browser | backend | method | ok / tries | p50 ms (min–max over scenarios) | worst p95 ms | blank images |');
  console.log('|---|---|---|---|---|---|---|');
  for (const r of rows.values()) {
    console.log(`| ${r.browser} ${r.version} | ${r.backend} | ${r.method} | ${r.ok}/${r.tries} | ${Math.min(...r.p50)}–${Math.max(...r.p50)} | ${Math.max(...r.p95)} | ${r.blank ? `${r.blank}/${r.cells} cells` : '–'} |`);
  }
  process.exit(0);
}
const dir = new URL('./out/', import.meta.url);
const files = (await readdir(dir)).filter((f) => f.startsWith(what + '-') && f.endsWith('.json')).sort();
for (const f of files) {
  const r = JSON.parse(await readFile(new URL(f, dir), 'utf8'));
  if (what === 'screenshot') {
    console.log(`\n**${r.browser}** ${r.version ?? ''} — backend ${r.backend?.replace(/.*backend /, '') ?? '?'}${r.launchError ? ' — launch failed: ' + r.launchError : ''}\n`);
    console.log('| scenario | method | ok/tries | p50 ms | p95 ms | image | distinct colours | error |');
    console.log('|---|---|---|---|---|---|---|---|');
    for (const c of r.cells) {
      if (c.setupError) {
        console.log(`| ${c.scenario} | (setup) | – | – | – | – | – | ${c.setupError} |`);
        continue;
      }
      console.log(
        `| ${c.scenario} | ${c.method} | ${c.ok}/${c.tries} | ${c.latency.p50 ?? '–'} | ${c.latency.p95 ?? '–'} | ${c.image?.w ?? '–'}×${c.image?.h ?? '–'} | ${c.image?.distinct ?? '–'} | ${(c.errors[0] ?? '').split('\n')[0].replace(/\|/g, '/').slice(0, 90)} |`,
      );
    }
  }
}
