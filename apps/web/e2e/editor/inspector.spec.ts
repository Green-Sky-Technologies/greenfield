/**
 * The Design tab with the real editor (Story 5.8, and 5.5's "changed by Claude · Revert"):
 *
 * - a click on the canvas shows the layer; typed values, a scrub (one undo step), an Esc'd scrub
 *   (no step), fill hex, opacity and blend, an effect, typography and auto layout reach the
 *   editor; several layers show "Mixed" and an edit sets them all;
 * - a reply's change records (seeded in the database the dev server uses: no model call) mark
 *   the fill Claude set once its presence ends; Revert writes the old fill back as one step.
 */
import { openEditor, type RemoteEditor } from '@greenfield/bridge/playwright';
import type { Locator, Page } from '@playwright/test';
import { agentConversations, agentMessages, createDb, eq, projects } from '@greenfield/db';
import { createProject, uniqueName } from '../app/support/app';
import { expect, test } from '../app/support/fixtures';

type Node = Record<string, unknown> & { id: number };

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

const undoDepth = async (editor: RemoteEditor) =>
  (await editor.inspect({ depth: 0, fields: [] })).history.undoDepth ?? 0;
const field = async (editor: RemoteEditor, id: number, f: string) =>
  ((await editor.execute('node.get', { id, fields: [f] })) as Node)[f];

async function typeInto(input: Locator, value: string) {
  await input.click();
  await input.fill(value);
  await input.press('Enter');
}

/** Drag a number field's label by `dx` pixels, in steps; Esc before letting go when `cancel`. */
async function scrub(page: Page, handle: Locator, dx: number, cancel = false) {
  const box = (await handle.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x + (dx * i) / 8, y);
  if (cancel) await page.keyboard.press('Escape');
  await page.mouse.up();
}

/** A finished reply in the project's chat whose change records say Claude set `id`'s fills. */
async function seedClaudeTurn(projectId: string, id: number, before: unknown, after: unknown) {
  const url = process.env.DATABASE_URL ?? '';
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) throw new Error('seed only a local database');
  const { db, close } = createDb(url);
  try {
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    const workspaceId = project!.workspaceId;
    const [conv] = await db
      .insert(agentConversations)
      .values({ workspaceId, projectId, createdBy: 'e2e' })
      .returning();
    await db.insert(agentMessages).values({
      conversationId: conv!.id,
      workspaceId,
      seq: 1,
      role: 'assistant',
      status: 'complete',
      content: {
        v: 1,
        turns: [{ role: 'assistant', content: 'Made the swatch ember.' }],
        changes: [
          {
            id,
            name: 'Swatch',
            type: 'RECTANGLE',
            kind: 'changed',
            fields: [{ field: 'fills', before, after }],
            frame: null,
          },
        ],
        undoLabels: ['Claude: swatch'],
      },
    });
  } finally {
    await close();
  }
}

const NOISE =
  /clerk\.accounts\.dev.*access control checks|\[editor\] CSP: Refused to apply a stylesheet/;

test('the Design tab edits the selection through the real editor', async ({
  as,
  run,
  problems,
}, testInfo) => {
  const page = await as('editor');
  const projectId = await createProject(page, run.org.slug, uniqueName('Inspector'));
  const editor = await openEditor(page, { hostPath: `/w/${run.org.slug}/p/${projectId}` });
  await expect(page.getByTestId('editor-status')).toHaveAttribute('data-status', 'empty');

  const [, swatch, headline, stack] = (await editor.batch(
    [
      {
        command: 'node.create',
        as: 'card',
        params: { type: 'frame', name: 'Card', x: 0, y: 0, width: 480, height: 320 },
      },
      {
        command: 'node.create',
        params: {
          type: 'rectangle',
          name: 'Swatch',
          parent: { $ref: 'card' },
          x: 40,
          y: 40,
          width: 160,
          height: 120,
        },
      },
      {
        command: 'text.create',
        params: { parent: { $ref: 'card' }, characters: 'Headline', x: 240, y: 40 },
      },
      {
        command: 'node.create',
        params: {
          type: 'frame',
          name: 'Stack',
          x: 560,
          y: 0,
          width: 200,
          height: 200,
          props: { layout: 'vertical', gap: 8, padding: 12 },
        },
      },
    ],
    { label: 'Add layers' },
  )) as { id: number }[];
  await editor.execute('view.zoomFit', {});
  const right = page.getByRole('complementary', { name: 'Edit panel' });
  const name = page.getByTestId('design-tab-name');

  // Click on the canvas: the tab shows the layer and its values.
  const at = await layerPoint(page, editor, swatch!.id);
  await page.mouse.click(at.x, at.y);
  await expect(name).toHaveText('Swatch');
  await expect(right.getByLabel('Width')).toHaveValue('160');
  await expect(right.getByLabel('Horizontal constraint')).toHaveValue('left');

  // Typed values.
  await typeInto(right.getByLabel('X position'), '64');
  await expect.poll(() => field(editor, swatch!.id, 'x')).toBe(64);

  // A scrub is one undo step; an Esc'd scrub puts the value back and adds none.
  const depth = await undoDepth(editor);
  await scrub(page, page.getByTestId('design-width-scrub'), 40);
  await expect.poll(() => field(editor, swatch!.id, 'width')).toBe(200);
  await expect(right.getByLabel('Width')).toHaveValue('200');
  expect(await undoDepth(editor)).toBe(depth + 1);
  await scrub(page, page.getByTestId('design-width-scrub'), 60, true);
  await expect.poll(() => field(editor, swatch!.id, 'width')).toBe(200);
  expect(await undoDepth(editor)).toBe(depth + 1);

  // Fill, opacity, blend, radius, constraints, an effect.
  await typeInto(right.getByLabel('Fill 1 hex'), 'ff9a4d');
  await expect
    .poll(() => field(editor, swatch!.id, 'fills'))
    .toEqual([{ type: 'solid', color: '#FF9A4D' }]);
  await typeInto(right.getByLabel('Layer opacity'), '50');
  await expect.poll(() => field(editor, swatch!.id, 'opacity')).toBe(0.5);
  await right.getByLabel('Blend mode').selectOption('multiply');
  await expect.poll(() => field(editor, swatch!.id, 'blend')).toBe('multiply');
  await typeInto(right.getByLabel('Corner radius'), '8');
  await expect.poll(() => field(editor, swatch!.id, 'cornerRadius')).toBe(8);
  await right.getByLabel('Horizontal constraint').selectOption('scale');
  await expect
    .poll(() => field(editor, swatch!.id, 'constraints'))
    .toEqual({ horizontal: 'scale', vertical: 'top' });
  await right.getByRole('button', { name: 'Add effect' }).click();
  await expect(right.getByTestId('effect-row')).toHaveCount(1);
  await typeInto(right.getByLabel('Effect 1 radius'), '12');
  await expect
    .poll(
      async () => ((await field(editor, swatch!.id, 'effects')) as { radius: number }[])[0]?.radius,
    )
    .toBe(12);

  // Typography.
  await editor.execute('select.set', { ids: [headline!.id] });
  await expect(name).toHaveText('Headline');
  const type = right.getByRole('region', { name: 'Typography' });
  await expect(type.getByLabel('Font family')).toHaveText('Inter');
  await typeInto(type.getByLabel('Font size'), '32');
  await expect.poll(() => field(editor, headline!.id, 'fontSize')).toBe(32);
  await typeInto(type.getByLabel('Line height'), '140%');
  await expect.poll(() => field(editor, headline!.id, 'lineHeight')).toBe('140%');
  await type.getByLabel('Font weight').selectOption('Bold');
  await expect.poll(() => field(editor, headline!.id, 'fontStyle')).toBe('Bold');
  await type.getByRole('button', { name: 'Align center' }).click();
  await expect.poll(() => field(editor, headline!.id, 'textAlign')).toBe('center');

  // Auto layout.
  await editor.execute('select.set', { ids: [stack!.id] });
  await expect(name).toHaveText('Stack');
  const layout = right.getByRole('region', { name: 'Auto layout' });
  await typeInto(layout.getByLabel('Gap'), '20');
  await typeInto(layout.getByLabel('Horizontal padding'), '24');
  await layout.getByRole('button', { name: 'Horizontal' }).click();
  await layout.getByLabel('Vertical resizing').selectOption('hug');
  await expect
    .poll(async () => {
      const l = (await field(editor, stack!.id, 'layout')) as Record<string, unknown>;
      return [l.mode, l.gap, l.padding];
    })
    .toEqual(['horizontal', 20, [12, 24, 12, 24]]);
  await expect
    .poll(() => field(editor, stack!.id, 'sizing'))
    .toEqual({ horizontal: 'fixed', vertical: 'hug' });

  // Several layers: shared values, "Mixed", and an edit sets them all.
  await editor.execute('select.set', { ids: [swatch!.id, headline!.id] });
  await expect(name).toHaveText('2 layers');
  await expect(right.getByLabel('X position')).toHaveAttribute('placeholder', 'Mixed');
  await expect(right.getByLabel('Y position')).toHaveValue('40');
  await typeInto(right.getByLabel('Y position'), '24');
  await expect
    .poll(async () => [
      await field(editor, swatch!.id, 'y'),
      await field(editor, headline!.id, 'y'),
    ])
    .toEqual([24, 24]);
  await page.screenshot({
    path: `${testInfo.project.outputDir}/inspector-${testInfo.project.name}.png`,
  });

  // Claude's last turn set the swatch's fill: marked once its presence ends; Revert puts it back.
  const before = [{ type: 'solid', color: '#14150F' }];
  const after = [{ type: 'solid', color: '#FF9A4D' }];
  await seedClaudeTurn(projectId, swatch!.id, before, after);
  await editor.execute('select.set', { ids: [swatch!.id] });
  await editor.execute('agent.presence', { name: 'Claude', active: true, ids: [swatch!.id] });
  const claudeActive = () =>
    page.evaluate(() => window.__greenfieldStore?.getState().agent?.active);
  await expect.poll(claudeActive).toBe(true);
  await editor.execute('agent.presence', { name: 'Claude', active: false });
  await expect.poll(claudeActive, { timeout: 15_000 }).toBe(false);
  const fill = right.getByRole('region', { name: 'Fill' });
  const note = fill.getByTestId('changed-by-claude');
  await expect(note).toContainText('Fill changed by Claude, just now');
  await expect(fill.getByTestId('fill-row')).toHaveAttribute('data-changed', 'true');
  await page.screenshot({
    path: `${testInfo.project.outputDir}/inspector-claude-${testInfo.project.name}.png`,
  });
  const beforeRevert = await undoDepth(editor);
  await note.getByRole('button', { name: /Revert/ }).click();
  await expect.poll(() => field(editor, swatch!.id, 'fills')).toEqual(before);
  await expect(note).toBeHidden();
  expect(await undoDepth(editor)).toBe(beforeRevert + 1);
  // Known WebKit noise from outside the inspector (as in canvas-mode.spec.ts): Clerk's FAPI
  // retries fail CORS now and then, and keyboard input trips the editor's own style-src CSP.
  problems.splice(0, problems.length, ...problems.filter((p) => !NOISE.test(p)));
});
