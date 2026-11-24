/**
 * Scenario 3, workspace isolation: a signed-in user from another workspace can't open a project,
 * read it through the API (always 404, never 403, never data) or use a workspace-only share link.
 */
import { createProject, pageFetch, uniqueName } from './support/app';
import { expect, test } from './support/fixtures';

test('an outsider can’t reach another workspace’s project, page or API', async ({ as, run }) => {
  const editor = await as('editor');
  const name = uniqueName('Isolated');
  const projectId = await createProject(editor, run.org.slug, name);
  const file = `/api/projects/${projectId}/file`;
  expect((await pageFetch(editor, file, { method: 'PUT', bytes: [7, 7, 7] })).status).toBe(200);

  const outsider = await as('outsider');
  await outsider.goto(`/w/${run.org.slug}`);
  // Not a member: the URL can't activate that org, so they land in their own workspace.
  await expect(outsider).toHaveURL(new RegExp(`/w/${run.outsiderOrg.slug}$`));
  await outsider.goto(`/w/${run.org.slug}/p/${projectId}`);
  await expect(outsider).toHaveURL(new RegExp(`/w/${run.outsiderOrg.slug}$`));
  await expect(outsider.getByText(name)).toHaveCount(0);

  for (const url of [
    file,
    `/api/projects/${projectId}/lock?sessionId=e2e`,
    `/api/comments?projectId=${projectId}`,
    `/api/share?projectId=${projectId}`,
  ]) {
    const res = await pageFetch(outsider, url);
    expect(res.status, url).toBe(404);
    expect(res.body, url).not.toContain(name);
  }
  // Writes are refused the same way.
  const lock = await pageFetch(outsider, `/api/projects/${projectId}/lock`, {
    method: 'POST',
    body: { sessionId: 'e2e-outsider' },
  });
  expect(lock.status).toBe(404);
  expect((await pageFetch(outsider, file, { method: 'PUT', bytes: [1] })).status).toBe(404);

  // A member of the workspace can read the same file (the 404 above isn't a broken route).
  const own = await pageFetch(editor, file);
  expect(own.status).toBe(200);
});

test('a workspace-only share link resolves for members but not for an outsider', async ({
  as,
  anonymous,
  run,
}) => {
  const editor = await as('editor');
  const projectId = await createProject(editor, run.org.slug, uniqueName('Workspace link'));
  const created = await pageFetch(editor, '/api/share', { method: 'POST', body: { projectId } });
  expect(created.status).toBe(201);
  const { path } = JSON.parse(created.body) as { path: string };
  expect(path).toMatch(/^\/s\/[^/]+$/);

  // Members reach the link (a notice for now: there is no viewer for FigCraft files yet).
  const viewer = await as('viewer');
  await viewer.goto(`/w/${run.org.slug}`);
  const ok = await viewer.goto(path);
  expect(ok?.status()).toBe(200);
  await expect(viewer.getByText(/can’t be viewed yet/)).toBeVisible();

  const outsider = await as('outsider');
  await outsider.goto(`/w/${run.outsiderOrg.slug}`);
  const denied = await outsider.goto(path);
  expect(denied?.status()).toBe(404);

  const anon = await anonymous();
  const anonRes = await anon.goto(path);
  expect(anonRes?.status()).toBe(404);
});
