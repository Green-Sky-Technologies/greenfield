import { defineConfig, devices } from '@playwright/test';
import { loadEnv } from './support/env';

/**
 * App suite: the real app (`next build` + `next start`) with real Clerk sign-in, in Chromium,
 * WebKit and Firefox.
 *
 *   pnpm --filter @greenfield/web e2e:app                    # all three engines
 *   pnpm --filter @greenfield/web e2e:app --project chromium
 *
 * Needs Clerk development keys (apps/web/.env.local or the environment), CREDENTIALS_MASTER_KEYS
 * and a migrated DATABASE_URL. The `setup` project creates this run's Clerk users and
 * organizations and signs each role in; `teardown` deletes them again (support/run-state.ts).
 * The web server builds first unless E2E_SKIP_BUILD=1 (CI builds in its own step). It runs
 * without the figcraft-cli pin, so agent jobs fail at once instead of starting a Vercel Sandbox.
 */
loadEnv();
const PORT = Number(process.env.E2E_PORT ?? 3200);
const viewport = { width: 1440, height: 900 };

export default defineConfig({
  testDir: '.',
  outputDir: '../../test-results/e2e-app',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 4,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never', outputFolder: '../../playwright-report' }]]
    : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /global\.setup\.ts/, teardown: 'teardown' },
    { name: 'teardown', testMatch: /global\.teardown\.ts/ },
    ...(
      [
        ['chromium', 'Desktop Chrome'],
        ['webkit', 'Desktop Safari'],
        ['firefox', 'Desktop Firefox'],
      ] as const
    ).map(([name, device]) => ({
      name,
      testMatch: /\.spec\.ts$/,
      dependencies: ['setup'],
      use: { ...devices[device], viewport },
    })),
  ],
  webServer: {
    command: `${process.env.E2E_SKIP_BUILD ? '' : 'pnpm build && '}pnpm start --port ${PORT}`,
    cwd: '../..',
    url: `http://localhost:${PORT}`,
    env: { GREENFIELD_FIGCRAFT_CLI_URL: 'off' },
    reuseExistingServer: !process.env.CI,
    timeout: 600_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
