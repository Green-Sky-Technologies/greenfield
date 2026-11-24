/** Page helpers for driving the real app. The editor itself is driven in e2e/editor. */
import { expect, type Page } from '@playwright/test';

export const uniqueName = (prefix: string) =>
  `${prefix} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** Create a project through the projects page; lands on the project. Returns the project id. */
export async function createProject(page: Page, slug: string, name: string): Promise<string> {
  await page.goto(`/w/${slug}`);
  await page.getByRole('button', { name: 'New project' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New project' });
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByRole('button', { name: 'Create' }).click();
  await page.waitForURL(new RegExp(`/w/${slug}/p/[^/?#]+$`));
  const id = new URL(page.url()).pathname.split('/').pop()!;
  await expectEditorReady(page);
  return id;
}

export async function openProject(page: Page, slug: string, projectId: string) {
  await page.goto(`/w/${slug}/p/${projectId}`);
  await expectEditorReady(page);
}

/** The project page is up and the embedded editor has said it's ready. */
export async function expectEditorReady(page: Page) {
  await expect(page.getByRole('link', { name: 'All projects' })).toBeVisible();
  await expect(page.getByTestId('editor-status')).not.toHaveAttribute('data-ready-ms', '', {
    timeout: 120_000,
  });
}

/** fetch() from inside the page, so the request carries the live (auto-refreshed) Clerk session. */
export async function pageFetch(
  page: Page,
  url: string,
  init: { method?: string; body?: unknown; bytes?: number[] } = {},
): Promise<{ status: number; body: string }> {
  return page.evaluate(
    async ({ url, init }) => {
      const body =
        init.bytes !== undefined
          ? new Uint8Array(init.bytes)
          : init.body === undefined
            ? undefined
            : JSON.stringify(init.body);
      const r = await fetch(url, {
        method: init.method ?? 'GET',
        cache: 'no-store',
        headers:
          init.bytes !== undefined
            ? { 'content-type': 'application/octet-stream' }
            : init.body === undefined
              ? undefined
              : { 'content-type': 'application/json' },
        body,
      });
      return { status: r.status, body: await r.text() };
    },
    { url, init },
  );
}
