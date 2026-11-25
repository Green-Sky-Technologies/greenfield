import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // The FigCraft web release, downloaded by scripts/fetch-editor.mjs.
    'public/editor/**',
    // Code fixtures (a sample repository the design-system builder reads, Story 10.2).
    'test/fixtures/**',
  ]),
]);

export default eslintConfig;
