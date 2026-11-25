/**
 * Design systems (Stories 10.1, 10.3, 10.4) in the real app: an admin uploads a library file,
 * drops a colour group in the review, publishes, makes it the default, and a new project's file
 * opens in the real editor with the system's variables, styles and components. Editors can't
 * publish or set the default; viewers can't create systems.
 *
 * The library file was made in the pinned editor (figcraft-web 0.18.1) through the bridge:
 * colour collections "Ink and paper" and "Accents", a spacing collection, text styles
 * display/xl, heading/m and body/m, and Button, Input and Card components.
 */
import path from 'node:path';
import type { Frame, Page } from '@playwright/test';
import { createProject, pageFetch, uniqueName } from '../app/support/app';
import { expect, test } from '../app/support/fixtures';

const LIBRARY = path.join(import.meta.dirname, '../../test/fixtures/voirdire-library.figcraft');

declare global {
  interface Window {
    figcraft: {
      execute(command: string, params?: unknown): Promise<unknown>;
      request(method: string, params?: unknown): Promise<unknown>;
      docInspect(params?: unknown): Promise<unknown>;
    };
  }
}

async function editorFrame(page: Page): Promise<Frame> {
  await expect
    .poll(() => page.frames().some((f) => f.url().includes('/editor/index.html')))
    .toBe(true);
  const frame = page.frames().find((f) => f.url().includes('/editor/index.html'))!;
  await frame.waitForFunction(() => typeof window.figcraft?.execute === 'function');
  return frame;
}

/** What the open document holds, as the editor reports it. */
async function documentContents(frame: Frame) {
  return frame.evaluate(async () => {
    const doc = (await window.figcraft.docInspect({})) as { pages: { name: string }[] };
    const components = (await window.figcraft.execute('component.list', {})) as {
      name: string;
    }[];
    const vars = (await window.figcraft.execute('variable.list', {})) as {
      collections: { name: string }[];
      variables: { name: string }[];
    };
    const styles = (await window.figcraft.execute('style.list', {})) as { name: string }[];
    return {
      pages: doc.pages.map((p) => p.name),
      components: components.map((c) => c.name),
      collections: vars.collections.map((c) => c.name),
      variables: vars.variables.map((v) => v.name),
      styles: styles.map((s) => s.name),
    };
  });
}

test('an admin reviews, publishes and defaults a system; a new file starts with it', async ({
  as,
  run,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Chromium only');
  const base = `/w/${run.org.slug}/settings/design-systems`;
  const name = uniqueName('Voirdire');
  const admin = await as('admin');

  // 10.1: upload a library file from Settings → Design systems.
  await admin.goto(`/w/${run.org.slug}/settings`);
  await admin
    .getByRole('navigation', { name: 'Settings' })
    .getByRole('link', { name: 'Design systems' })
    .click();
  await admin.getByRole('link', { name: '+ New design system' }).click();
  await admin.getByLabel('Name').fill(name);
  await admin.getByLabel('Library file').setInputFiles(LIBRARY);
  await admin.getByRole('button', { name: 'Upload and review' }).click();
  await admin.waitForURL(new RegExp(`${base}/[0-9a-f-]{36}$`));
  const systemUrl = new URL(admin.url()).pathname;

  // 10.3: every colour group, type style and component is offered; drop the accents.
  await expect(admin.getByRole('heading', { name: `Review · ${name}` })).toBeVisible();
  const items = admin.getByTestId('review-item');
  await expect(items).toHaveCount(8);
  await expect(admin.getByText('8 kept · 0 dropped')).toBeVisible();
  const accents = admin.getByRole('region', { name: 'Colours' }).getByLabel('Accents');
  await accents.getByRole('button', { name: 'Drop' }).click();
  await expect(accents).toHaveAttribute('data-dropped', 'true');
  await expect(admin.getByText('7 kept · 1 dropped')).toBeVisible();
  await admin.screenshot({ path: testInfo.outputPath('10.3-review.png'), fullPage: true });
  await admin.getByLabel('Guide for Claude').fill('Ink on paper. Rubric only for emphasis.');
  await admin.getByRole('button', { name: 'Publish' }).click();
  await expect(admin.getByRole('status')).toHaveText('Published.');
  await expect(admin.getByText('v1 · published')).toBeVisible();

  // 10.4: the list shows it published; make it the default.
  await admin.goto(base);
  const row = admin.getByRole('row').filter({ hasText: name });
  await expect(row.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  await row.getByRole('button', { name: 'Make default' }).click();
  await expect(row.getByText('Default', { exact: true })).toBeVisible();
  await admin.screenshot({ path: testInfo.outputPath('10.4-list.png'), fullPage: true });

  // A new project's file starts from the system, in the real editor.
  const projectId = await createProject(admin, run.org.slug, uniqueName('Landing'));
  expect((await pageFetch(admin, `/api/projects/${projectId}/file`)).status).toBe(200);
  const frame = await editorFrame(admin);
  await expect
    .poll(() => documentContents(frame).then((d) => d.pages, String), { timeout: 30_000 })
    .toEqual(['Page 1', name]);
  const doc = await documentContents(frame);
  expect(doc.collections).toEqual(['Ink and paper', 'Spacing']);
  expect(doc.variables).toContain('ink/900');
  expect(doc.variables).not.toContain('rubric/500');
  expect(doc.styles).toEqual(['display/xl', 'heading/m', 'body/m']);
  expect(doc.components).toEqual(['Button', 'Input', 'Card']);

  await admin.goto(base);
  await expect(admin.getByRole('row').filter({ hasText: name })).toContainText('1 file');

  // Non-admins: an editor sees the controls disabled; a viewer can't create a system.
  const editor = await as('editor');
  await editor.goto(base);
  const editorRow = editor.getByRole('row').filter({ hasText: name });
  await expect(editorRow.getByRole('switch')).toBeDisabled();
  await expect(editor.getByRole('radio', { name: /Admins and Editors/ })).toBeDisabled();
  await editor.getByRole('link', { name: '+ New design system' }).click();
  await editor.getByLabel('Name').fill(uniqueName('Draft'));
  await editor.getByLabel('Library file').setInputFiles(LIBRARY);
  await editor.getByRole('button', { name: 'Upload and review' }).click();
  await editor.waitForURL(new RegExp(`${base}/[0-9a-f-]{36}$`));
  await expect(editor.getByRole('button', { name: 'Save draft' })).toBeEnabled();
  await expect(editor.getByRole('button', { name: 'Publish' })).toBeDisabled();
  const viewer = await as('viewer');
  await viewer.goto(base);
  await expect(viewer.getByRole('link', { name: '+ New design system' })).toHaveCount(0);
  const refused = await pageFetch(viewer, `/api/design-systems?name=Nope`, {
    method: 'POST',
    bytes: [1, 2, 3],
  });
  expect(refused.status).toBe(403);

  // Leave the run's workspace as it was: new files start blank again.
  await admin.goto(systemUrl);
  await admin.getByRole('button', { name: 'Stop using as default' }).click();
  await expect(admin.getByRole('status')).toHaveText('New files start blank again.');
});
