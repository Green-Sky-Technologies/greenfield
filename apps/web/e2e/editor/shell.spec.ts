/**
 * The editor shell on the project page with the real editor (Stories 5.1 and 5.4): the top bar,
 * and keyboard focus moving between it and the editor's iframe. C opens "Comment or ask" from the
 * canvas without the editor's own comment tool also firing; Esc returns to the canvas; F6 moves
 * between the bar and the canvas; Save from the bar uses the platform's chord (never a fixed
 * Ctrl). Driven through the bridge helper (`@greenfield/bridge/playwright`).
 */
import { platformFromUserAgent, saveChord } from '@greenfield/bridge';
import { openEditor } from '@greenfield/bridge/playwright';
import type { Page } from '@playwright/test';
import { createProject, uniqueName } from '../app/support/app';
import { expect, test } from '../app/support/fixtures';

/** Where the host page's keyboard focus is: the canvas (the editor iframe) or a control's name. */
const hostFocus = (page: Page) =>
  page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    if (a?.tagName === 'IFRAME') return 'canvas';
    return a?.getAttribute('aria-label') ?? a?.textContent?.trim() ?? a?.tagName ?? null;
  });

test('top bar, and focus and shortcuts between the shell and the editor', async ({
  as,
  run,
  problems,
}, testInfo) => {
  const page = await as('editor');
  const name = uniqueName('Shell');
  const projectId = await createProject(page, run.org.slug, name);
  const editor = await openEditor(page, { hostPath: `/w/${run.org.slug}/p/${projectId}` });
  const status = page.getByTestId('editor-status');
  await expect(status).toHaveAttribute('data-status', 'empty');
  await editor.execute('file.new', {});
  const tool = async () =>
    ((await editor.request('ui.inspect')) as { status: { tool: string } }).status.tool;

  const bar = page.getByRole('banner', { name: 'Project' });
  const canvas = page.getByTitle('Design canvas');
  const composer = page.getByRole('dialog', { name: 'Comment or ask' });
  const draft = composer.getByRole('textbox', { name: 'Comment or ask Claude' });

  // 5.1: the bar. Every control has a name a screen reader can read.
  await expect(bar.getByText(name, { exact: true })).toBeVisible();
  await expect(bar.getByText(`${name}.figcraft`)).toBeVisible();
  await expect(bar.getByRole('list', { name: /^People with access: You/ })).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Zoom level 100%, zoom options' })).toBeVisible();
  for (const control of await bar.locator('a, button, [role="group"], [role="list"]').all())
    await expect(control).toHaveAccessibleName(/\S/);
  await expect(canvas).toHaveAccessibleName('Design canvas');

  // Canvas mode (2.11): the editor draws only the canvas, below the bar.
  expect(((await editor.request('ui.inspect')) as { canvasMode: boolean }).canvasMode).toBe(true);
  const barBox = (await bar.boundingBox())!;
  const frameBox = (await canvas.boundingBox())!;
  expect(frameBox.y).toBeGreaterThanOrEqual(barBox.y + barBox.height);

  // Zoom goes through the bridge.
  await bar.getByRole('button', { name: /^Zoom level/ }).click();
  await bar.getByRole('menuitem', { name: 'Zoom in' }).click();
  await expect(bar.getByRole('button', { name: /^Zoom level (?!100%)/ })).toBeVisible();
  await bar.getByRole('button', { name: /^Zoom level/ }).click();
  await bar.getByRole('menuitem', { name: 'Zoom to 100%' }).click();
  await expect(bar.getByRole('button', { name: 'Zoom level 100%, zoom options' })).toBeVisible();

  // 5.4: from the canvas, C opens "Comment or ask"; the editor's comment tool does not fire.
  await canvas.click({ position: { x: 600, y: 400 } });
  expect(await hostFocus(page)).toBe('canvas');
  expect(await tool()).toBe('move');
  await page.keyboard.press('c');
  await expect(composer).toBeVisible();
  await expect(draft).toBeFocused();
  expect(await tool()).toBe('move');

  // Typing C into it is text, not a shortcut.
  await page.keyboard.type('nice card');
  await expect(draft).toHaveValue('nice card');
  await expect(composer).toHaveCount(1);

  // Esc returns to the canvas, where the editor's own keys work again.
  await page.keyboard.press('Escape');
  await expect(composer).toBeHidden();
  expect(await hostFocus(page)).toBe('canvas');
  await page.keyboard.press('r');
  await expect.poll(tool).not.toBe('move');
  await page.keyboard.press('v');
  await expect.poll(tool).toBe('move');

  // F6 cycles the edit panel, the bar, the left panel and the canvas (canvas-mode.spec.ts has
  // the whole cycle); Esc from a pane returns to the canvas.
  await page.keyboard.press('F6');
  await expect(page.getByRole('tab', { name: 'Design' })).toBeFocused();
  await page.keyboard.press('F6');
  await expect(bar.getByRole('link', { name: 'All projects' })).toBeFocused();
  await page.keyboard.press('Shift+F6');
  await expect(page.getByRole('tab', { name: 'Design' })).toBeFocused();
  await page.keyboard.press('Escape');
  expect(await hostFocus(page)).toBe('canvas');

  // Editing text on the canvas: C is a letter there.
  await page.keyboard.press('t');
  await canvas.click({ position: { x: 500, y: 300 } });
  await page.keyboard.type('cab');
  await expect(composer).toBeHidden();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // Save from the bar: the platform's chord, routed to the editor (not the browser's Save page).
  await bar.getByRole('button', { name: 'Share' }).focus();
  const chord = saveChord(platformFromUserAgent(await page.evaluate(() => navigator.userAgent)));
  await page.keyboard.press(chord);
  await expect(status).toHaveAttribute('data-saves', '1');
  expect(await hostFocus(page)).toBe('Share');

  // Share: the existing share-link flow, for a role that may use it.
  await bar.getByRole('button', { name: 'Share' }).click();
  const share = page.getByRole('dialog', { name: 'Share' });
  await share.getByRole('button', { name: 'Create share link' }).click();
  await expect(share.getByRole('textbox', { name: 'Share link' })).toHaveValue(/\/s\/[\w-]{43}$/);
  await page.keyboard.press('Escape');
  await expect(share).toBeHidden();

  // Screenshots of the bar, closed and with "Comment or ask" open.
  const shots = testInfo.project.outputDir;
  await bar.screenshot({ path: `${shots}/top-bar-${testInfo.project.name}.png` });
  await page.keyboard.press('c');
  await expect(composer).toBeVisible();
  await page.screenshot({
    path: `${shots}/shell-${testInfo.project.name}.png`,
    clip: { x: 0, y: 0, width: 1440, height: 320 },
  });

  // Known noise from outside the shell: Clerk's FAPI retries fail CORS in Playwright WebKit now
  // and then (see editor.spec.ts), and in WebKit the editor's keyboard input trips its own
  // style-src CSP (on main as well; the fork's to fix).
  const noise =
    /clerk\.accounts\.dev.*access control checks|\[editor\] CSP: Refused to apply a stylesheet/;
  problems.splice(0, problems.length, ...problems.filter((p) => !noise.test(p)));
});

test('a Viewer sees Share without the share-link action', async ({ as, run }) => {
  const editorPage = await as('editor');
  const projectId = await createProject(editorPage, run.org.slug, uniqueName('Shell view'));
  const page = await as('viewer');
  await page.goto(`/w/${run.org.slug}/p/${projectId}?webgl`);
  const bar = page.getByRole('banner', { name: 'Project' });
  await bar.getByRole('button', { name: 'Share' }).click();
  const share = page.getByRole('dialog', { name: 'Share' });
  await expect(share).toContainText('Only editors and admins can create share links.');
  await expect(share.getByRole('button', { name: 'Create share link' })).toHaveCount(0);
});
