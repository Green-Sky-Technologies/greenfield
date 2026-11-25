/**
 * The top bar's tools, the context menu and the floating toolbar with the real editor in canvas
 * mode (Stories 5.1 and 5.10):
 *
 * - 5.1: the tool row shows the canvas's tool (from `tool.changed`, whether set by a click here or
 *   a key on the canvas) and sets it with `tool.*`.
 * - 5.10: a right-click on the canvas opens our menu at the pointer for the clicked layer; its
 *   items run the editor's commands (duplicate, hide/show, group, copy and paste here); it is
 *   keyboard driven (Shift+F10 on the canvas, arrows, Enter, Esc back to the canvas) and opens
 *   "Comment or ask" at the layer. With the edit panel hidden, the floating toolbar sits over the
 *   selection, follows zoom, takes focus with Alt+F10 and runs Create component.
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
    return a?.getAttribute('aria-label') ?? a?.textContent?.trim() ?? null;
  });

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A layer's box in the host page's pixels. */
async function layerBox(page: Page, editor: RemoteEditor, id: number): Promise<Box> {
  const node = (await editor.getNode(id, { fields: ['absoluteBounds'] })) as unknown as {
    absoluteBounds: Box;
  };
  const ui = (await editor.request('ui.inspect')) as {
    canvas: { rect: [number, number, number, number] };
  };
  const view = (await editor.execute('view.get', {})) as { zoom: number; cx: number; cy: number };
  const frame = (await page.getByTitle('Design canvas').boundingBox())!;
  const [rx, ry, rw, rh] = ui.canvas.rect;
  const b = node.absoluteBounds;
  return {
    x: frame.x + rx + rw / 2 + (b.x - view.cx) * view.zoom,
    y: frame.y + ry + rh / 2 + (b.y - view.cy) * view.zoom,
    width: b.width * view.zoom,
    height: b.height * view.zoom,
  };
}
const centre = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

/** The current page's layers, depth-first: name, type and visibility. */
async function layers(editor: RemoteEditor) {
  const doc = await editor.inspect({ depth: 8, fields: ['name', 'type', 'visible'] });
  const page = doc.pages.find((p) => p.id === doc.currentPage)!;
  const out: { id: number; name: string; type: string; visible: boolean }[] = [];
  const walk = (n: { id: number; children?: unknown[] } & Record<string, unknown>) => {
    for (const c of (n.children ?? []) as (typeof n)[]) {
      out.push({
        id: c.id,
        name: c.name as string,
        type: c.type as string,
        visible: c.visible !== false,
      });
      walk(c);
    }
  };
  walk(page as never);
  return out;
}

const noise =
  /clerk\.accounts\.dev.*access control checks|\[editor\] CSP: Refused to apply a stylesheet/;

test('tool row, context menu and floating toolbar on the real canvas', async ({
  as,
  run,
  problems,
}, testInfo) => {
  const page = await as('editor');
  const projectId = await createProject(page, run.org.slug, uniqueName('Menus'));
  const editor = await openEditor(page, { hostPath: `/w/${run.org.slug}/p/${projectId}` });
  await expect(page.getByTestId('editor-status')).toHaveAttribute('data-status', 'empty');
  const platform = platformFromUserAgent(await page.evaluate(() => navigator.userAgent));
  const editorTool = async () =>
    ((await editor.request('ui.inspect')) as { status: { tool: string } }).status.tool;

  const [card, swatch] = (await editor.batch(
    [
      {
        command: 'node.create',
        params: { type: 'frame', name: 'Card', x: 0, y: 0, width: 400, height: 300 },
      },
      {
        command: 'node.create',
        params: { type: 'rectangle', name: 'Swatch', x: 120, y: 90, width: 160, height: 120 },
      },
    ],
    { label: 'Add card' },
  )) as [{ id: number }, { id: number }];
  await editor.execute('view.zoomFit', {});
  await editor.execute('view.zoomOut', {});

  // 5.1: the tool row.
  const tools = page.getByRole('group', { name: 'Tools' });
  for (const name of ['Move (V)', 'Frame (F)', 'Rectangle (R)', 'Pen (P)', 'Text (T)', 'Hand (H)'])
    await expect(tools.getByRole('button', { name })).toBeVisible();
  const move = tools.getByRole('button', { name: 'Move (V)' });
  await expect(move).toHaveAttribute('aria-pressed', 'true');
  await tools.getByRole('button', { name: 'Rectangle (R)' }).click();
  await expect.poll(editorTool).toBe('rectangle');
  await expect(tools.getByRole('button', { name: 'Rectangle (R)' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(move).toHaveAttribute('aria-pressed', 'false');
  expect(await hostFocus(page)).toBe('canvas'); // the tool is used on the canvas
  await page.keyboard.press('t'); // the editor's own key: the row follows its event
  await expect(tools.getByRole('button', { name: 'Text (T)' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('v');
  await expect(move).toHaveAttribute('aria-pressed', 'true');
  await tools.screenshot({
    path: `${testInfo.project.outputDir}/tool-row-${testInfo.project.name}.png`,
  });

  // 5.10: a right-click on the swatch opens our menu at the pointer, for the swatch.
  const menu = page.getByRole('menu', { name: 'Layer actions' });
  const item = (name: string | RegExp) => menu.getByRole('menuitem', { name });
  let at = centre(await layerBox(page, editor, swatch.id));
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await expect(menu).toBeVisible();
  const menuBox = (await menu.boundingBox())!;
  expect(Math.abs(menuBox.x - at.x)).toBeLessThan(2);
  // Below the pointer, or above it where there's no room below.
  expect(
    Math.min(Math.abs(menuBox.y - at.y), Math.abs(menuBox.y + menuBox.height - at.y)),
  ).toBeLessThan(2);
  await expect(item('Copy')).toBeFocused();
  for (const name of [
    'Paste here',
    'Duplicate',
    'Delete',
    'Group selection',
    'Frame selection',
    'Add auto layout',
    'Create component',
    'Bring to front',
    'Send to back',
    'Hide',
    'Lock',
    'Ask Claude about this…',
    'Comment',
  ])
    await expect(item(name)).toBeVisible();
  await expect(item('Copy')).toHaveAttribute(
    'aria-keyshortcuts',
    platform === 'mac' ? 'Meta+C' : 'Control+C',
  );
  await expect(item('Copy')).toContainText(platform === 'mac' ? '⌘C' : 'Ctrl+C');
  await page.screenshot({
    path: `${testInfo.project.outputDir}/context-menu-${testInfo.project.name}.png`,
  });
  // Arrows move; Esc closes and returns to the canvas.
  await page.keyboard.press('ArrowDown');
  await expect(item('Paste here')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(item('Comment')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  expect(await hostFocus(page)).toBe('canvas');

  // Duplicate, by mouse.
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await item('Duplicate').click();
  await expect(menu).toBeHidden();
  await expect.poll(async () => (await layers(editor)).length).toBe(3);
  expect(await hostFocus(page)).toBe('canvas');
  await page.keyboard.press(platform === 'mac' ? 'Meta+z' : 'Control+z');
  await expect.poll(async () => (await layers(editor)).length).toBe(2);

  // Hide and show by keyboard: Shift+F10 on the canvas opens the menu for the selection.
  await page.mouse.click(at.x, at.y);
  await page.keyboard.press('Shift+F10');
  await expect(menu).toBeVisible();
  await item('Hide').focus();
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => (await layers(editor)).find((l) => l.id === swatch.id)?.visible)
    .toBe(false);
  await page.keyboard.press('Shift+F10');
  await expect(item('Show')).toBeVisible();
  await item('Show').click();
  await expect
    .poll(async () => (await layers(editor)).find((l) => l.id === swatch.id)?.visible)
    .toBe(true);

  // Clicking elsewhere closes it.
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await expect(menu).toBeVisible();
  await page.getByRole('banner', { name: 'Project' }).click({ position: { x: 5, y: 5 } });
  await expect(menu).toBeHidden();

  // Copy, then "Paste here" on empty canvas: the copy lands at the pointer.
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await item('Copy').click();
  const cardBox = await layerBox(page, editor, card.id);
  const empty = { x: cardBox.x + cardBox.width + 60, y: cardBox.y + 20 };
  await editor.execute('select.none', {}); // a right-click keeps a selection
  await page.mouse.click(empty.x, empty.y, { button: 'right' });
  await expect(item('Paste here')).toBeVisible();
  await expect(item('Copy')).toHaveCount(0); // nothing under the pointer
  await item('Paste here').click();
  await expect.poll(async () => (await layers(editor)).length).toBe(3);
  const pasted = (await layers(editor)).find((l) => l.name === 'Swatch' && l.id !== swatch.id)!;
  const pastedBox = await layerBox(page, editor, pasted.id);
  expect(Math.abs(pastedBox.x - empty.x)).toBeLessThan(4);
  expect(Math.abs(pastedBox.y - empty.y)).toBeLessThan(4);
  await page.keyboard.press(platform === 'mac' ? 'Meta+z' : 'Control+z');
  await expect.poll(async () => (await layers(editor)).length).toBe(2);

  // Group selection.
  at = centre(await layerBox(page, editor, swatch.id));
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await item('Group selection').click();
  await expect.poll(async () => (await layers(editor)).some((l) => l.type === 'GROUP')).toBe(true);
  await page.keyboard.press(platform === 'mac' ? 'Meta+z' : 'Control+z');
  await expect.poll(async () => (await layers(editor)).some((l) => l.type === 'GROUP')).toBe(false);

  // "Comment" opens the composer at the layer (W2-G's, from `ui.request comment.new`).
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await item('Comment').click();
  await expect(menu).toBeHidden();
  const request = await page.evaluate(() => window.__greenfieldStore!.getState().request);
  expect(request).toMatchObject({ kind: 'comment.new', data: { ids: [swatch.id], ask: false } });
  await page.keyboard.press('Escape');

  // The floating toolbar: over the selection while the edit panel is hidden.
  const toolbar = page.getByRole('toolbar', { name: 'Selection' });
  await page.mouse.click(at.x, at.y);
  await expect(toolbar).toBeHidden();
  await page.keyboard.press(editPanelChord(platform));
  await expect(toolbar).toBeVisible();
  await expect(page.getByTestId('floating-label')).toHaveText('Swatch');
  const above = async () => {
    const t = (await toolbar.boundingBox())!;
    const s = await layerBox(page, editor, swatch.id);
    return Math.abs(t.y + t.height + 8 - s.y) < 2 && Math.abs(t.x - s.x) < 2;
  };
  await expect.poll(above).toBe(true);
  await page.screenshot({
    path: `${testInfo.project.outputDir}/floating-toolbar-${testInfo.project.name}.png`,
  });
  await editor.execute('view.zoomIn', {}); // it follows the canvas
  await expect.poll(above).toBe(true);
  // Alt+F10 from the canvas focuses it; Esc goes back.
  expect(await hostFocus(page)).toBe('canvas');
  await page.keyboard.press('Alt+F10');
  await expect(toolbar.getByRole('button').first()).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(toolbar.getByRole('button', { name: 'Create component' })).toBeFocused();
  await page.keyboard.press('Escape');
  expect(await hostFocus(page)).toBe('canvas');
  await toolbar.getByRole('button', { name: 'Create component' }).click();
  await expect
    .poll(async () => (await layers(editor)).some((l) => l.type === 'COMPONENT'))
    .toBe(true);
  await toolbar.getByRole('button', { name: 'Ask Claude' }).click();
  expect(await page.evaluate(() => window.__greenfieldStore!.getState().request)).toMatchObject({
    kind: 'comment.new',
    data: { ask: true },
  });
  await page.keyboard.press('Escape');
  await page.keyboard.press(editPanelChord(platform));
  await expect(toolbar).toBeHidden();

  problems.splice(0, problems.length, ...problems.filter((p) => !noise.test(p)));
});
