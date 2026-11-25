/**
 * The project page in canvas mode with the real editor (Stories 5.6, 5.4, 5.13):
 *
 * - 5.6: a click on the canvas selects a layer; the Layers and Design stubs, which read
 *   `@greenfield/editor-state`, show it.
 * - 5.4: F6 / Shift+F6 cycle the top bar, left panel, canvas and edit panel; Esc returns to the
 *   canvas; the platform's edit panel chord (Cmd+\ on a Mac, Ctrl+\ elsewhere, never a fixed
 *   Ctrl) hides and shows the edit panel and never reaches the editor's own Show/Hide UI.
 * - 5.13: "Editor panels" brings the editor's own panels back and back again; the selection and
 *   the undo history survive the round trip.
 */
import { platformFromUserAgent } from '@greenfield/bridge';
import { openEditor, type RemoteEditor } from '@greenfield/bridge/playwright';
import type { Page } from '@playwright/test';
import { editPanelChord } from '../../src/features/shell/keys';
import { createProject, uniqueName } from '../app/support/app';
import { expect, test } from '../app/support/fixtures';

const hostFocus = (page: Page) =>
  page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    if (a?.tagName === 'IFRAME') return 'canvas';
    const pane = a?.closest('header[aria-label], aside[aria-label]')?.getAttribute('aria-label');
    return `${pane}: ${a?.getAttribute('aria-label') ?? a?.textContent?.trim()}`;
  });

/** A layer's centre in the host page's pixels: the canvas rect, centred on the view's (cx, cy). */
async function layerPoint(page: Page, editor: RemoteEditor, id: number) {
  const node = (await editor.getNode(id, { fields: ['absoluteBounds'] })) as unknown as {
    absoluteBounds: { x: number; y: number; width: number; height: number };
  };
  const ui = (await editor.request('ui.inspect')) as {
    canvas: { rect: [number, number, number, number] };
  };
  const view = (await editor.execute('view.get', {})) as { zoom: number; cx: number; cy: number };
  const frame = (await page.getByTitle('Design canvas').boundingBox())!;
  const [rx, ry, rw, rh] = ui.canvas.rect;
  const b = node.absoluteBounds;
  return {
    x: frame.x + rx + rw / 2 + (b.x + b.width / 2 - view.cx) * view.zoom,
    y: frame.y + ry + rh / 2 + (b.y + b.height / 2 - view.cy) * view.zoom,
  };
}

const undoDepth = async (editor: RemoteEditor) =>
  (await editor.inspect({ depth: 0, fields: [] })).history.undoDepth;
const editorUi = async (editor: RemoteEditor) =>
  (await editor.request('ui.inspect')) as { canvasMode: boolean; status: { tool: string } };

test('canvas mode: panels follow the canvas, F6 cycles the panes, the fallback round trip', async ({
  as,
  run,
  problems,
}, testInfo) => {
  const page = await as('editor');
  const projectId = await createProject(page, run.org.slug, uniqueName('Canvas'));
  const editor = await openEditor(page, { hostPath: `/w/${run.org.slug}/p/${projectId}` });
  await expect(page.getByTestId('editor-status')).toHaveAttribute('data-status', 'empty');
  await expect.poll(async () => (await editorUi(editor)).canvasMode).toBe(true);

  const left = page.getByRole('complementary', { name: 'Left panel' });
  const right = page.getByRole('complementary', { name: 'Edit panel' });
  const bar = page.getByRole('banner', { name: 'Project' });
  for (const tab of ['Agent', 'Layers', 'Comments', 'Assets'])
    await expect(left.getByRole('tab', { name: tab })).toBeVisible();
  for (const tab of ['Design', 'Prototype', 'Code'])
    await expect(right.getByRole('tab', { name: tab })).toBeVisible();

  // Two layers, made the way the agent makes them (one undo step).
  const [, made] = (await editor.batch(
    [
      {
        command: 'node.create',
        as: 'card',
        params: { type: 'frame', name: 'Card', x: 0, y: 0, width: 400, height: 300 },
      },
      {
        command: 'node.create',
        params: { type: 'rectangle', name: 'Swatch', x: 120, y: 90, width: 160, height: 120 },
      },
    ],
    { label: 'Add card' },
  )) as [unknown, { id: number }];
  await editor.execute('view.zoomFit', {});
  await left.getByRole('tab', { name: 'Layers' }).click();
  const layers = left.getByRole('tree', { name: 'Layers' });
  await expect(layers.getByRole('treeitem')).toHaveCount(2);

  // 5.6: select on the canvas; the stubs show it.
  const swatch = await layerPoint(page, editor, made.id);
  await page.mouse.click(swatch.x, swatch.y);
  await expect(page.getByTestId('design-tab-name')).toHaveText('Swatch');
  await expect(layers.getByRole('treeitem', { selected: true })).toHaveAccessibleName('Swatch');
  await expect(page.getByTestId('design-width')).toHaveValue('160');
  expect(await hostFocus(page)).toBe('canvas');

  // 5.4: F6 cycles the panes and Shift+F6 goes back; Esc returns to the canvas.
  const cycle: string[] = [];
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('F6');
    cycle.push(await hostFocus(page));
  }
  expect(cycle).toEqual([
    'Edit panel: Design',
    'Project: All projects',
    'Left panel: Layers',
    'canvas',
  ]);
  await page.keyboard.press('Shift+F6');
  expect(await hostFocus(page)).toBe('Left panel: Layers');
  await page.keyboard.press('Escape');
  expect(await hostFocus(page)).toBe('canvas');

  // The edit panel chord, from the canvas: our panel hides, the editor's UI doesn't toggle.
  const platform = platformFromUserAgent(await page.evaluate(() => navigator.userAgent));
  await page.keyboard.press(editPanelChord(platform));
  await expect(right).toBeHidden();
  await expect(page.getByTestId('floating-toolbar')).toBeVisible();
  const view = (await editor.execute('view.get', {})) as { ui_hidden: boolean };
  expect(view.ui_hidden).toBe(false);
  await page.keyboard.press('F6'); // the hidden pane is skipped
  expect(await hostFocus(page)).toBe('Project: All projects');
  await page.keyboard.press(editPanelChord(platform)); // from the bar
  await expect(right).toBeVisible();
  await page.keyboard.press('Escape');
  await page.screenshot({
    path: `${testInfo.project.outputDir}/canvas-mode-${testInfo.project.name}.png`,
  });

  // 5.13: the editor's own panels and back, keeping the selection and the undo history.
  await page.keyboard.press('ArrowRight'); // a nudge on the canvas: one more undo step
  await expect.poll(() => undoDepth(editor)).toBe(2);
  const before = { selection: (await editor.inspect({ depth: 0, fields: [] })).selection, undo: 2 };
  const toggle = bar.getByRole('button', { name: 'Use editor panels' });
  await toggle.click();
  await expect.poll(async () => (await editorUi(editor)).canvasMode).toBe(false);
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(left).toBeHidden();
  await expect(right).toBeHidden();
  expect((await editor.inspect({ depth: 0, fields: [] })).selection).toEqual(before.selection);
  expect(await undoDepth(editor)).toBe(before.undo);
  await page.screenshot({
    path: `${testInfo.project.outputDir}/editor-panels-${testInfo.project.name}.png`,
  });
  await toggle.click();
  await expect.poll(async () => (await editorUi(editor)).canvasMode).toBe(true);
  await expect(right).toBeVisible();
  await expect(page.getByTestId('design-tab-name')).toHaveText('Swatch');
  expect((await editor.inspect({ depth: 0, fields: [] })).selection).toEqual(before.selection);
  expect(await undoDepth(editor)).toBe(before.undo);
  // The history still works: Esc back to the canvas, then the platform's Undo undoes the nudge.
  await page.keyboard.press('Escape');
  expect(await hostFocus(page)).toBe('canvas');
  await page.keyboard.press(platform === 'mac' ? 'Meta+z' : 'Control+z');
  await expect.poll(() => undoDepth(editor)).toBe(1);

  // Known noise from outside the shell: Clerk's FAPI retries fail CORS in Playwright WebKit now
  // and then (see editor.spec.ts), and in WebKit the editor's keyboard input trips its own
  // style-src CSP (on main as well; the fork's to fix).
  const noise =
    /clerk\.accounts\.dev.*access control checks|\[editor\] CSP: Refused to apply a stylesheet/;
  problems.splice(0, problems.length, ...problems.filter((p) => !noise.test(p)));
});
