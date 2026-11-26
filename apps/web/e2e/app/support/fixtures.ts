/**
 * Fixtures for the app suite.
 *
 *   const page = await as('viewer');   // a fresh browser context signed in as that role
 *   run.org.slug, run.users.editor.id  // this run's Clerk data (support/run-state.ts)
 *
 * Each role's context starts from the storage state the setup project saved after a real Clerk
 * sign-in, so specs don't sign in again. Every context gets the Clerk testing token so Frontend
 * API calls aren't challenged by bot protection.
 *
 * Every spec doubles as a health check of the pages it drives: an uncaught exception in the
 * browser or a 5xx from the app fails the test. Three reports are the browser's, not the app's,
 * and are dropped: WebKit's "access control checks" error for a fetch to the app or Clerk that it
 * cancelled (the page navigated away), the same for Clerk's token-poller worker, and a Clerk UI
 * chunk whose load the browser cancelled the same way (Firefox and WebKit).
 */
import { clerkSetup, setupClerkTestingToken } from '@clerk/testing/playwright';
import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import { storageStatePath } from './env';
import { requireRunState, type E2ERole } from './run-state';

type Run = ReturnType<typeof requireRunState>;

export interface AppFixtures {
  run: Run;
  /** A new page in its own browser context, signed in as `role`. */
  as: (role: E2ERole) => Promise<Page>;
  /** A new page in a signed-out browser context. */
  anonymous: () => Promise<Page>;
  /** Uncaught page errors and 5xx responses seen by any context of the test. */
  problems: string[];
}

export const test = base.extend<AppFixtures, { clerkToken: void }>({
  clerkToken: [
    // Fixture callbacks are named `provide` (not `use`) so the React hooks lint rule stays quiet.
    async ({}, provide) => {
      if (!process.env.CLERK_TESTING_TOKEN || !process.env.CLERK_FAPI) await clerkSetup();
      await provide();
    },
    { scope: 'worker', auto: true },
  ],
  run: async ({}, provide) => {
    await provide(requireRunState());
  },
  problems: async ({}, provide) => {
    const problems: string[] = [];
    await provide(problems);
    expect(problems, 'uncaught page errors or 5xx responses').toEqual([]);
  },
  as: async ({ browser, baseURL, problems }, provide) => {
    const contexts: BrowserContext[] = [];
    await provide(async (role) => {
      const context = await browser.newContext({ baseURL, storageState: storageStatePath(role) });
      contexts.push(context);
      watch(context, role, baseURL!, problems);
      await setupClerkTestingToken({ context });
      return context.newPage();
    });
    await closeAll(contexts);
  },
  anonymous: async ({ browser, baseURL, problems }, provide) => {
    const contexts: BrowserContext[] = [];
    await provide(async () => {
      const context = await browser.newContext({ baseURL });
      contexts.push(context);
      watch(context, 'anonymous', baseURL!, problems);
      return context.newPage();
    });
    await closeAll(contexts);
  },
});

function watch(context: BrowserContext, who: string, baseURL: string, problems: string[]) {
  const clerk = `https://${process.env.CLERK_FAPI}`;
  const origins = new Set([new URL(baseURL).origin, clerk]);
  context.on('weberror', (e) => {
    const error = e.error();
    if (
      isWebKitCancelledFetch(error, origins) ||
      isWebKitClerkWorkerBlobError(error) ||
      isClerkUiChunkError(error, clerk)
    )
      return;
    problems.push(`[${who}] page error: ${error.message}`);
  });
  // Story 8.1: the editor and the pages that embed it run under a CSP; any violation fails.
  context.on('console', (m) => {
    if (/content.security.policy/i.test(m.text())) problems.push(`[${who}] CSP: ${m.text()}`);
  });
  context.on('response', (r) => {
    if (r.status() >= 500 && r.url().startsWith(baseURL))
      problems.push(`[${who}] ${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`);
  });
}

function isWebKitCancelledFetch(error: Error, origins: Set<string>): boolean {
  const first = error.stack?.split('\n', 1)[0] ?? '';
  const url = /^Fetch API cannot load (\S+) due to access control checks\.$/.exec(first)?.[1];
  return !!url && URL.canParse(url) && origins.has(new URL(url).origin);
}

function isWebKitClerkWorkerBlobError(error: Error): boolean {
  const [first = '', ...frames] = error.stack?.split('\n') ?? [];
  return (
    /^Cannot load blob:\S+ due to access control checks\.$/.test(first) &&
    frames.some((f) => f.includes('/npm/@clerk/clerk-js@'))
  );
}

function isClerkUiChunkError(error: Error, clerk: string): boolean {
  const m = /^(ChunkLoadError: )?Loading chunk \S+ failed\.\n\(error: (\S+)\)$/.exec(error.message);
  return !!m?.[2]?.startsWith(`${clerk}/npm/@clerk/ui@`);
}

async function closeAll(contexts: BrowserContext[]) {
  for (const c of contexts) {
    // Drop the testing-token routes first, so in-flight Clerk requests don't log noise on close.
    await c.unrouteAll({ behavior: 'ignoreErrors' });
    await c.close();
  }
}

export { expect };
