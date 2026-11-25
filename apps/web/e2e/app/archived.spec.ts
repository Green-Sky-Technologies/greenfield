/**
 * Archived projects are read-only: the project page says so and the server refuses saves until
 * the project is restored from the projects list.
 */
import { createProject, expectEditorReady, pageFetch, putFile, uniqueName } from './support/app';
import { expect, test } from './support/fixtures';

test('an archived project opens read-only until it is restored', async ({ as, run }) => {
  const page = await as('editor');
  const name = uniqueName('Archived');
  const projectId = await createProject(page, run.org.slug, name);
  const file = `/api/projects/${projectId}/file`;
  expect((await putFile(page, projectId, [1, 2, 3])).status).toBe(200);

  await page.goto(`/w/${run.org.slug}`);
  const card = page.getByRole('listitem').filter({ hasText: name });
  await card.getByRole('button', { name: 'Project actions' }).click();
  await card.getByRole('menuitem', { name: 'Archive' }).click();
  await expect(card).toHaveCount(0);

  await page.goto(`/w/${run.org.slug}?archived=1`);
  await page.getByRole('link', { name: `Open ${name}` }).click();
  await page.waitForURL(new RegExp(`/p/${projectId}$`));
  await expectEditorReady(page);
  await expect(page.getByText('Archived (read-only)')).toBeVisible();
  // Reading still works; saving is refused.
  expect((await pageFetch(page, file)).status).toBe(200);
  const refused = await putFile(page, projectId, [9], { lock: false });
  expect(refused.status).toBe(400);
  expect(refused.body).toContain('archived');

  // Restore: saving works again.
  await page.goto(`/w/${run.org.slug}?archived=1`);
  const archivedCard = page.getByRole('listitem').filter({ hasText: name });
  await archivedCard.getByRole('button', { name: 'Project actions' }).click();
  await archivedCard.getByRole('menuitem', { name: 'Restore' }).click();
  await expect(archivedCard).toHaveCount(0);
  expect((await putFile(page, projectId, [4])).status).toBe(200);
  await page.goto(`/w/${run.org.slug}/p/${projectId}`);
  await expectEditorReady(page);
  await expect(page.getByText('Archived (read-only)')).toHaveCount(0);
});
