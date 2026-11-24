import { defineConfig, devices } from '@playwright/test';
import { loadEnv } from '../app/support/env';

/**
 * Story 0.1 spike: the embedded FigCraft editor, signed in through real Clerk, in Chromium,
 * WebKit and Firefox.
 *
 *   node spikes/0.1-embed/fetch-editor.mjs
 *   pnpm --filter @greenfield/web exec playwright test -c e2e/figcraft-spike/playwright.config.ts
 *
 * Reuses the app suite's setup/teardown (Clerk users and orgs for this run, deleted afterwards).
 * The spike is dev-only, so the web server is `next dev` with GREENFIELD_FIGCRAFT_SPIKE=1 on 3101.
 */
loadEnv();
const PORT = Number(process.env.E2E_PORT ?? 3101);
const viewport = { width: 1440, height: 900 };
const spec = /figcraft-spike\/.*\.spec\.ts$/;

export default defineConfig({
  testDir: '..',
  outputDir: '../../test-results/e2e-figcraft-spike',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: 'list',
  use: { baseURL: `http://localhost:${PORT}`, viewport, trace: 'retain-on-failure' },
  projects: [
    { name: 'setup', testMatch: /app\/global\.setup\.ts/, teardown: 'teardown' },
    { name: 'teardown', testMatch: /app\/global\.teardown\.ts/ },
    {
      name: 'chromium',
      testMatch: spec,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], viewport },
    },
    {
      name: 'webkit',
      testMatch: spec,
      dependencies: ['setup'],
      use: { ...devices['Desktop Safari'], viewport },
    },
    {
      name: 'firefox',
      testMatch: spec,
      dependencies: ['setup'],
      use: { ...devices['Desktop Firefox'], viewport },
    },
  ],
  webServer: {
    command: `pnpm exec next dev --port ${PORT}`,
    cwd: '../..',
    env: { GREENFIELD_FIGCRAFT_SPIKE: '1' },
    url: `http://localhost:${PORT}/editor/index.html`,
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
