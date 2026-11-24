import fs from 'node:fs';
import path from 'node:path';
import type { NextConfig } from 'next';
import { EMBEDDING_PAGE_CSP, editorCsp } from '@greenfield/bridge/csp';

/** The editor's policy hashes its index.html, so it's read once the release is fetched. */
function editorPolicy(): string {
  const index = path.join(process.cwd(), 'public/editor/index.html');
  if (!fs.existsSync(index)) {
    throw new Error('No editor in public/editor. Run `node scripts/fetch-editor.mjs`.');
  }
  return editorCsp(fs.readFileSync(index, 'utf8'));
}

const nextConfig: NextConfig = {
  // Cache Components (and partialPrefetching, which requires it) are off until we
  // settle caching patterns for authenticated, per-workspace pages. See docs/adr when we revisit.
  reactCompiler: true,
  transpilePackages: [
    '@greenfield/db',
    '@greenfield/crypto',
    '@greenfield/authz',
    '@greenfield/providers',
    '@greenfield/contracts',
    '@greenfield/agent',
    '@greenfield/sandbox-runner',
    '@greenfield/bridge',
  ],
  serverExternalPackages: ['pg'],
  // The FigCraft web release in public/editor (scripts/fetch-editor.mjs).
  // Hashed .wasm/.js names make them immutable; index.html must revalidate. Next already serves
  // .wasm as application/wasm. No COOP/COEP: the build doesn't use SharedArrayBuffer.
  // `/editor/` (which Next trims to `/editor`) opens the page; its URLs are relative to the
  // folder, so it's a redirect rather than a rewrite. The query string carries over.
  async redirects() {
    return [{ source: '/editor', destination: '/editor/index.html', permanent: false }];
  },
  // Content security policies (Story 8.1): @greenfield/bridge/csp.
  async headers() {
    return [
      {
        source: '/editor/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Content-Security-Policy', value: editorPolicy() },
        ],
      },
      {
        // The project page, which embeds the editor.
        source: '/w/:slug/p/:projectId',
        headers: [{ key: 'Content-Security-Policy', value: EMBEDDING_PAGE_CSP }],
      },
      {
        source: '/editor/:file(.*\\.(?:wasm|js))',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      { source: '/editor/index.html', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
    ];
  },
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
};

export default nextConfig;
