/**
 * The Prototype and Code tabs on the project page, with the real editor in canvas mode (Story
 * 5.12):
 *
 * - Prototype: a layer picked on the canvas gets a link to another frame from "Add interaction";
 *   trigger, animation, duration and easing edits land in the layer's `interactions` in the
 *   editor; an undo on the canvas shows in the tab (it follows events). A top-level frame becomes
 *   a flow starting point, is renamed in the editor's file, and is removed.
 * - Code: the selected layer's generated code in React and CSS, regenerated after an edit, and
 *   Copy puts it on the clipboard (Chromium, which lets a test read it).
 */
import { openEditor, type RemoteEditor } from '@greenfield/bridge/playwright';
import type { Page } from '@playwright/test';
import { createProject, uniqueName } from '../app/support/app';
import { expect, test } from '../app/support/fixtures';

interface Interaction {
  trigger: { type: string; ms?: number };
  actions: { type: string; dest?: number }[];
  transition: { type: string; direction?: string };
  duration_ms: number;
  easing: unknown;
}

/** A layer's centre in the host page's pixels. */
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

const interactionsOf = async (editor: RemoteEditor, id: number) =>
  ((await editor.getNode(id, { fields: ['interactions'] })) as { interactions?: Interaction[] })
    .interactions ?? [];

test('prototype and code tabs: links, flows and generated code for the selection', async ({
  as,
  run,
}, testInfo) => {
  const page = await as('editor');
  const screenshot = async (name: string) => {
    await page.screenshot({
      path: `${testInfo.project.outputDir}/${name}-${testInfo.project.name}.png`,
    });
  };
  const projectId = await createProject(page, run.org.slug, uniqueName('Prototype'));
  // openEditor reloads the page: let Clerk's requests finish first (WebKit reports an aborted
  // one as a page error).
  await page.waitForLoadState('networkidle');
  const editor = await openEditor(page, { hostPath: `/w/${run.org.slug}/p/${projectId}` });
  await expect(page.getByTestId('editor-status')).toHaveAttribute('data-status', 'empty');

  const [home, pricing, button] = (await editor.batch(
    [
      {
        command: 'node.create',
        params: { type: 'frame', name: 'Home', x: 0, y: 0, width: 400, height: 300 },
      },
      {
        command: 'node.create',
        params: { type: 'frame', name: 'Pricing', x: 600, y: 0, width: 400, height: 300 },
      },
      {
        command: 'node.create',
        params: {
          type: 'rectangle',
          name: 'Button',
          x: 140,
          y: 120,
          width: 120,
          height: 48,
          parent: 2,
        },
      },
    ],
    { label: 'Add screens' },
  )) as { id: number }[];
  await editor.execute('view.zoomFit', {});

  const right = page.getByRole('complementary', { name: 'Edit panel' });
  await right.getByRole('tab', { name: 'Prototype' }).click();
  const tab = page.getByTestId('prototype-tab');

  // Pick the button on the canvas; the tab shows it with no interactions.
  const at = await layerPoint(page, editor, button!.id);
  await page.mouse.click(at.x, at.y);
  await expect(tab.getByText('Button', { exact: true })).toBeVisible();
  await expect(tab.getByText('No interactions.')).toBeVisible();

  // Add interaction: a click-navigate to the other screen.
  await tab.getByRole('button', { name: 'Add interaction' }).click();
  const card = tab.getByRole('group', { name: 'Interaction 1' });
  await expect(card.getByLabel('Interaction 1 destination')).toHaveValue(String(pricing!.id));
  await expect(card.getByLabel('Interaction 1 trigger')).toHaveValue('onClick');
  expect((await interactionsOf(editor, button!.id))[0]!.actions).toEqual([
    { type: 'navigate', dest: pricing!.id },
  ]);

  // Trigger, animation, duration and easing.
  await card.getByLabel('Interaction 1 trigger').selectOption('onHover');
  await card.getByLabel('Interaction 1 animation').selectOption('smartAnimate');
  const duration = card.getByLabel('Interaction 1 duration');
  await duration.fill('450');
  await duration.press('Enter');
  await card.getByLabel('Interaction 1 easing').selectOption('bouncy');
  await expect
    .poll(async () => {
      const [i] = await interactionsOf(editor, button!.id);
      return i && [i.trigger.type, i.transition.type, i.duration_ms, i.easing];
    })
    .toEqual(['onHover', 'smartAnimate', 450, 'bouncy']);
  await expect(duration).toHaveValue('450');

  // An undo on the canvas (not through the tab) shows in the tab.
  await page.getByTitle('Design canvas').focus();
  await editor.execute('edit.undo', {});
  await expect(card.getByLabel('Interaction 1 easing')).toHaveValue('easeOut');
  await screenshot('prototype-tab');

  // The canvas draws the link (and the selection's connection handle) only under this tab.
  const canvas = page.getByTitle('Design canvas');
  const withLinks = await canvas.screenshot();
  await right.getByRole('tab', { name: 'Design' }).click();
  await expect.poll(async () => (await canvas.screenshot()).equals(withLinks)).toBe(false);
  await right.getByRole('tab', { name: 'Prototype' }).click();
  await expect.poll(async () => (await canvas.screenshot()).equals(withLinks)).toBe(true);

  // A flow starting at Home, renamed, then removed.
  await editor.execute('select.set', { ids: [home!.id] });
  await expect(tab.getByText('Home', { exact: true })).toBeVisible();
  await tab.getByRole('button', { name: 'Add starting point' }).click();
  const flows = tab.getByRole('list', { name: 'Flows' });
  await expect(flows).toContainText('Starts at Home');
  const name = flows.getByLabel('Flow name Flow 1');
  await name.fill('Sign up');
  await name.press('Enter');
  await expect(flows.getByLabel('Flow name Sign up')).toBeVisible();
  const page1 = (await editor.inspect({ depth: 0, fields: ['flows'] })).pages[0] as {
    flows?: { name: string; start: number }[];
  };
  expect(page1.flows).toEqual([{ name: 'Sign up', start: home!.id, description: '' }]);
  // Removed: the list follows the page.
  await flows.getByRole('button', { name: 'Remove flow Sign up' }).click();
  await expect(flows.getByRole('listitem')).toHaveCount(0);

  // Code: the button's React, then CSS, regenerated after an edit; Copy.
  await editor.execute('select.set', { ids: [button!.id] });
  await right.getByRole('tab', { name: 'Code' }).click();
  const code = page.getByTestId('code-tab').getByLabel('Generated code');
  await expect(code).toContainText('export function Button()');
  await page.getByTestId('code-tab').getByLabel('Language').selectOption('css');
  await expect(code).toContainText('width: 120px;');
  await editor.execute('node.set', { ids: [button!.id], width: 200 });
  await expect(code).toContainText('width: 200px;');
  if (testInfo.project.name === 'chromium') {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByTestId('code-tab').getByRole('button', { name: 'Copy' }).click();
    await expect(
      page.getByTestId('code-tab').getByRole('button', { name: 'Copied' }),
    ).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      await code.textContent(),
    );
  }
  await screenshot('code-tab');
});
