/**
 * Comment or ask (Story 6.2) and the Comments list (6.4) on the project page, with the real editor
 * in canvas mode:
 *
 * - The comment tool's click opens our composer beside the layer under it; Comment leaves a
 *   thread pinned to that layer, in the file.
 * - The Comments tab lists it; choosing it selects its layer; Reply and Resolve write to the file.
 * - C with a layer selected opens the composer on it; Ask Claude leaves the thread and hands the
 *   agent pane a turn scoped to that layer with the thread as context, in one action: the
 *   `greenfield:ask-claude` event (the agent pane runs it: agent-pane.spec.ts).
 * - Our context menu's `comment.new` with layer ids and `ask: true` (lane W2-D).
 */
import type { CommentThread } from '@greenfield/bridge';
import { openEditor, type RemoteEditor } from '@greenfield/bridge/playwright';
import type { Page } from '@playwright/test';
import { createProject, uniqueName } from '../app/support/app';
import { expect, test } from '../app/support/fixtures';

/** A page point in the host page's pixels. */
async function pagePoint(page: Page, editor: RemoteEditor, x: number, y: number) {
  const ui = (await editor.request('ui.inspect')) as {
    canvas: { rect: [number, number, number, number] };
  };
  const view = (await editor.execute('view.get', {})) as { zoom: number; cx: number; cy: number };
  const frame = (await page.getByTitle('Design canvas').boundingBox())!;
  const [rx, ry, rw, rh] = ui.canvas.rect;
  return {
    x: frame.x + rx + rw / 2 + (x - view.cx) * view.zoom,
    y: frame.y + ry + rh / 2 + (y - view.cy) * view.zoom,
  };
}

const threads = async (editor: RemoteEditor) =>
  ((await editor.execute('comment.list', { page: 'all' })) as { comments: CommentThread[] })
    .comments;

const selection = async (editor: RemoteEditor) =>
  (await editor.inspect({ depth: 0, fields: [] })).selection;

/** Every `greenfield:ask-claude` the page dispatches from now on. */
async function asks(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __asks: unknown[] };
    w.__asks = [];
    window.addEventListener('greenfield:ask-claude', (e) =>
      w.__asks.push((e as CustomEvent).detail),
    );
  });
  return () =>
    page.evaluate(
      () => (window as unknown as { __asks: { prompt: string; scope: number[] }[] }).__asks,
    );
}

test('comment or ask on an element, and the comments list', async ({
  as,
  run,
  problems,
}, testInfo) => {
  const page = await as('editor');
  const projectId = await createProject(page, run.org.slug, uniqueName('Comments'));
  const editor = await openEditor(page, { hostPath: `/w/${run.org.slug}/p/${projectId}` });
  await expect(page.getByTestId('editor-status')).toHaveAttribute('data-status', 'empty');
  await editor.execute('file.new', {});
  const [card, swatch] = (await editor.batch(
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
  )) as [{ id: number }, { id: number }];
  await editor.execute('view.zoomFit', {});

  const composer = page.getByRole('dialog', { name: 'Comment or ask' });
  const draft = composer.getByRole('textbox', { name: 'Comment or ask Claude' });
  const left = page.getByRole('complementary', { name: 'Left panel' });
  const list = left.getByRole('list', { name: 'Comment threads' });

  // 6.2: the comment tool's click opens our composer on the layer under it.
  await editor.execute('tool.comment', {});
  const onSwatch = await pagePoint(page, editor, 200, 150);
  await page.mouse.click(onSwatch.x, onSwatch.y);
  await expect(composer).toBeVisible();
  await expect(composer).toContainText('On Swatch');
  await expect(draft).toBeFocused();
  const box = (await composer.boundingBox())!;
  expect(Math.abs(box.x - (onSwatch.x + 16))).toBeLessThan(2); // beside the click
  await page.screenshot({
    path: `${testInfo.project.outputDir}/composer-${testInfo.project.name}.png`,
  });
  await draft.fill('Should this be green?');
  await composer.getByRole('button', { name: 'Comment' }).click();
  await expect(composer).toBeHidden();
  let all = await threads(editor);
  expect(all).toHaveLength(1);
  expect(all[0]).toMatchObject({
    text: 'Should this be green?',
    anchor: swatch.id,
    resolved: false,
  });
  await editor.execute('tool.move', {});

  // 6.4: the list, jump to the element, reply, resolve.
  await left.getByRole('tab', { name: 'Comments' }).click();
  await expect(left.getByRole('button', { name: 'Open · 1' })).toBeVisible();
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list).toContainText('on Swatch');
  await editor.execute('select.none', {});
  await list.getByRole('button', { name: /Should this be green/ }).click();
  await expect.poll(() => selection(editor)).toEqual([swatch.id]);
  const thread = left.getByRole('article', { name: `Thread ${all[0]!.id}` });
  await thread.getByRole('textbox', { name: 'Reply or ask Claude' }).fill('Yes, brand green.');
  await thread.getByRole('button', { name: 'Reply' }).click();
  await expect(list).toContainText('1 reply');
  await expect(thread).toContainText('Yes, brand green.');
  expect((await threads(editor))[0]!.replies.map((r) => r.text)).toEqual(['Yes, brand green.']);
  await thread.getByRole('button', { name: 'Resolve' }).click();
  await expect(left.getByRole('button', { name: 'Resolved · 1' })).toBeVisible();
  await expect(left.getByRole('button', { name: 'Open · 0' })).toBeVisible();
  expect((await threads(editor))[0]!.resolved).toBe(true);

  // 6.2 from C: the selection's composer; Ask Claude is one action from note to scoped turn.
  const sent = await asks(page);
  await editor.execute('select.set', { ids: [card.id] });
  await page.getByTitle('Design canvas').focus();
  await page.keyboard.press('c');
  await expect(composer).toBeVisible();
  await expect(composer).toContainText('On Card');
  await expect(draft).toBeFocused();
  await page.keyboard.type('Tighten the padding');
  await composer.getByRole('button', { name: 'Ask Claude' }).click();
  await expect(composer).toBeHidden();
  all = await threads(editor);
  const asked = all.find((t) => t.text === 'Tighten the padding')!;
  expect(asked).toMatchObject({ anchor: card.id });
  let fired = await sent();
  expect(fired).toHaveLength(1);
  expect(fired[0]!.scope).toEqual([card.id]);
  expect(fired[0]!.prompt).toMatch(/^Tighten the padding\n\nThis came from comment thread /);
  expect(fired[0]!.prompt).toContain(`comment thread ${asked.id}`);
  await left.getByRole('button', { name: /^Open/ }).click();
  await expect(list).toContainText('Tighten the padding');
  await page.screenshot({
    path: `${testInfo.project.outputDir}/comments-${testInfo.project.name}.png`,
  });

  // Ask Claude from any thread: the resolved one, with what to do.
  await left.getByRole('button', { name: /^Resolved/ }).click();
  await list.getByRole('button', { name: /Should this be green/ }).click();
  const green = all.find((t) => t.text === 'Should this be green?')!;
  const first = left.getByRole('article', { name: `Thread ${green.id}` });
  await first.getByRole('textbox', { name: 'Reply or ask Claude' }).fill('Make it green, please.');
  await first.getByRole('button', { name: 'Ask Claude' }).click();
  await expect.poll(async () => (await sent()).length).toBe(2);
  fired = await sent();
  expect(fired[1]!.scope).toEqual([swatch.id]);
  expect(fired[1]!.prompt).toMatch(/^Make it green, please\./);
  expect(fired[1]!.prompt).toContain(`comment thread ${green.id}`);
  expect(fired[1]!.prompt).toContain('Should this be green?');
  await expect(first).toContainText('Make it green, please.'); // it's in the thread too

  // Esc from the composer returns to the canvas without a thread.
  await page.keyboard.press('Escape');
  await editor.execute('view.zoomFit', {}); // the jump zoomed to the Swatch
  await editor.execute('tool.comment', {});
  const onCard = await pagePoint(page, editor, 40, 40);
  await page.mouse.click(onCard.x, onCard.y);
  await expect(composer).toContainText('On Card');
  await expect(draft).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(composer).toBeHidden();
  expect(await threads(editor)).toHaveLength(2);
  await editor.execute('tool.move', {});

  // From our context menu or floating toolbar (lane W2-D): `comment.new` with the layers and
  // `ask: true`. The platform's Cmd/Ctrl+Enter asks; the turn may change every layer named.
  await page.evaluate(
    ({ ids }) =>
      window.__greenfieldStore!.dispatch({
        type: 'ui.request',
        kind: 'comment.new',
        screen: { x: 200, y: 200 },
        data: { x: 0, y: 0, ids, ask: true },
      }),
    { ids: [swatch.id, card.id] },
  );
  await expect(composer).toContainText('On Swatch and 1 more');
  await expect(draft).toBeFocused();
  await expect(draft).toHaveAttribute('placeholder', 'Ask Claude to change Swatch and 1 more');
  await page.keyboard.type('Line these up');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(composer).toBeHidden();
  await expect.poll(async () => (await sent()).length).toBe(3);
  fired = await sent();
  expect(fired[2]!.scope).toEqual([swatch.id, card.id]);
  expect(fired[2]!.prompt).toMatch(/^Line these up/);
  expect((await threads(editor)).find((t) => t.text === 'Line these up')).toMatchObject({
    anchor: swatch.id,
  });

  const noise =
    /clerk\.accounts\.dev.*access control checks|\[editor\] CSP: Refused to apply a stylesheet/;
  problems.splice(0, problems.length, ...problems.filter((p) => !noise.test(p)));
});
