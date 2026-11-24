import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3100);

/**
 * Signed-out e2e against `next start`. The signed-in suites (real Clerk users, roles and
 * workspaces) have their own configs:
 *   pnpm e2e:app      (e2e/app/playwright.config.ts)
 *   pnpm e2e:editor   (e2e/editor/playwright.config.ts: the embedded editor, three engines)
 */
export default defineConfig({
  testDir: './e2e',
  testIgnore: ['app/**', 'editor/**'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://localhost:${PORT}`, trace: 'on-first-retry' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: `pnpm start --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
