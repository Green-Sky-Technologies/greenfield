/**
 * The Layers tab with the real editor (Story 5.7): the page list (add, rename, switch, delete) and
 * the layer tree (component and instance marks, selection both ways with the canvas,
 * multi-select, rename, lock, hide, collapse, reorder and reparent by drag). Every change is
 * checked in the editor itself, and the tree must follow edits from its events without reading
 * the document again (`inspect` is counted).
 */
import { ref } from '@greenfield/bridge';
import { openEditor, type RemoteEditor } from '@greenfield/bridge/playwright';
import type { Page } from '@playwright/test';
import { createProject, uniqueName } from '../app/support/app';
import { expect, test } from '../app/support/fixtures';

/** A layer's centre in the host page's pixels (as in canvas-mode.spec.ts). */
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

interface Inspected {
  selection: number[];
  currentPage: number;
  pages: { id: number; name?: string; children?: { id: number; children?: { id: number }[] }[] }[];
}

test('layers and pages: the tree follows the editor, and edits from it reach the editor', async ({
  as,
  run,
  problems,
}, testInfo) => {
  const page = await as('editor');
  const projectId = await createProject(page, run.org.slug, uniqueName('Layers'));
  const editor = await openEditor(page, { hostPath: `/w/${run.org.slug}/p/${projectId}` });
  await expect(page.getByTestId('editor-status')).toHaveAttribute('data-status', 'empty');
  await editor.execute('file.new', {});

  const left = page.getByRole('complementary', { name: 'Left panel' });
  await left.getByRole('tab', { name: 'Layers' }).click();
  const tree = left.getByRole('tree', { name: 'Layers' });
  const row = (name: string) => tree.getByRole('treeitem', { name, exact: true });
  const names = () => tree.getByRole('treeitem').evaluateAll((els) => els.map((e) => e.ariaLabel));
  const doc = async () =>
    (await editor.inspect({ depth: 2, fields: ['name'] })) as unknown as Inspected;
  const selection = async () => [...(await doc()).selection].sort();
  const node = (id: number) =>
    editor.getNode(id, { depth: 0 }) as Promise<{
      name: string;
      locked?: boolean;
      visible?: boolean;
    }>;

  const [card, title, swatch, , , note] = (await editor.batch(
    [
      {
        command: 'node.create',
        as: 'card',
        params: { type: 'frame', name: 'Card', x: 0, y: 0, width: 400, height: 300 },
      },
      {
        command: 'node.create',
        params: {
          type: 'text',
          name: 'Title',
          characters: 'Hello',
          parent: ref('card'),
          x: 20,
          y: 20,
        },
      },
      {
        command: 'node.create',
        params: {
          type: 'rectangle',
          name: 'Swatch',
          parent: ref('card'),
          x: 120,
          y: 90,
          width: 160,
          height: 120,
        },
      },
      {
        command: 'node.create',
        as: 'button',
        params: { type: 'component', name: 'Button', x: 500, y: 0, width: 120, height: 40 },
      },
      { command: 'instance.create', params: { component: ref('button'), x: 500, y: 100 } },
      {
        command: 'node.create',
        params: { type: 'text', name: 'Note', characters: 'Note', x: 500, y: 200 },
      },
    ],
    { label: 'Add layers' },
  )) as { id: number }[];
  await editor.execute('view.zoomFit', {});

  // The tree, front-most first; component and instance rows marked.
  await expect.poll(names).toEqual(['Note', 'Button', 'Button', 'Card', 'Swatch', 'Title']);
  await expect(tree.locator('[data-mark="main"]')).toHaveAccessibleName('Button');
  await expect(tree.locator('[data-mark="instance"]')).toHaveCount(1);
  await expect(row('Card')).toHaveAttribute('aria-expanded', 'true');

  // From here on, edits must patch the tree, not read the document again: count the store's full
  // reads (depth 64, `reads.ts`; this test's own reads are shallower).
  await page.evaluate(() => {
    const e = window.__greenfieldBridge!.editor;
    const inspect = e.inspect.bind(e);
    (window as unknown as { __inspects: number }).__inspects = 0;
    e.inspect = (...a) => {
      if (a[0]?.depth === 64) (window as unknown as { __inspects: number }).__inspects++;
      return inspect(...a);
    };
  });
  const inspects = () =>
    page.evaluate(() => (window as unknown as { __inspects: number }).__inspects);

  // Canvas → list: a click on the canvas selects the row.
  const at = await layerPoint(page, editor, swatch!.id);
  await page.mouse.click(at.x, at.y);
  await expect(row('Swatch')).toHaveAttribute('aria-selected', 'true');

  // List → canvas: click, Shift-click a range, Cmd/Ctrl-click one more.
  await row('Title').click();
  await expect.poll(selection).toEqual([title!.id]);
  await row('Swatch').click({ modifiers: ['Shift'] });
  await expect.poll(selection).toEqual([swatch!.id, title!.id].sort());
  await row('Note').click({ modifiers: ['ControlOrMeta'] });
  await expect.poll(selection).toEqual([swatch!.id, title!.id, note!.id].sort());
  await expect(tree.getByRole('treeitem', { selected: true })).toHaveCount(3);

  // Rename by double-click.
  await row('Swatch').dblclick();
  await tree.getByRole('textbox', { name: 'Layer name' }).fill('Accent');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await node(swatch!.id)).name).toBe('Accent');
  await expect(row('Accent')).toBeVisible();

  // Lock and hide from the row.
  await row('Accent').hover();
  await row('Accent').getByRole('button', { name: 'Lock Accent' }).click();
  await expect.poll(async () => (await node(swatch!.id)).locked).toBe(true);
  await row('Accent').getByRole('button', { name: 'Hide Accent' }).click();
  await expect.poll(async () => (await node(swatch!.id)).visible).toBe(false);
  await expect(row('Accent').getByRole('button', { name: 'Unlock Accent' })).toBeVisible();
  await expect(row('Accent').getByRole('button', { name: 'Show Accent' })).toBeVisible();

  // Collapse; a selection made elsewhere expands to it again.
  await row('Card').locator('[data-action="toggle"]').click();
  await expect(row('Card')).toHaveAttribute('aria-expanded', 'false');
  await expect(row('Title')).toHaveCount(0);
  await editor.execute('select.set', { ids: [title!.id] });
  await expect(row('Title')).toHaveAttribute('aria-selected', 'true');
  await expect(row('Card')).toHaveAttribute('aria-expanded', 'true');

  // Reorder by drag: Title above Accent puts it in front, inside Card.
  const children = async (id: number) => {
    const d = await doc();
    const top = d.pages.find((p) => p.id === d.currentPage)!.children ?? [];
    return (top.find((c) => c.id === id)?.children ?? []).map((c) => c.id);
  };
  expect(await children(card!.id)).toEqual([title!.id, swatch!.id]);
  await row('Title').dragTo(row('Accent'), { targetPosition: { x: 80, y: 3 } });
  await expect.poll(() => children(card!.id)).toEqual([swatch!.id, title!.id]);
  await expect.poll(names).toEqual(['Note', 'Button', 'Button', 'Card', 'Title', 'Accent']);

  // Reparent by drag: Note into Card (its front-most child).
  await row('Note').dragTo(row('Card'), { targetPosition: { x: 80, y: 14 } });
  await expect.poll(() => children(card!.id)).toEqual([swatch!.id, title!.id, note!.id]);
  await expect.poll(names).toEqual(['Button', 'Button', 'Card', 'Note', 'Title', 'Accent']);
  await expect(row('Note')).toHaveAttribute('aria-level', '2');

  // Undo comes back as the editor's events too.
  await editor.execute('edit.undo', {});
  await expect.poll(names).toEqual(['Note', 'Button', 'Button', 'Card', 'Title', 'Accent']);
  const inspectsDuringEdits = await inspects();

  await left.screenshot({
    path: `${testInfo.project.outputDir}/layers-${testInfo.project.name}.png`,
  });

  // Pages: add, switch, rename, delete.
  const pages = left.getByRole('list', { name: 'Pages' });
  const firstPage = (await doc()).currentPage;
  await left.getByRole('button', { name: 'Add page' }).click();
  await expect(pages.getByRole('listitem')).toHaveCount(2);
  await pages.getByRole('button', { name: 'Page 2', exact: true }).click();
  await expect(pages.getByRole('button', { name: 'Page 2', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect.poll(async () => (await doc()).currentPage).not.toBe(firstPage);
  await expect(tree).toContainText('No layers on this page');
  await pages.getByRole('button', { name: 'Page 2', exact: true }).dblclick();
  await pages.getByRole('textbox', { name: 'Page name' }).fill('Pricing');
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => {
      const d = await doc();
      return d.pages.find((p) => p.id === d.currentPage)?.name;
    })
    .toBe('Pricing');
  await pages.getByRole('button', { name: 'Page 1', exact: true }).click();
  await expect.poll(async () => (await doc()).currentPage).toBe(firstPage);
  await expect(row('Card')).toBeVisible();
  await pages.getByRole('listitem').filter({ hasText: 'Pricing' }).hover();
  await pages.getByRole('button', { name: 'Delete page Pricing' }).click();
  await expect(pages.getByRole('listitem')).toHaveCount(1);
  await expect.poll(async () => (await doc()).pages.length).toBe(1);

  // Nothing in the edits above read the document again (page switches do, by design).
  expect(inspectsDuringEdits).toBe(0);

  // Known noise from outside the panel (as in shell.spec.ts): Clerk's FAPI retries fail CORS in
  // Playwright WebKit now and then, and in WebKit the editor's keyboard input trips its own
  // style-src CSP (the fork's to fix).
  const noise =
    /clerk\.accounts\.dev.*access control checks|\[editor\] CSP: Refused to apply a stylesheet/;
  problems.splice(0, problems.length, ...problems.filter((p) => !noise.test(p)));
});
