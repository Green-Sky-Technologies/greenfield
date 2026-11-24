// Shared helpers for the Story 0.4 spike scripts.
import { createRequire } from 'node:module';
import { serve } from './serve.mjs';

const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
export const pw = require('@playwright/test');

export const PORT = Number(process.env.PORT ?? 3104);
export const ORIGIN = `http://127.0.0.1:${PORT}`;

let server;
export async function ensureServer() {
  if (server) return;
  try {
    const r = await fetch(`${ORIGIN}/host.html`);
    if (r.ok) return; // already running (node serve.mjs)
  } catch {
    /* start one */
  }
  server = await serve(PORT);
}
export function stopServer() {
  server?.close();
  server = undefined;
}

/** Browser configs. `name` is the label used in tables. */
export const BROWSERS = {
  'chromium-headless': { type: 'chromium', headless: true },
  'chromium-headed': { type: 'chromium', headless: false },
  'chrome-headless': { type: 'chromium', headless: true, channel: 'chrome' },
  'chrome-headed': { type: 'chromium', headless: false, channel: 'chrome' },
  'firefox-headless': { type: 'firefox', headless: true },
  'firefox-headed': { type: 'firefox', headless: false },
  'webkit-headless': { type: 'webkit', headless: true },
  'webkit-headed': { type: 'webkit', headless: false },
};

export async function launch(name, { viewport = { width: 1440, height: 900 } } = {}) {
  const cfg = BROWSERS[name];
  if (!cfg) throw new Error(`unknown browser ${name}`);
  // REAL_BACKGROUND=1: drop Playwright's anti-throttling flags so hidden/minimised tabs behave as
  // they do for a real user (Chromium only).
  const ignoreDefaultArgs =
    process.env.REAL_BACKGROUND && cfg.type === 'chromium'
      ? ['--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding']
      : undefined;
  const browser = await pw[cfg.type].launch({ headless: cfg.headless, channel: cfg.channel, ignoreDefaultArgs });
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  return { browser, context, page, cfg, version: browser.version() };
}

/**
 * Open the host page and wait for `figcraft:ready` and `window.figcraft` in the iframe.
 * `mode`: 'host' (iframe, ?host=parent) or 'direct' (editor page itself with ?control).
 */
export async function openEditor(page, { mode = 'host', extra = '', timeout = 90_000 } = {}) {
  await ensureServer();
  const t0 = Date.now();
  if (mode === 'direct') {
    await page.goto(`${ORIGIN}/editor/index.html?control${extra ? '&' + extra : ''}`);
    await page.waitForFunction(() => !!window.figcraft, null, { timeout });
    return { frame: page.mainFrame(), readyMs: Date.now() - t0 };
  }
  await page.goto(`${ORIGIN}/host.html${extra ? '?extra=' + encodeURIComponent(extra) : ''}`);
  await page.waitForFunction(() => window.hostState?.ready != null, null, { timeout });
  const readyMs = await page.evaluate(() => window.hostState.ready);
  const frame = page.frames().find((f) => f.url().includes('/editor/'));
  await frame.waitForFunction(() => !!window.figcraft, null, { timeout });
  return { frame, readyMs, wallMs: Date.now() - t0 };
}

/** Run fn(...) inside the editor frame with a wall-clock timeout (ms). */
export async function timed(frame, fn, arg, timeoutMs = 35_000) {
  const t = performance.now();
  try {
    const result = await Promise.race([
      frame.evaluate(fn, arg),
      new Promise((_, rej) => setTimeout(() => rej(new Error(`harness timeout ${timeoutMs} ms`)), timeoutMs)),
    ]);
    return { ok: true, ms: performance.now() - t, result };
  } catch (e) {
    return { ok: false, ms: performance.now() - t, error: String(e?.message ?? e).slice(0, 300) };
  }
}

export function stats(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return { n: 0 };
  const q = (p) => v[Math.min(v.length - 1, Math.max(0, Math.ceil(p * v.length) - 1))];
  return {
    n: v.length,
    p50: +q(0.5).toFixed(1),
    p95: +q(0.95).toFixed(1),
    max: +v[v.length - 1].toFixed(1),
    mean: +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1),
  };
}

/** Build `count` nodes with command.batch, in chunks: frames of 10 rects + 1 text. */
export async function generateDoc(frame, count, { chunk = 500 } = {}) {
  return frame.evaluate(
    async ({ count, chunk }) => {
      const t = performance.now();
      let made = 0;
      let boardIndex = 0;
      while (made < count) {
        const commands = [];
        while (commands.length < chunk && made < count) {
          const b = boardIndex++;
          const as = `b${b}`;
          const col = b % 20;
          const row = Math.floor(b / 20);
          commands.push({
            command: 'node.create',
            as,
            params: { type: 'frame', name: `Card ${b}`, x: col * 260, y: row * 200, width: 240, height: 180 },
          });
          made++;
          for (let i = 0; i < 10 && made < count && commands.length < chunk; i++) {
            commands.push({
              command: 'node.create',
              params: {
                type: 'rectangle',
                parent: { $ref: as },
                name: `r${i}`,
                x: 10 + (i % 5) * 44,
                y: 10 + Math.floor(i / 5) * 44,
                width: 36,
                height: 36,
              },
            });
            made++;
          }
          if (made < count && commands.length < chunk) {
            commands.push({
              command: 'node.create',
              params: { type: 'text', parent: { $ref: as }, name: 'label', x: 10, y: 110, text: `Card ${b}` },
            });
            made++;
          }
        }
        await window.figcraft.execute('command.batch', { label: 'gen', commands });
      }
      return { made, ms: performance.now() - t };
    },
    { count, chunk },
  );
}

export function countNodes(inspect) {
  let n = 0;
  const walk = (node) => {
    n++;
    for (const c of node.children ?? []) walk(c);
  };
  for (const p of inspect.pages ?? []) for (const c of p.children ?? []) walk(c);
  return n;
}
