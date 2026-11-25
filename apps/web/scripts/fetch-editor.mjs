#!/usr/bin/env node
/**
 * Download the figcraft-web release pinned in packages/bridge/editor-release.json, verify its sha256 and unpack it into
 * apps/web/public/editor/ (gitignored), so the app serves the editor at /editor/. Runs before
 * `dev` and `build` (package.json `predev`/`prebuild`, scripts/vercel-build.mjs) and does
 * nothing when the pinned version is already there. The pin is either a public download `url` or
 * a release asset (`repo`, `tag`, `asset`) of the private greenfield-editor repo, read with the
 * EDITOR_RELEASE_TOKEN env var (Story 8.1; see scripts/editor-download.mjs), plus the sha256 of
 * the zip. The zip holds the site at its root (the fork's) or inside one top-level folder
 * (upstream's).
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
import { describePin, downloadEditorZip } from './editor-download.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); // apps/web
// The one pin, shared with packages/bridge (its tests fail when its generated types disagree).
const pin = JSON.parse(
  fs.readFileSync(path.join(root, '../../packages/bridge/editor-release.json'), 'utf8'),
);
const VERSION = pin.version;
const SHA256 = pin.sha256;
const dest = path.join(root, 'public/editor');
const stamp = path.join(dest, '.figcraft-version');

if (!process.argv.includes('--force') && fs.existsSync(stamp)) {
  if (fs.readFileSync(stamp, 'utf8').trim() === `${VERSION} ${SHA256}`) {
    console.log(`figcraft-web ${VERSION} already in ${path.relative(root, dest)}`);
    process.exit(0);
  }
}

const t0 = performance.now();
const zip = await downloadEditorZip(pin, process.env);
const sha = createHash('sha256').update(zip).digest('hex');
if (sha !== SHA256)
  throw new Error(`sha256 mismatch for ${describePin(pin)}: got ${sha}, want ${SHA256}`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'figcraft-web-'));
try {
  const zipPath = path.join(tmp, 'release.zip');
  fs.writeFileSync(zipPath, zip);
  const out = path.join(tmp, 'out');
  execFileSync('unzip', ['-q', zipPath, '-d', out], { stdio: 'inherit' });
  const top = [out, ...fs.readdirSync(out).map((d) => path.join(out, d))].find((d) =>
    fs.existsSync(path.join(d, 'index.html')),
  );
  if (!top)
    throw new Error('Unexpected archive layout: no index.html at the root or one level down');
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
