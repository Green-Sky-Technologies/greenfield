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

/**
 * fetch() from inside the page, so the request carries the live Clerk session. It asks Clerk for
 * the session token first, which renews the session cookie if it has expired since the last
 * background refresh (seen in Firefox, late in a three-engine run).
 */
export async function pageFetch(
  page: Page,
  url: string,
  init: {
    method?: string;
    body?: unknown;
    bytes?: number[];
    headers?: Record<string, string>;
  } = {},
): Promise<{ status: number; body: string }> {
  return page.evaluate(
    async ({ url, init }) => {
      await window.Clerk?.session?.getToken();
      const body =
        init.bytes !== undefined
          ? new Uint8Array(init.bytes)
          : init.body === undefined
            ? undefined
            : JSON.stringify(init.body);
      const r = await fetch(url, {
        method: init.method ?? 'GET',
        cache: 'no-store',
        headers: {
          ...(init.bytes !== undefined
            ? { 'content-type': 'application/octet-stream' }
            : init.body === undefined
              ? {}
              : { 'content-type': 'application/json' }),
          ...init.headers,
        },
        body,
      });
      return { status: r.status, body: await r.text() };
    },
    { url, init },
  );
}

/**
 * PUT the project's file from a fresh tab session. Saves need the edit lock (Story 3.1), so with
 * `lock` (the default) the session takes it first and leaves afterwards; without it, the request
 * still carries a session so the server's role and archived checks answer.
 */
export async function putFile(
  page: Page,
  projectId: string,
  bytes: number[],
  { lock = true }: { lock?: boolean } = {},
): Promise<{ status: number; body: string }> {
  const sessionId = `e2e-${Math.random().toString(36).slice(2, 10)}`;
  const lockUrl = `/api/projects/${projectId}/lock`;
  if (lock) await pageFetch(page, lockUrl, { method: 'POST', body: { sessionId } });
  const r = await pageFetch(page, `/api/projects/${projectId}/file`, {
    method: 'PUT',
    bytes,
    headers: { 'x-session-id': sessionId },
  });
  if (lock)
    await pageFetch(page, `${lockUrl}?sessionId=${sessionId}&leave=1`, { method: 'DELETE' });
  return r;
}
