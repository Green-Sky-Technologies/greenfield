#!/usr/bin/env node
/**
 * Download the pinned upstream figcraft-web release, verify its sha256 and unpack it into
 * apps/web/public/editor/ (gitignored), so the app serves the editor at /editor/. Runs before
 * `dev` and `build` (package.json `predev`/`prebuild`, scripts/vercel-build.mjs) and does
 * nothing when the pinned version is already there. Epic 2 swaps the release for the fork's
 * CI bundle.
 *
 *   node scripts/fetch-editor.mjs          # from apps/web; skip if already there
 *   node scripts/fetch-editor.mjs --force  # re-download
 *
 * Needs `unzip` on PATH (macOS, most Linux images, Vercel's build image).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '0.18.1';
const URL_ = `https://github.com/storytold/figcraft/releases/download/v${VERSION}/figcraft-web-${VERSION}.zip`;
const SHA256 = '2fbeb93f5022b0a7cc9d8528f1ed7e2b54c94d213ef79e65128aa898c399f02b';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); // apps/web
const dest = path.join(root, 'public/editor');
const stamp = path.join(dest, '.figcraft-version');

if (!process.argv.includes('--force') && fs.existsSync(stamp)) {
  if (fs.readFileSync(stamp, 'utf8').trim() === `${VERSION} ${SHA256}`) {
    console.log(`figcraft-web ${VERSION} already in ${path.relative(root, dest)}`);
    process.exit(0);
  }
}

const t0 = performance.now();
const res = await fetch(URL_, { redirect: 'follow' });
if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
const zip = Buffer.from(await res.arrayBuffer());
const sha = createHash('sha256').update(zip).digest('hex');
if (sha !== SHA256) throw new Error(`sha256 mismatch for ${URL_}: got ${sha}, want ${SHA256}`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'figcraft-web-'));
try {
  const zipPath = path.join(tmp, 'release.zip');
  fs.writeFileSync(zipPath, zip);
  const out = path.join(tmp, 'out');
  execFileSync('unzip', ['-q', zipPath, '-d', out], { stdio: 'inherit' });
  const top = path.join(out, `figcraft-web-${VERSION}`);
  if (!fs.existsSync(path.join(top, 'index.html'))) throw new Error('Unexpected archive layout');
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(top, dest, { recursive: true });
  fs.writeFileSync(stamp, `${VERSION} ${SHA256}\n`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

const wasm = fs.readdirSync(dest).find((f) => f.endsWith('.wasm'));
const wasmBytes = wasm ? fs.statSync(path.join(dest, wasm)).size : 0;
console.log(
  `figcraft-web ${VERSION}: zip ${zip.length} B (sha256 ok), wasm ${wasmBytes} B ` +
    `(${(wasmBytes / 2 ** 20).toFixed(1)} MiB) -> ${path.relative(root, dest)} ` +
    `in ${Math.round(performance.now() - t0)} ms`,
);
