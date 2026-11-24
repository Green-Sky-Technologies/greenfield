/**
 * The project page's embedded editor (Story 1.2, from the 0.1 spike): open a project from the
 * projects list, edit, Save sends the bytes to the host and they land in storage; reopening shows
 * the same document; dirty state reaches the host. Per browser.
 */
import fs from 'node:fs';
import path from 'node:path';
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
  await expect(page.getByTitle('Editor')).toBeVisible();
  await expect(status(page)).not.toHaveAttribute('data-ready-ms', '', { timeout: 120_000 });

  // 1. First load: nothing stored yet. Make a document and save it (Save As -> saveAs: true).
  let { readyMs, readyWallMs, frame } = await openEditor(page, url);
  metrics.firstReadyMs = readyMs;
  metrics.firstReadyWallMs = readyWallMs;
  await expect(status(page)).toHaveAttribute('data-status', 'empty');
  expect(await stored(page, projectId)).toBe(204);
  await frame.evaluate(() => window.figcraft.execute('file.new', {}));
  await createFrame(frame, 'Frame A', 0);
  await expect(status(page)).toHaveAttribute('data-dirty', 'true');
  let t = Date.now();
  await save(frame);
  await expect(status(page)).toHaveAttribute('data-saves', '1');
  metrics.firstSaveWallMs = Date.now() - t;
  metrics.firstSaveBytes = Number(await status(page).getAttribute('data-save-size'));
  metrics.storage = await status(page).getAttribute('data-storage');
  metrics.firstSaveMessage = await status(page).getAttribute('data-last-save');
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

  // 3. Reopen: the same document.
  ({ readyMs, frame } = await openEditor(page, url));
  t = Date.now();
  await expect(status(page)).toHaveAttribute('data-status', 'opened');
  await expect.poll(async () => (await nodeNames(frame)).sort()).toEqual(before);
  metrics.reopenWallMs = Date.now() - t;
  metrics.reopenReadyMs = readyMs;
  expect(before).toEqual(expect.arrayContaining(['Frame A', 'Frame B']));

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
