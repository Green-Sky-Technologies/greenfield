/**
 * Scenario 2, roles (SPEC §3): a viewer can open a project but the server refuses their saves,
 * and they're kept out of admin settings; an editor doesn't see Model access.
 */
import { createProject, openProject, pageFetch, uniqueName } from './support/app';
import { expect, test } from './support/fixtures';

test('a viewer opens the project but cannot save it', async ({ as, run }) => {
  const editor = await as('editor');
  const projectId = await createProject(editor, run.org.slug, uniqueName('Roles'));
  const file = `/api/projects/${projectId}/file`;
  expect((await pageFetch(editor, file, { method: 'PUT', bytes: [1, 2] })).status).toBe(200);

  const page = await as('viewer');
  await openProject(page, run.org.slug, projectId);
  expect((await pageFetch(page, file)).status).toBe(200);
  // The server enforces the role: a save from the viewer's session is forbidden.
  expect((await pageFetch(page, file, { method: 'PUT', bytes: [9] })).status).toBe(403);
});

test('a viewer is redirected away from admin settings', async ({ as, run }) => {
  const page = await as('viewer');
  for (const path of ['settings/credentials', 'settings/usage']) {
    await page.goto(`/w/${run.org.slug}/${path}`);
    await expect(page).toHaveURL(new RegExp(`/w/${run.org.slug}$`));
  }
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New project' })).toHaveCount(0);

  // Read-only pages open (and don't error) for viewers; settings shows only what they may use.
  await page.goto(`/w/${run.org.slug}/settings`);
  await expect(page).toHaveURL(new RegExp(`/w/${run.org.slug}/settings/members$`));
  await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();
  const settings = page.getByRole('navigation', { name: 'Settings' });
  await expect(settings.getByRole('link', { name: 'Members' })).toBeVisible();
  await expect(settings.getByRole('link', { name: 'Model access' })).toHaveCount(0);
  await expect(settings.getByRole('link', { name: 'Usage' })).toHaveCount(0);
});

test('an editor has no Model access and is redirected from it', async ({ as, run }) => {
  const page = await as('editor');
  await page.goto(`/w/${run.org.slug}`);
  const header = page.getByRole('banner');
  await expect(
    header.getByRole('navigation').getByRole('link', { name: 'Projects' }),
  ).toBeVisible();
  await expect(header.getByRole('link', { name: 'Settings' })).toBeVisible();
  await page.goto(`/w/${run.org.slug}/settings/members`);
  const settings = page.getByRole('navigation', { name: 'Settings' });
  await expect(settings.getByRole('link', { name: 'Model access' })).toHaveCount(0);
  await expect(settings.getByRole('link', { name: 'Usage' })).toHaveCount(0);
  await page.goto(`/w/${run.org.slug}/settings/credentials`);
  await expect(page).toHaveURL(new RegExp(`/w/${run.org.slug}$`));

  const admin = await as('admin');
  await admin.goto(`/w/${run.org.slug}`);
  await admin.getByRole('banner').getByRole('link', { name: 'Settings' }).click();
  const adminSettings = admin.getByRole('navigation', { name: 'Settings' });
  for (const name of ['Members', 'Model access', 'Usage']) {
    await expect(adminSettings.getByRole('link', { name })).toBeVisible();
  }
  await adminSettings.getByRole('link', { name: 'Model access' }).click();
  await expect(admin.getByRole('heading', { name: 'Model access' })).toBeVisible();
});
