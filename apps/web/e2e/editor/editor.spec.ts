/**
 * The project page's embedded editor (Story 1.2, from the 0.1 spike; Stories 3.1 and 3.7): a new
 * project opens on a blank document, edit, Save sends the bytes to the host and they land in
 * storage; reopening restores the exact document; dirty state reaches the host; a 20 MB document
 * saves and reopens. Per browser.
 */
import fs from 'node:fs';
import path from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import type { Frame, Page } from '@playwright/test';
import { createProject, pageFetch, uniqueName } from '../app/support/app';
import { expect, test } from '../app/support/fixtures';

declare global {
  interface Window {
    figcraft: {
      execute(command: string, params?: unknown): Promise<unknown>;
      request(method: string, params?: unknown): Promise<unknown>;
      docInspect(params?: unknown): Promise<unknown>;
    };
  }
}

const status = (page: Page) => page.getByTestId('editor-status');

async function editorFrame(page: Page): Promise<Frame> {
  await expect
    .poll(() => page.frames().some((f) => f.url().includes('/editor/index.html')))
    .toBe(true);
  const frame = page.frames().find((f) => f.url().includes('/editor/index.html'))!;
  await frame.waitForFunction(() => typeof window.figcraft?.execute === 'function');
  return frame;
}

/** Names of every node in the open document (depth-first). */
async function nodeNames(frame: Frame): Promise<string[]> {
  return frame.evaluate(async () => {
    const doc = (await window.figcraft.docInspect({})) as { pages?: unknown[] };
    const names: string[] = [];
    const walk = (n: { name?: string; children?: unknown[] }) => {
      if (n.name) names.push(n.name);
      for (const c of n.children ?? []) walk(c as typeof n);
    };
    for (const p of doc.pages ?? []) walk(p as { children?: unknown[] });
    return names;
  });
}

async function createFrame(frame: Frame, name: string, x: number) {
  await frame.evaluate(
    ([name, x]) =>
      window.figcraft.execute('node.create', {
        type: 'frame',
        name,
        x,
        y: 0,
        width: 240,
        height: 160,
      }),
    [name, x] as const,
  );
}

/**
 * Save the way a person does, through the editor's own shortcut handling. FigCraft maps Save to
 * Cmd+S when the browser reports a Mac (Playwright's WebKit device) and Ctrl+S otherwise.
 */
async function save(frame: Frame) {
  await frame.evaluate(async () => {
    try {
      await window.figcraft.request('ui.key', { key: 'S', ctrl: true });
    } catch (e) {
      if (!String(e).includes('no shortcut')) throw e;
      await window.figcraft.request('ui.key', { key: 'S', cmd: true });
    }
  });
}

async function openEditor(page: Page, url: string) {
  const t0 = Date.now();
  await page.goto(url);
  await expect(status(page)).not.toHaveAttribute('data-ready-ms', '', { timeout: 120_000 });
  const readyWallMs = Date.now() - t0;
  const readyMs = Number(await status(page).getAttribute('data-ready-ms'));
  return { readyWallMs, readyMs, frame: await editorFrame(page) };
}

/**
 * The whole document as the editor describes it (pages, nodes and their properties), without the
 * session state a reload resets (undo history, selection).
 */
async function snapshot(frame: Frame): Promise<string> {
  return frame.evaluate(async () => {
    const doc = (await window.figcraft.docInspect({})) as Record<string, unknown>;
    for (const k of ['history', 'selection', 'textEdit', 'dirty', 'revision']) delete doc[k];
    return JSON.stringify(doc);
  });
}

/** An RGB PNG of random pixels, stored uncompressed: about 3 bytes per pixel, incompressible. */
function noisePng(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let i = 0; i < rows.length; i++) rows[i] = (Math.random() * 256) | 0;
  for (let y = 0; y < height; y++) rows[y * (width * 3 + 1)] = 0; // filter: none
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows, { level: 0 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function stored(page: Page, projectId: string) {
  const r = await pageFetch(page, `/api/projects/${projectId}/file`);
  return r.status;
}

test('editor: open from the projects list, edit, save, reopen', async ({
  as,
  run,
  problems,
}, testInfo) => {
  const browser = testInfo.project.name;
  const page = await as('editor');
  page.on('pageerror', (e) => console.log(`[${browser}] pageerror: ${e.message}`));
  // WebGL2 unless FIGCRAFT_WEBGPU=1: headless browsers have no usable WebGPU adapter.
  const flag = process.env.FIGCRAFT_WEBGPU === '1' ? '' : '?webgl';

  const name = uniqueName('Editor');
  const projectId = await createProject(page, run.org.slug, name);
  const url = `/w/${run.org.slug}/p/${projectId}${flag}`;
  const metrics: Record<string, unknown> = { browser, webgl: flag !== '' };

  // 0. The projects list shows the new project, and opening it shows the editor.
  await page.goto(`/w/${run.org.slug}`);
  await page.getByRole('link', { name: `Open ${name}` }).click();
  await page.waitForURL(new RegExp(`/p/${projectId}$`));
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await expect(page.getByTitle('Design canvas')).toBeVisible();
  await expect(status(page)).not.toHaveAttribute('data-ready-ms', '', { timeout: 120_000 });

  // 1. First load: nothing stored yet. The host opens a blank document (Story 3.7), not the
  //    editor's home screen, and this tab holds the edit lock. Edit it and save it.
  let { readyMs, readyWallMs, frame } = await openEditor(page, url);
  metrics.firstReadyMs = readyMs;
  metrics.firstReadyWallMs = readyWallMs;
  await expect(status(page)).toHaveAttribute('data-status', 'empty');
  await expect(status(page)).toHaveAttribute('data-lock', 'held');
  expect(await stored(page, projectId)).toBe(204);
  await expect.poll(() => snapshot(frame).then((s) => JSON.parse(s).pages?.length ?? 0)).toBe(1);
  await createFrame(frame, 'Frame A', 0);
  await expect(status(page)).toHaveAttribute('data-dirty', 'true');
  let t = Date.now();
  await save(frame);
  await expect(status(page)).toHaveAttribute('data-saves', '1');
  metrics.firstSaveWallMs = Date.now() - t;
  metrics.firstSaveBytes = Number(await status(page).getAttribute('data-save-size'));
  metrics.storage = await status(page).getAttribute('data-storage');
  metrics.firstSaveMessage = await status(page).getAttribute('data-last-save');
  expect(metrics.firstSaveMessage).toMatch(new RegExp(`^${name}\\.figcraft saveAs=`));
  expect(await stored(page, projectId)).toBe(200);
  await expect(status(page)).toHaveAttribute('data-dirty', 'false');

  // 2. Reload: the document comes from storage. Edit it; dirty reaches the host; save again.
  ({ readyMs, readyWallMs, frame } = await openEditor(page, url));
  metrics.readyMs = readyMs;
  metrics.readyWallMs = readyWallMs;
  t = Date.now();
  await expect(status(page)).toHaveAttribute('data-status', 'opened');
  await expect.poll(() => nodeNames(frame)).toContain('Frame A');
  metrics.openWallMs = Date.now() - t;
  await expect(status(page)).toHaveAttribute('data-dirty', 'false');
  await createFrame(frame, 'Frame B', 300);
  await expect(status(page)).toHaveAttribute('data-dirty', 'true');
  t = Date.now();
  await save(frame);
  await expect(status(page)).toHaveAttribute('data-saves', '1');
  metrics.saveWallMs = Date.now() - t;
  metrics.savePutMs = Number(await status(page).getAttribute('data-save-ms'));
  metrics.saveBytes = Number(await status(page).getAttribute('data-save-size'));
  metrics.saveMessage = await status(page).getAttribute('data-last-save');
  await expect(status(page)).toHaveAttribute('data-dirty', 'false');
  const before = (await nodeNames(frame)).sort();
  const beforeDoc = await snapshot(frame);

  // 3. Reopen: the exact document.
  ({ readyMs, frame } = await openEditor(page, url));
  t = Date.now();
  await expect(status(page)).toHaveAttribute('data-status', 'opened');
  await expect.poll(async () => (await nodeNames(frame)).sort()).toEqual(before);
  metrics.reopenWallMs = Date.now() - t;
  metrics.reopenReadyMs = readyMs;
  expect(before).toEqual(expect.arrayContaining(['Frame A', 'Frame B']));
  expect(await snapshot(frame)).toBe(beforeDoc);

  // 4. A 20 MB document: an incompressible image, saved and reopened.
  const png = noisePng(2650, 2650);
  await frame.evaluate(
    (data) => window.figcraft.execute('image.place', { data, x: 0, y: 400, name: 'Noise' }),
    png.toString('base64'),
  );
  await expect(status(page)).toHaveAttribute('data-dirty', 'true');
  t = Date.now();
  await save(frame);
  await expect(status(page)).toHaveAttribute('data-saves', '1', { timeout: 120_000 }); // counts per page load;
  metrics.bigSaveWallMs = Date.now() - t;
  metrics.bigSaveBytes = Number(await status(page).getAttribute('data-save-size'));
  expect(metrics.bigSaveBytes).toBeGreaterThanOrEqual(20 * 1024 * 1024);
  const bigDoc = await snapshot(frame);
  ({ frame } = await openEditor(page, url));
  await expect(status(page)).toHaveAttribute('data-status', 'opened', { timeout: 120_000 });
  await expect.poll(() => nodeNames(frame), { timeout: 120_000 }).toContain('Noise');
  expect(await snapshot(frame)).toBe(bigDoc);

  // Clerk's FAPI retries fail CORS in Playwright WebKit now and then ("due to access control
  // checks"); that's the sign-in widget, not the editor. Record it instead of failing the test.
  const clerkNoise = problems.filter((p) => /clerk\.accounts\.dev.*access control checks/.test(p));
  if (clerkNoise.length) metrics.ignoredClerkErrors = clerkNoise.length;
  problems.splice(0, problems.length, ...problems.filter((p) => !clerkNoise.includes(p)));

  console.log(`[editor] ${JSON.stringify(metrics)}`);
  const out = path.join(testInfo.project.outputDir, `metrics-${browser}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(metrics, null, 2));
});
