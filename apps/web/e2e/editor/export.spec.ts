/**
 * Built-in exports (Story 7.1): a Viewer exports a frame and the selection as PNG, JPG, WebP,
 * SVG and PDF from the project page's Export menu; each download is a non-empty file of the
 * right type (magic bytes), rendered by the real editor.
 */
import fs from 'node:fs';
import type { Frame, Page } from '@playwright/test';
import { createProject, uniqueName } from '../app/support/app';
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

async function openEditor(page: Page, url: string): Promise<Frame> {
  await page.goto(url);
  await expect(status(page)).not.toHaveAttribute('data-ready-ms', '', { timeout: 120_000 });
  const frame = page.frames().find((f) => f.url().includes('/editor/index.html'))!;
  await frame.waitForFunction(() => typeof window.figcraft?.execute === 'function');
  return frame;
}

const ascii = (b: Buffer, start: number, end: number) => b.subarray(start, end).toString('latin1');

/** The file type the bytes say they are. */
function sniff(b: Buffer): string | null {
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'webp';
  if (ascii(b, 0, 5) === '%PDF-') return 'pdf';
  if (/^(<\?xml[^>]*>\s*)?<svg[\s>]/.test(ascii(b, 0, 256))) return 'svg';
  return null;
}

test('export: a viewer downloads PNG, JPG, WebP, SVG and PDF', async ({ as, run, problems }) => {
  const flag = process.env.FIGCRAFT_WEBGPU === '1' ? '' : '?webgl';

  // An editor makes a document with a frame and saves it.
  const editor = await as('editor');
  const projectId = await createProject(editor, run.org.slug, uniqueName('Export'));
  const url = `/w/${run.org.slug}/p/${projectId}${flag}`;
  let frame = await openEditor(editor, url);
  await frame.evaluate(async () => {
    await window.figcraft.execute('file.new', {});
    const card = (await window.figcraft.execute('node.create', {
      type: 'frame',
      name: 'Card',
      width: 240,
      height: 160,
      props: { fill: '#3366ff' },
    })) as { id: number };
    await window.figcraft.execute('node.create', { type: 'text', parent: card.id, text: 'Hi' });
  });
  await frame.evaluate(async () => {
    try {
      await window.figcraft.request('ui.key', { key: 'S', ctrl: true });
    } catch (e) {
      if (!String(e).includes('no shortcut')) throw e;
      await window.figcraft.request('ui.key', { key: 'S', cmd: true });
    }
  });
  await expect(status(editor)).toHaveAttribute('data-saves', '1');

  // A viewer opens it and exports.
  const viewer = await as('viewer');
  frame = await openEditor(viewer, url);
  await expect(status(viewer)).toHaveAttribute('data-status', 'opened');
  await expect
    .poll(() =>
      frame.evaluate(async () => JSON.stringify(await window.figcraft.docInspect({ depth: 1 }))),
    )
    .toContain('"Card"');

  const menu = viewer.getByRole('button', { name: 'Export', exact: true });
  const dialog = viewer.getByRole('dialog', { name: 'Export' });
  await menu.click();
  await dialog.getByLabel('Layer').selectOption({ label: 'Card' });

  for (const format of ['png', 'jpg', 'webp', 'svg', 'pdf']) {
    await dialog.getByLabel('Format').selectOption(format);
    const [download] = await Promise.all([
      viewer.waitForEvent('download'),
      dialog.getByRole('button', { name: /^Export / }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(`Card.${format}`);
    const bytes = fs.readFileSync((await download.path())!);
    expect(bytes.length, format).toBeGreaterThan(0);
    expect(sniff(bytes), format).toBe(format);
  }

  // The selection, at 2x.
  await frame.evaluate(async () => {
    const doc = (await window.figcraft.docInspect({ depth: 1 })) as {
      pages: { children?: { id: number; name: string }[] }[];
    };
    const card = doc.pages[0]!.children!.find((n) => n.name === 'Card')!;
    await window.figcraft.execute('select.set', { ids: [card.id] });
  });
  await menu.click(); // close
  await menu.click(); // reopen: the targets are read again
  await expect(dialog.getByLabel('Layer')).toHaveValue('selection');
  await dialog.getByLabel('Format').selectOption('png');
  await dialog.getByLabel('Scale').selectOption('2');
  const [download] = await Promise.all([
    viewer.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Export PNG' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('Card@2x.png');
  const png = fs.readFileSync((await download.path())!);
  expect(sniff(png)).toBe('png');
  expect(png.readUInt32BE(16)).toBe(480); // IHDR width: 240 px at 2x

  const clerkNoise = problems.filter((p) => /clerk\.accounts\.dev.*access control checks/.test(p));
  problems.splice(0, problems.length, ...problems.filter((p) => !clerkNoise.includes(p)));
});
