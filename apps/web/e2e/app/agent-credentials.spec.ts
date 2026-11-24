/**
 * Scenario 8, no model credential: the Model access form validates on the client and on the
 * server. No key is saved and no model is ever called: a too-short key fails validation before
 * any provider test. (The agent pane's "No model connected" state returns with Epic 4.)
 */
import { expect, test } from './support/fixtures';

test('Model access validates input in the browser and on the server', async ({ as, run }) => {
  const page = await as('admin');
  await page.goto(`/w/${run.org.slug}/settings/credentials`);
  await expect(page.getByRole('heading', { name: 'Model access' })).toBeVisible();
  const key = page.getByLabel('API key', { exact: true });
  const save = page.getByRole('button', { name: 'Save and test' });

  // Client side: the browser won't submit an empty key.
  let actionCalls = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.headers()['next-action']) actionCalls++;
  });
  await save.click();
  expect(await key.evaluate((el: HTMLInputElement) => el.validity.valueMissing)).toBe(true);
  expect(actionCalls).toBe(0);

  // Server side: a too-short key comes back as a field error, before any connection test.
  await key.fill('sk-ant-short');
  await save.click();
  await expect(page.getByText('API key looks too short')).toBeVisible();
  await expect(page.getByText('Please fix the highlighted fields')).toBeVisible();
  expect(actionCalls).toBe(1);

  // Nothing was saved.
  await page.reload();
  await expect(page.getByLabel('API key', { exact: true })).toBeVisible();
  await page.goto(`/w/${run.org.slug}`);
  await expect(page.getByText('Connect a model to use the agent.')).toBeVisible();
});
