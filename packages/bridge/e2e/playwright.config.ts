import { defineConfig, devices } from '@playwright/test';

/**
 * The bridge against the real editor (the pinned release in apps/web/public/editor), in Chromium,
 * WebKit and Firefox, through a tiny static host on port 3103 (no Next.js app):
 *
 *   node spikes/0.1-embed/fetch-editor.mjs
 *   pnpm --filter @greenfield/bridge e2e
 */
const PORT = Number(process.env.BRIDGE_PORT ?? 3103);
const viewport = { width: 1280, height: 800 };

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts$/,
  outputDir: '../test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: { baseURL: `http://127.0.0.1:${PORT}`, viewport, trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport } },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        viewport,
        // Linux CI runners have no GPU, and Firefox blocklists software WebGL there, so the
        // editor can't create a WebGL2 surface. Force it on (Mesa llvmpipe).
        launchOptions: {
          firefoxUserPrefs: { 'webgl.force-enabled': true, 'webgl.disabled': false },
        },
      },
    },
  ],
  webServer: {
    command: `pnpm exec tsx src/playwright/serve.ts --port ${PORT}`,
    cwd: '..',
    url: `http://127.0.0.1:${PORT}/editor/index.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
