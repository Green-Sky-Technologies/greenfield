import { defineConfig } from 'vitest/config';

// Unit tests only; the real-editor suite (e2e/*.spec.ts) runs under Playwright.
export default defineConfig({
  test: { include: ['test/**/*.test.ts'] },
});
